/** Fail-closed Telegram Bot API provider and local pairing Remote. */

import { Buffer } from 'node:buffer'
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { ProxyAgent } from 'undici'
import { Context, Service } from '@deepseek-ai/cordis'
import {
  ChannelConversationId,
  ChannelError,
  ChannelExternalMessageId,
  ChannelProviderId,
  ChannelSenderId,
} from '@deepseek-ai/dsh-channel'
import type {
  ChannelDeliveryReceipt,
  ChannelOutboundMessage,
  ChannelProvider,
} from '@deepseek-ai/dsh-channel'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import {
  splitTelegramPlainText,
  TelegramBotApiClient,
  TelegramBotApiError,
} from './http.ts'
import type {
  TelegramApiMessage,
  TelegramApiUpdate,
  TelegramApiUser,
} from './http.ts'
import { telegramChannelDomainSpec } from './spec.ts'
import type { TelegramDurableBinding, TelegramDurableState } from './spec.ts'
import { normalizeTelegramProxyUrl } from './proxy.ts'
import {
  disableTelegramState,
  enableTelegramState,
  revokeTelegramState,
} from './state.ts'
import type {
  TelegramBeginPairingErrorCode,
  TelegramBeginPairingResult,
  TelegramBotIdentity,
  TelegramChannelStatus,
  TelegramConfirmPairingRequest,
  TelegramConfirmPairingResult,
  TelegramEnableErrorCode,
  TelegramEnableResult,
  TelegramPairingCandidate,
  TelegramPairingStatus,
  TelegramRuntimePhase,
  TelegramSetProxyRequest,
  TelegramSetProxyResult,
} from './types.ts'

export { TelegramBotApiClient, TelegramBotApiError, splitTelegramPlainText } from './http.ts'
export type * from './http.ts'
export {
  telegramBotIdentitySchema,
  telegramBoundAccountSchema,
  telegramChannelDomainSpec,
  telegramDurableStateSchema,
  telegramPairingCandidateSchema,
} from './spec.ts'
export type * from './spec.ts'
export { normalizeTelegramProxyUrl, TELEGRAM_PROXY_URL_LIMIT } from './proxy.ts'
export type * from './proxy.ts'
export { disableTelegramState, enableTelegramState, revokeTelegramState } from './state.ts'
export type * from './types.ts'

/** The only credential reference this package resolves. Its value never enters provider state. */
export const TELEGRAM_BOT_TOKEN: CredentialRef = credentialRef('TELEGRAM_BOT_TOKEN')
/** Fixed provider id used by the provider-neutral channel seam. */
export const TELEGRAM_CHANNEL_PROVIDER = ChannelProviderId('telegram')

const PAIRING_TTL_MS = 10 * 60 * 1000
const CONTROL_TIMEOUT_MS = 15_000
const LONG_POLL_TIMEOUT_SECONDS = 30
const MAX_DELIVERY_ATTEMPTS = 5
const MAX_OUTBOUND_CHUNKS = 3
const MIN_CHAT_SEND_INTERVAL_MS = 1_000
const TASK_ACCEPTED_TEXT = 'Task received. The result will be sent here when it is ready.'

declare module '@deepseek-ai/cordis' {
  interface Context {
    channelTelegram: TelegramChannelService
  }
}

interface RuntimeProjection {
  phase: TelegramRuntimePhase
  retryAt?: number | undefined
  pendingUpdateCount?: number | undefined
}

interface VerifiedConnection {
  readonly bot: TelegramBotIdentity
  readonly credentialFingerprint: string
  readonly pendingUpdateCount: number
}

interface ProcessedUpdate {
  readonly keepPolling: boolean
  readonly reply?: {
    readonly chatId: string
    readonly replyTo: string
    readonly text: string
  }
}

interface OutboundGeneration {
  readonly id: number
  readonly credentialFingerprint: string
  readonly controller: AbortController
  readonly lastSendStartedAt: Map<string, number>
  tail: Promise<void>
}

class WebhookActiveError extends Error {}
class BotIdentityChangedError extends Error {}
class BotUsernameMissingError extends Error {}

/**
 * Calculate exponential retry with bounded jitter; `retry_after` bypasses this function.
 * @param attempt - Zero-based consecutive recoverable-failure count.
 * @param random - Injectable unit-interval entropy source for deterministic tests.
 * @returns Bounded delay in milliseconds.
 */
export function telegramBackoffDelayMs(attempt: number, random: () => number = Math.random): number {
  const boundedAttempt = Math.max(0, Math.min(5, Number.isSafeInteger(attempt) ? attempt : 0))
  const base = Math.min(30_000, 1_000 * (2 ** boundedAttempt))
  return base + Math.floor(Math.max(0, Math.min(0.999999, random())) * Math.min(1_000, base / 4))
}

/** Abortable timer used by polling and flood-control retries. */
function waitFor(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      reject(signal.reason instanceof Error ? signal.reason : new Error('Telegram operation aborted'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function safePositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0
}

function safeTelegramTimestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

function botIdentity(user: TelegramApiUser): TelegramBotIdentity | undefined {
  if (!safePositiveInteger(user.id) || !user.is_bot
    || typeof user.first_name !== 'string' || user.first_name.length === 0) return undefined
  if (typeof user.username !== 'string' || user.username.length === 0) throw new BotUsernameMissingError()
  return Object.freeze({ id: String(user.id), username: user.username, firstName: user.first_name })
}

function pairTokenHash(token: string): Buffer {
  return createHash('sha256').update(token).digest()
}

function newRoutingEpoch(): string {
  return randomBytes(16).toString('base64url')
}

function withActivationBarrier(
  current: TelegramDurableState,
  enabled: TelegramDurableState,
  now: number,
): TelegramDurableState {
  if (current.enabled) return enabled
  return Object.freeze({
    ...enabled,
    activationBarrier: Object.freeze({
      generation: current.disabledBacklog?.generation ?? newRoutingEpoch(),
      messageDateCutoff: Math.floor(now / 1_000),
    }),
  })
}

function expiredPairing(state: TelegramDurableState, now: number): boolean {
  if (state.pairing?.kind === 'waiting') return now >= state.pairing.expiresAt
  if (state.pairing?.kind === 'candidate') return now >= state.pairing.candidate.expiresAt
  return false
}

function publicBoundAccount(binding: TelegramDurableBinding) {
  return Object.freeze({
    userId: binding.userId,
    chatId: binding.chatId,
    firstName: binding.firstName,
    ...(binding.lastName === undefined ? {} : { lastName: binding.lastName }),
    ...(binding.username === undefined ? {} : { username: binding.username }),
    confirmedAt: binding.confirmedAt,
  })
}

function matchesPairToken(token: string, expectedHex: string): boolean {
  if (!/^[A-Za-z0-9_-]{22}$/u.test(token) || !/^[0-9a-f]{64}$/u.test(expectedHex)) return false
  const actual = pairTokenHash(token)
  const expected = Buffer.from(expectedHex, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function startToken(text: string): string | undefined {
  return /^\/start(?:@[A-Za-z0-9_]+)?[\t ]+([A-Za-z0-9_-]{22})[\t ]*$/u.exec(text)?.[1]
}

function optionalNonEmpty(value: string | undefined): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function nextOffset(current: number | undefined, updateId: number): number {
  if (!Number.isSafeInteger(updateId) || updateId < 0 || updateId >= Number.MAX_SAFE_INTEGER) {
    throw new TelegramBotApiError('protocol')
  }
  return Math.max(current ?? 0, updateId + 1)
}

function lastProcessedUpdateId(offset: number | undefined): number | undefined {
  return offset === undefined || offset < 1 ? undefined : offset - 1
}

function admissionMessage(message: TelegramApiMessage): {
  readonly userId: string
  readonly chatId: string
  readonly messageId: string
  readonly text: string
} | undefined {
  const sender = message.from
  if (message.chat.type !== 'private' || !safePositiveInteger(message.chat.id)
    || sender === undefined || sender.is_bot || !safePositiveInteger(sender.id)
    || !safePositiveInteger(message.message_id) || typeof message.text !== 'string') return undefined
  return {
    userId: String(sender.id),
    chatId: String(message.chat.id),
    messageId: String(message.message_id),
    text: message.text,
  }
}

function isTelegramUpdateArray(value: unknown): value is readonly TelegramApiUpdate[] {
  return Array.isArray(value) && value.every((update: unknown) => update !== null
    && typeof update === 'object' && typeof (update as { readonly update_id?: unknown }).update_id === 'number')
}

/** Telegram provider. Pairing Remotes change only local pairing state; they never submit tasks. */
export class TelegramChannelService extends TypertRemoteService {
  static inject = ['channel', 'credentials', 'storageDomain']

  private domain?: Domain<typeof telegramChannelDomainSpec>
  private readonly api: TelegramBotApiClient
  private runtime: RuntimeProjection = { phase: 'disabled' }
  private poller: { readonly controller: AbortController; readonly promise: Promise<void> } | undefined
  private outbound: OutboundGeneration | undefined
  private readonly retiredOutbound = new Set<OutboundGeneration>()
  private readonly controlController = new AbortController()
  private nextOutboundGeneration = 0
  private mutationTail: Promise<void> = Promise.resolve()
  private controlTail: Promise<void> = Promise.resolve()
  private stopping = false
  private proxyAgent: ProxyAgent | undefined
  private proxyAgentUri: string | undefined

  private readonly provider: ChannelProvider = {
    id: TELEGRAM_CHANNEL_PROVIDER,
    deliver: (message: ChannelOutboundMessage, signal: AbortSignal) => this.deliver(message, signal),
  }

  constructor(ctx: Context) {
    super(ctx, 'channelTelegram')
    this.api = new TelegramBotApiClient(
      async () => (await this.ctx.credentials.resolve(TELEGRAM_BOT_TOKEN))?.value,
      this.proxyFetch,
    )
  }

  /**
   * Route every Bot API request through the durable proxy override when one is
   * configured. Loopback runtime traffic never uses this client, so the agent
   * stays scoped to api.telegram.org.
   */
  private readonly proxyFetch: typeof fetch = (input, init) => {
    const agent = this.proxyAgent
    if (agent === undefined) return globalThis.fetch(input, init)
    return globalThis.fetch(input, { ...init, dispatcher: agent } as RequestInit)
  }

  /** Swap the dispatcher pool to match the durable proxy override. */
  private applyProxyAgent(proxyUrl: string | undefined): void {
    if (proxyUrl === this.proxyAgentUri) return
    const retired = this.proxyAgent
    this.proxyAgent = proxyUrl === undefined ? undefined : new ProxyAgent({ uri: proxyUrl, connectTimeout: 10_000 })
    this.proxyAgentUri = proxyUrl
    void retired?.close().catch(() => {
      // A retired pool only fails to drain; its requests already completed.
    })
  }

  /** Open the secret-free domain, register the transport, and restore desired enablement. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(telegramChannelDomainSpec)
    this.domain = domain
    const initial = this.state()
    const normalized = this.normalizeDurableState(initial, Date.now())
    if (normalized !== initial) await this.writeState(normalized)
    this.applyProxyAgent(normalized.proxyUrl)
    this.ctx.channel.registerProvider(this.provider)
    this.ctx.on('credentials/updated', (ref) => {
      if (ref !== TELEGRAM_BOT_TOKEN || this.stopping) return
      void this.enqueueControl(async () => {
        await this.stopRuntime()
        if (this.state().enabled) this.startPoller()
      }).catch(() => {
        // Service disposal owns cancellation and settlement of a queued credential restart.
      })
    })
    this.ctx.effect(() => async () => {
      this.stopping = true
      this.controlController.abort(new Error('Telegram service stopped'))
      this.runtime = { phase: 'stopping' }
      await this.stopRuntime()
      await this.controlTail
      await this.mutationTail
      this.applyProxyAgent(undefined)
      await domain.close()
    }, 'channel-telegram.domainClose')
    if (this.state().enabled) this.startPoller()
  }

  /**
   * Read the current safe configuration and runtime projection.
   * @returns Secret-free status for the loopback settings UI.
   */
  @Remote
  async status(): Promise<TelegramChannelStatus> {
    if (this.stopping) return await this.projectStatus(this.state())
    const state = await this.enqueueMutation(async () => {
      const current = this.state()
      const normalized = this.normalizeDurableState(current, Date.now())
      if (normalized !== current) await this.writeState(normalized)
      return normalized
    })
    return await this.projectStatus(state)
  }

  /**
   * Enable polling and issue one new 128-bit, ten-minute, single-use pairing capability.
   * @returns Capability once issued, or a stable fail-closed error and safe status.
   */
  @Remote
  beginPairing(): Promise<TelegramBeginPairingResult> {
    if (this.stopping) return this.beginFailure('service-stopping')
    return this.enqueueControl(async () => {
      if (this.state().binding !== undefined) return await this.beginFailure('already-paired')
      this.runtime = { phase: 'starting' }
      let connection: VerifiedConnection
      try {
        connection = await this.verifyConnection(this.controlSignal())
      } catch (error) {
        if (this.stopping) return await this.beginFailure('service-stopping')
        return await this.beginFailure(this.classifyBeginFailure(error))
      }
      const verifiedState = this.state()
      if (verifiedState.bot !== undefined && verifiedState.bot.id !== connection.bot.id) {
        this.runtime = { phase: 'credential-changed' }
        return await this.beginFailure('bot-identity-changed')
      }
      if (!verifiedState.enabled && connection.pendingUpdateCount > 0) {
        this.runtime = { phase: 'backlog-pending', pendingUpdateCount: connection.pendingUpdateCount }
        return await this.beginFailure('backlog-pending')
      }
      const transition = await this.enqueueMutation(async () => {
        // Re-read under the mutation lock: polling may have advanced an offset
        // while getMe/getWebhookInfo were in flight.
        const current = this.state()
        if (current.binding !== undefined) return { kind: 'failure' as const, code: 'already-paired' as const }
        if (current.bot !== undefined && current.bot.id !== connection.bot.id) {
          return { kind: 'failure' as const, code: 'bot-identity-changed' as const }
        }
        const issuedAt = Date.now()
        const expiresAt = issuedAt + PAIRING_TTL_MS
        const token = randomBytes(16).toString('base64url')
        const verified = enableTelegramState(current, connection.bot)
        if (verified === undefined) {
          return { kind: 'failure' as const, code: 'bot-identity-changed' as const }
        }
        const activated = withActivationBarrier(current, verified, issuedAt)
        const next: TelegramDurableState = Object.freeze({
          ...activated,
          pairing: Object.freeze({
            kind: 'waiting', tokenHash: pairTokenHash(token).toString('hex'), issuedAt, expiresAt,
          }),
        })
        await this.writeState(next)
        return { kind: 'success' as const, token, expiresAt, next }
      })
      if (transition.kind === 'failure') {
        if (transition.code === 'bot-identity-changed') this.runtime = { phase: 'credential-changed' }
        return await this.beginFailure(transition.code)
      }
      await this.activateOutbound(connection.credentialFingerprint)
      this.runtime = { phase: 'starting' }
      this.startPoller()
      const status = await this.projectStatus(transition.next)
      return Object.freeze({
        ok: true,
        value: Object.freeze({
          token: transition.token,
          deepLink: `https://t.me/${connection.bot.username}?start=${transition.token}`,
          expiresAt: transition.expiresAt,
          status,
        }),
      })
    })
  }

  /**
   * Bind exactly the pending candidate after a local desktop confirmation.
   * @param request - Candidate id displayed and confirmed by the desktop user.
   * @returns Updated safe status or a stable candidate-validation failure.
   */
  @Remote
  confirmPairing(request: TelegramConfirmPairingRequest): Promise<TelegramConfirmPairingResult> {
    if (this.stopping) return this.confirmFailure('service-stopping')
    return this.enqueueControl(async () => await this.enqueueMutation(async () => {
      const current = this.state()
      if (current.pairing?.kind !== 'candidate') return await this.confirmFailure('candidate-missing')
      if (Date.now() >= current.pairing.candidate.expiresAt) {
        const expired = Object.freeze({ ...current, pairing: undefined })
        await this.writeState(expired)
        return await this.confirmFailure('candidate-expired', expired)
      }
      if (typeof request.candidateId !== 'string'
        || request.candidateId !== current.pairing.candidate.candidateId) {
        return await this.confirmFailure('candidate-mismatch')
      }
      const candidate = current.pairing.candidate
      const binding: TelegramDurableBinding = Object.freeze({
        userId: candidate.userId,
        chatId: candidate.chatId,
        firstName: candidate.firstName,
        ...(candidate.lastName === undefined ? {} : { lastName: candidate.lastName }),
        ...(candidate.username === undefined ? {} : { username: candidate.username }),
        confirmedAt: Date.now(),
        routingEpoch: newRoutingEpoch(),
      })
      const next = Object.freeze({ ...current, pairing: undefined, binding })
      await this.writeState(next)
      return Object.freeze({ ok: true, value: await this.projectStatus(next) })
    }))
  }

  /**
   * Validate the configured bot and resume polling without changing pairing or binding.
   * @returns Updated safe status or a stable connection-validation failure.
   */
  @Remote
  enable(): Promise<TelegramEnableResult> {
    if (this.stopping) return this.enableFailure('service-stopping')
    return this.enqueueControl(async () => {
      this.runtime = { phase: 'starting' }
      let connection: VerifiedConnection
      try {
        connection = await this.verifyConnection(this.controlSignal())
      } catch (error) {
        if (this.stopping) return await this.enableFailure('service-stopping')
        return await this.enableFailure(this.classifyConnectionFailure(error))
      }
      const verifiedState = this.state()
      if (verifiedState.bot !== undefined && verifiedState.bot.id !== connection.bot.id) {
        this.runtime = { phase: 'credential-changed' }
        return await this.enableFailure('bot-identity-changed')
      }
      if (!verifiedState.enabled && connection.pendingUpdateCount > 0) {
        this.runtime = { phase: 'backlog-pending', pendingUpdateCount: connection.pendingUpdateCount }
        return await this.enableFailure('backlog-pending')
      }
      const enabled = await this.enqueueMutation(async () => {
        const current = this.state()
        const next = enableTelegramState(current, connection.bot)
        if (next === undefined) return undefined
        const activated = withActivationBarrier(current, next, Date.now())
        await this.writeState(activated)
        return activated
      })
      if (enabled === undefined) {
        this.runtime = { phase: 'credential-changed' }
        return await this.enableFailure('bot-identity-changed')
      }
      await this.activateOutbound(connection.credentialFingerprint)
      this.runtime = { phase: 'starting' }
      this.startPoller()
      return Object.freeze({ ok: true, value: await this.projectStatus(enabled) })
    })
  }

  /**
   * Persist the optional Bot API proxy override and restart polling when live.
   * @param request - Empty string clears the override; otherwise a host-addressed http(s) URL.
   * @returns Updated safe status, or a stable validation failure.
   */
  @Remote
  setProxy(request: TelegramSetProxyRequest): Promise<TelegramSetProxyResult> {
    if (this.stopping) return this.setProxyFailure('service-stopping')
    const normalized = normalizeTelegramProxyUrl(request.proxyUrl)
    if (normalized === null) return this.setProxyFailure('invalid-proxy')
    return this.enqueueControl(async () => {
      const next = await this.enqueueMutation(async () => {
        const current = this.state()
        const updated: TelegramDurableState = Object.freeze({
          ...current,
          ...(normalized === undefined ? { proxyUrl: undefined } : { proxyUrl: normalized }),
        })
        await this.writeState(updated)
        return updated
      })
      this.applyProxyAgent(normalized)
      if (next.enabled && !this.stopping) {
        await this.stopRuntime()
        this.startPoller()
      }
      return Object.freeze({ ok: true, value: await this.projectStatus(next) })
    })
  }

  /**
   * Stop polling while retaining pending pairing and the confirmed account.
   * @returns Disabled safe status after the poller has stopped.
   */
  @Remote
  disable(): Promise<TelegramChannelStatus> {
    if (this.stopping) return this.projectStatus(this.state())
    return this.enqueueControl(async () => {
      // Abort an in-flight long poll or admission before waiting for its
      // serialized mutation; otherwise disable could wait behind itself.
      await this.stopRuntime()
      const disabled = await this.enqueueMutation(async () => {
        const current = this.state()
        const next = Object.freeze({
          ...disableTelegramState(current),
          disabledBacklog: Object.freeze({
            generation: newRoutingEpoch(),
            cutoffOffset: current.nextUpdateOffset ?? 0,
          }),
        })
        await this.writeState(next)
        return next
      })
      this.runtime = { phase: 'disabled' }
      return await this.projectStatus(disabled)
    })
  }

  /**
   * Disable the provider and remove every bot-specific durable identity and offset.
   * @returns Revoked safe status after the poller has stopped.
   */
  @Remote
  revoke(): Promise<TelegramChannelStatus> {
    if (this.stopping) return this.projectStatus(this.state())
    return this.enqueueControl(async () => {
      await this.stopRuntime()
      const next = await this.enqueueMutation(async () => {
        const revoked = Object.freeze({
          ...revokeTelegramState(this.state()),
          disabledBacklog: Object.freeze({ generation: newRoutingEpoch(), cutoffOffset: 0 }),
        })
        await this.writeState(revoked)
        return revoked
      })
      this.runtime = { phase: 'disabled' }
      return await this.projectStatus(next)
    })
  }

  /** Provider-neutral outbound delivery; only the durably bound chat is routable. */
  private async deliver(message: ChannelOutboundMessage, signal: AbortSignal): Promise<ChannelDeliveryReceipt> {
    const state = this.state()
    if (message.provider !== TELEGRAM_CHANNEL_PROVIDER) {
      throw new ChannelError('Telegram delivery target is not an active bound conversation', 'CHANNEL_TELEGRAM_UNAVAILABLE')
    }
    if (state.binding?.routingEpoch === undefined || message.conversationId !== state.binding.routingEpoch) {
      throw new ChannelError('Telegram delivery route has expired', 'CHANNEL_TELEGRAM_ROUTE_EXPIRED')
    }
    const generation = this.outbound
    if (!state.enabled || generation === undefined) {
      throw new ChannelError('Telegram delivery target is temporarily unavailable', 'CHANNEL_TELEGRAM_UNAVAILABLE')
    }
    const chunks = splitTelegramPlainText(message.text)
    if (chunks.length === 0) {
      throw new ChannelError('Telegram cannot deliver an empty text message', 'CHANNEL_TELEGRAM_EMPTY')
    }
    if (chunks.length > MAX_OUTBOUND_CHUNKS) {
      throw new ChannelError('Telegram text exceeds the three-message delivery limit', 'CHANNEL_TELEGRAM_TEXT_TOO_LONG')
    }
    const route = state.binding.routingEpoch
    const chatId = state.binding.chatId
    return await this.enqueueOutbound(generation, signal, async (operationSignal) => {
      let delivered: TelegramApiMessage | undefined
      for (let index = 0; index < chunks.length; index += 1) {
        this.assertOutboundGeneration(generation, route)
        const chunk = chunks[index]
        if (chunk === undefined) continue
        delivered = await this.sendWithRetry(
          generation,
          chatId,
          chunk,
          index === 0 ? message.replyTo : undefined,
          operationSignal,
        )
      }
      if (!safePositiveInteger(delivered?.message_id)) {
        throw new ChannelError('Telegram returned an invalid delivery receipt', 'CHANNEL_TELEGRAM_PROTOCOL')
      }
      return Object.freeze({ externalMessageId: ChannelExternalMessageId(String(delivered.message_id)) })
    })
  }

  /** Validate getMe and fail closed when any webhook URL is active. */
  private async verifyConnection(signal?: AbortSignal): Promise<VerifiedConnection> {
    const authenticated = await this.api.getMe(signal)
    const bot = botIdentity(authenticated.bot)
    if (bot === undefined) throw new TelegramBotApiError('protocol')
    const webhook = await this.api.getWebhookInfo(authenticated.credentialFingerprint, signal)
    if (typeof webhook.url !== 'string' || !Number.isSafeInteger(webhook.pending_update_count)
      || webhook.pending_update_count < 0) throw new TelegramBotApiError('protocol')
    if (webhook.url.length > 0) throw new WebhookActiveError()
    return {
      bot,
      credentialFingerprint: authenticated.credentialFingerprint,
      pendingUpdateCount: webhook.pending_update_count,
    }
  }

  /** Bound an explicit desktop connection check by both service lifetime and wall time. */
  private controlSignal(): AbortSignal {
    return AbortSignal.any([
      this.controlController.signal,
      AbortSignal.timeout(CONTROL_TIMEOUT_MS),
    ])
  }

  /** Migrate legacy bindings and durably remove expired pairing capabilities. */
  private normalizeDurableState(state: TelegramDurableState, now: number): TelegramDurableState {
    let normalized = state
    if (expiredPairing(normalized, now)) normalized = Object.freeze({ ...normalized, pairing: undefined })
    if (normalized.binding !== undefined && normalized.binding.routingEpoch === undefined) {
      normalized = Object.freeze({
        ...normalized,
        binding: Object.freeze({ ...normalized.binding, routingEpoch: newRoutingEpoch() }),
      })
    }
    if (!normalized.enabled && normalized.disabledBacklog === undefined) {
      normalized = Object.freeze({
        ...normalized,
        disabledBacklog: Object.freeze({
          generation: newRoutingEpoch(),
          cutoffOffset: normalized.nextUpdateOffset ?? 0,
        }),
      })
    }
    return normalized
  }

  /** Start the sole abortable poller. */
  private startPoller(): void {
    if (this.poller !== undefined || this.stopping || !this.state().enabled) return
    const controller = new AbortController()
    const promise = this.runPoller(controller.signal).finally(() => {
      if (this.poller?.controller === controller) this.poller = undefined
    })
    this.poller = { controller, promise }
  }

  /** Stop and join the current poller. */
  private async stopPoller(): Promise<void> {
    const poller = this.poller
    if (poller === undefined) return
    poller.controller.abort(new Error('Telegram poller stopped'))
    await poller.promise.catch(() => {})
    if (this.poller === poller) this.poller = undefined
  }

  /** Abort polling and outbound work together, then join both lifecycle owners. */
  private async stopRuntime(): Promise<void> {
    await Promise.all([this.stopPoller(), this.stopOutbound()])
  }

  /** Install one outbound generation after its credential and bot identity are verified. */
  private async activateOutbound(credentialFingerprint: string): Promise<void> {
    const current = this.outbound
    if (current !== undefined && !current.controller.signal.aborted
      && current.credentialFingerprint === credentialFingerprint) {
      return
    }
    await this.stopOutbound()
    if (this.stopping || !this.state().enabled) return
    const generation: OutboundGeneration = {
      id: this.nextOutboundGeneration,
      credentialFingerprint,
      controller: new AbortController(),
      lastSendStartedAt: new Map(),
      tail: Promise.resolve(),
    }
    this.nextOutboundGeneration += 1
    this.outbound = generation
  }

  /** Stop accepting outbound work, abort the current generation, and join every queued send. */
  private async stopOutbound(): Promise<void> {
    const generation = this.outbound
    if (generation !== undefined) this.invalidateOutboundGeneration(generation)
    await Promise.all([...this.retiredOutbound].map(retired => retired.tail))
  }

  /** Detach and cancel an exact generation without waiting on its own queue. */
  private invalidateOutboundGeneration(generation: OutboundGeneration): void {
    if (this.outbound === generation) {
      this.outbound = undefined
    }
    if (!generation.controller.signal.aborted) {
      generation.controller.abort(new Error('Telegram outbound generation stopped'))
    }
    this.retiredOutbound.add(generation)
    void generation.tail.then(() => { this.retiredOutbound.delete(generation) })
  }

  /** Serialize all sends in one generation and fuse caller cancellation with provider teardown. */
  private enqueueOutbound<T>(
    generation: OutboundGeneration,
    callerSignal: AbortSignal,
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const operationSignal = AbortSignal.any([callerSignal, generation.controller.signal])
    const result = generation.tail.then(async () => {
      this.assertOutboundGeneration(generation)
      operationSignal.throwIfAborted()
      return await operation(operationSignal)
    })
    generation.tail = result.then(() => undefined, () => undefined)
    return result
  }

  /** Fail a detached generation before another chunk or retry can leave the process. */
  private assertOutboundGeneration(generation: OutboundGeneration, route?: string): void {
    if (this.outbound?.id !== generation.id || generation.controller.signal.aborted) {
      throw new ChannelError('Telegram delivery generation is no longer active', 'CHANNEL_TELEGRAM_UNAVAILABLE')
    }
    if (route === undefined) return
    const state = this.state()
    if (state.binding?.routingEpoch !== route) {
      throw new ChannelError('Telegram delivery route has expired', 'CHANNEL_TELEGRAM_ROUTE_EXPIRED')
    }
    if (!state.enabled) {
      throw new ChannelError('Telegram delivery target is temporarily unavailable', 'CHANNEL_TELEGRAM_UNAVAILABLE')
    }
  }

  /** Reserve Telegram's one-message-per-second private-chat send slot. */
  private async reserveChatSend(
    generation: OutboundGeneration,
    chatId: string,
    signal: AbortSignal,
  ): Promise<void> {
    const previous = generation.lastSendStartedAt.get(chatId)
    if (previous !== undefined) {
      const remaining = MIN_CHAT_SEND_INTERVAL_MS - (Date.now() - previous)
      if (remaining > 0) await waitFor(remaining, signal)
    }
    this.assertOutboundGeneration(generation)
    signal.throwIfAborted()
    generation.lastSendStartedAt.set(chatId, Date.now())
  }

  /** Reconnect, poll, and retry only secret-safe recoverable failures. */
  private async runPoller(signal: AbortSignal): Promise<void> {
    let attempt = 0
    while (!signal.aborted && !this.stopping && this.state().enabled) {
      try {
        this.runtime = { phase: 'starting' }
        const connection = await this.verifyConnection(signal)
        await this.enqueueMutation(async () => {
          const current = this.state()
          if (current.bot !== undefined && current.bot.id !== connection.bot.id) {
            throw new BotIdentityChangedError()
          }
          if (current.bot === undefined) await this.writeState(Object.freeze({ ...current, bot: connection.bot }))
        })
        await this.activateOutbound(connection.credentialFingerprint)
        this.runtime = { phase: 'polling' }
        await this.poll(connection.credentialFingerprint, signal, () => { attempt = 0 })
      } catch (error) {
        if (this.shouldStop(signal)) return
        const retry = this.retryFor(error, attempt)
        if (retry === undefined) {
          await this.stopOutbound()
          return
        }
        attempt += 1
        await waitFor(retry, signal)
      }
    }
  }

  /** Poll until one request fails or durable enablement is revoked. */
  private async poll(
    credentialFingerprint: string,
    signal: AbortSignal,
    onSuccessfulPoll: () => void,
  ): Promise<void> {
    while (!signal.aborted && !this.stopping && this.state().enabled) {
      const updates: unknown = await this.api.getUpdates(
        this.state().nextUpdateOffset,
        LONG_POLL_TIMEOUT_SECONDS,
        credentialFingerprint,
        signal,
      )
      if (!isTelegramUpdateArray(updates)) throw new TelegramBotApiError('protocol')
      if (await this.blockPreActivationBatch(updates)) {
        await this.stopOutbound()
        return
      }
      onSuccessfulPoll()
      for (const update of updates) {
        const processed = await this.processUpdate(update, signal)
        if (processed.reply !== undefined) await this.sendInformational(processed.reply, credentialFingerprint, signal)
        if (!processed.keepPolling) return
      }
    }
  }

  /** Disable before any batch member can cross a persisted activation timestamp barrier. */
  private blockPreActivationBatch(updates: readonly TelegramApiUpdate[]): Promise<boolean> {
    return this.enqueueMutation(async () => {
      const current = this.state()
      const barrier = current.activationBarrier
      if (!current.enabled || barrier === undefined) return false
      const blockedCount = updates.filter(update => this.isPreActivationText(current, update)).length
      if (blockedCount === 0) return false
      const disabled = disableTelegramState(current)
      const next = Object.freeze({
        ...disabled,
        disabledBacklog: Object.freeze({
          generation: barrier.generation,
          cutoffOffset: current.nextUpdateOffset ?? 0,
        }),
      })
      await this.writeState(next)
      this.runtime = { phase: 'backlog-pending', pendingUpdateCount: blockedCount }
      return true
    })
  }

  /** Identify a private text that could have been sent before the activation commit. */
  private isPreActivationText(state: TelegramDurableState, update: TelegramApiUpdate): boolean {
    if (state.nextUpdateOffset !== undefined && update.update_id < state.nextUpdateOffset) return false
    const message = update.message
    if (message === undefined) return false
    const inbound = admissionMessage(message)
    if (inbound === undefined || inbound.text.trim().length === 0) return false
    let validPairingStart = false
    if (state.binding !== undefined) {
      if (inbound.userId !== state.binding.userId || inbound.chatId !== state.binding.chatId) return false
    } else {
      const waiting = state.pairing?.kind === 'waiting' ? state.pairing : undefined
      const token = startToken(inbound.text)
      validPairingStart = waiting !== undefined && Date.now() < waiting.expiresAt && token !== undefined
        && matchesPairToken(token, waiting.tokenHash)
    }
    const cutoff = state.activationBarrier?.messageDateCutoff
    if (cutoff === undefined) return false
    if (!safeTelegramTimestamp(message.date)) return true
    return !validPairingStart && message.date <= cutoff
  }

  /** Authenticate, durably admit, then atomically move the next-update offset. */
  private processUpdate(update: TelegramApiUpdate, signal: AbortSignal): Promise<ProcessedUpdate> {
    return this.enqueueMutation(async () => {
      if (!Number.isSafeInteger(update.update_id) || update.update_id < 0) {
        throw new TelegramBotApiError('protocol')
      }
      let current = this.state()
      const normalized = this.normalizeDurableState(current, Date.now())
      if (normalized !== current) {
        await this.writeState(normalized)
        current = normalized
      }
      if (!current.enabled) return { keepPolling: false }
      if (current.nextUpdateOffset !== undefined && update.update_id < current.nextUpdateOffset) {
        return { keepPolling: true }
      }
      const message = update.message
      const inbound = message === undefined ? undefined : admissionMessage(message)
      const offset = nextOffset(current.nextUpdateOffset, update.update_id)
      if (inbound === undefined) {
        await this.writeState(Object.freeze({ ...current, nextUpdateOffset: offset }))
        return { keepPolling: true }
      }

      const now = Date.now()
      if (current.binding === undefined) {
        const waiting = current.pairing?.kind === 'waiting' ? current.pairing : undefined
        const token = startToken(inbound.text)
        if (waiting !== undefined && now < waiting.expiresAt && token !== undefined
          && matchesPairToken(token, waiting.tokenHash) && message?.from !== undefined) {
          const lastName = optionalNonEmpty(message.from.last_name)
          const username = optionalNonEmpty(message.from.username)
          const candidate: TelegramPairingCandidate = Object.freeze({
            candidateId: randomUUID(),
            userId: inbound.userId,
            chatId: inbound.chatId,
            firstName: message.from.first_name.length > 0 ? message.from.first_name : 'Telegram user',
            ...(lastName === undefined ? {} : { lastName }),
            ...(username === undefined ? {} : { username }),
            receivedAt: now,
            expiresAt: waiting.expiresAt,
          })
          await this.writeState(Object.freeze({
            ...current,
            nextUpdateOffset: offset,
            pairing: Object.freeze({ kind: 'candidate', candidate }),
          }))
          return {
            keepPolling: true,
            reply: {
              chatId: inbound.chatId,
              replyTo: inbound.messageId,
              text: 'Pairing request received. Confirm it in DeepSeek Harness Desktop.',
            },
          }
        }
        const pairing = waiting !== undefined && now >= waiting.expiresAt ? undefined : current.pairing
        await this.writeState(Object.freeze({ ...current, nextUpdateOffset: offset, pairing }))
        return { keepPolling: true }
      }

      const authorized = inbound.userId === current.binding.userId && inbound.chatId === current.binding.chatId
      if (!authorized) {
        await this.writeState(Object.freeze({ ...current, nextUpdateOffset: offset }))
        return { keepPolling: true }
      }
      if (/^\/start(?:@[A-Za-z0-9_]+)?(?:$|[\t ])/u.test(inbound.text)) {
        await this.writeState(Object.freeze({ ...current, nextUpdateOffset: offset }))
        return {
          keepPolling: true,
          reply: {
            chatId: inbound.chatId,
            replyTo: inbound.messageId,
            text: 'This Telegram account is already paired with DeepSeek Harness Desktop.',
          },
        }
      }
      if (inbound.text.trim().length === 0) {
        await this.writeState(Object.freeze({ ...current, nextUpdateOffset: offset }))
        return { keepPolling: true }
      }

      signal.throwIfAborted()
      const routingEpoch = current.binding.routingEpoch
      if (routingEpoch === undefined) throw new TelegramBotApiError('protocol')
      await this.ctx.channel.admit(Object.freeze({
        provider: TELEGRAM_CHANNEL_PROVIDER,
        conversationId: ChannelConversationId(routingEpoch),
        senderId: ChannelSenderId(inbound.userId),
        externalMessageId: ChannelExternalMessageId(inbound.messageId),
        text: inbound.text,
      }), signal)
      // Channel admission settles only after durable idempotency and prompt flush.
      await this.writeState(Object.freeze({ ...current, nextUpdateOffset: offset }))
      return {
        keepPolling: true,
        reply: {
          chatId: inbound.chatId,
          replyTo: inbound.messageId,
          text: TASK_ACCEPTED_TEXT,
        },
      }
    })
  }

  /** Best-effort provider reply that never rolls back a committed offset or pairing transition. */
  private async sendInformational(
    reply: NonNullable<ProcessedUpdate['reply']>,
    credentialFingerprint: string,
    signal: AbortSignal,
  ): Promise<void> {
    const generation = this.outbound
    if (generation === undefined || generation.credentialFingerprint !== credentialFingerprint) return
    try {
      await this.enqueueOutbound(generation, signal, async operationSignal => await this.sendWithRetry(
        generation,
        reply.chatId,
        reply.text,
        reply.replyTo,
        operationSignal,
      ))
    } catch {
      // Informational delivery is explicitly after the durable commit point.
    }
  }

  /** Send one bounded chunk with flood-control and transient retry handling. */
  private async sendWithRetry(
    generation: OutboundGeneration,
    chatId: string,
    text: string,
    replyTo: string | undefined,
    signal: AbortSignal,
  ): Promise<TelegramApiMessage> {
    let attempt = 0
    while (attempt < MAX_DELIVERY_ATTEMPTS) {
      this.assertOutboundGeneration(generation)
      await this.reserveChatSend(generation, chatId, signal)
      let delivered: TelegramApiMessage
      try {
        delivered = await this.api.sendMessage(
          chatId,
          text,
          generation.credentialFingerprint,
          replyTo,
          signal,
        )
      } catch (error) {
        if (signal.aborted) signal.throwIfAborted()
        if (!(error instanceof TelegramBotApiError)) {
          throw new ChannelError('Telegram delivery failed', 'CHANNEL_TELEGRAM_DELIVERY_FAILED')
        }
        if (error.kind === 'credential-missing' || error.kind === 'credential-changed') {
          this.invalidateOutboundGeneration(generation)
          this.runtime = { phase: error.kind }
          throw new ChannelError('Telegram credential is unavailable', 'CHANNEL_TELEGRAM_CREDENTIAL')
        }
        if (error.status === 401) {
          this.invalidateOutboundGeneration(generation)
          this.runtime = { phase: 'unauthorized' }
          throw new ChannelError('Telegram rejected the bot credential', 'CHANNEL_TELEGRAM_UNAUTHORIZED')
        }
        if (error.status === 409) {
          this.invalidateOutboundGeneration(generation)
          this.runtime = { phase: 'api-conflict' }
          throw new ChannelError('Telegram reported an API conflict', 'CHANNEL_TELEGRAM_CONFLICT')
        }
        if (error.status !== undefined && error.status >= 400 && error.status < 500
          && error.status !== 429) {
          throw new ChannelError(
            'Telegram permanently rejected the delivery route',
            'CHANNEL_TELEGRAM_ROUTE_EXPIRED',
          )
        }
        const delay = error.status === 429 && error.retryAfter !== undefined
          ? error.retryAfter * 1000
          : telegramBackoffDelayMs(attempt)
        this.runtime = {
          phase: error.status === 429 ? 'rate-limited' : 'backing-off',
          retryAt: Date.now() + delay,
        }
        attempt += 1
        await waitFor(delay, signal)
        continue
      }
      this.assertOutboundGeneration(generation)
      return delivered
    }
    throw new ChannelError('Telegram delivery retry limit reached', 'CHANNEL_TELEGRAM_RETRY_LIMIT')
  }

  /** Map a poll/connect failure to either a retry delay or a fail-closed terminal state. */
  private retryFor(error: unknown, attempt: number): number | undefined {
    if (error instanceof WebhookActiveError) {
      this.runtime = { phase: 'webhook-active' }
      return undefined
    }
    if (error instanceof BotIdentityChangedError) {
      this.runtime = { phase: 'credential-changed' }
      return undefined
    }
    if (error instanceof TelegramBotApiError) {
      if (error.kind === 'credential-missing' || error.kind === 'credential-changed') {
        this.runtime = { phase: error.kind }
        return undefined
      }
      if (error.status === 401) {
        this.runtime = { phase: 'unauthorized' }
        return undefined
      }
      if (error.status === 409) {
        this.runtime = { phase: 'api-conflict' }
        return undefined
      }
      if (error.status === 429 && error.retryAfter !== undefined) {
        const delay = error.retryAfter * 1000
        this.runtime = { phase: 'rate-limited', retryAt: Date.now() + delay }
        return delay
      }
      const delay = telegramBackoffDelayMs(attempt)
      this.runtime = { phase: 'backing-off', retryAt: Date.now() + delay }
      return delay
    }
    const delay = telegramBackoffDelayMs(attempt)
    this.runtime = { phase: 'backing-off', retryAt: Date.now() + delay }
    return delay
  }

  /** Convert connection failures to stable local business codes. */
  private classifyConnectionFailure(error: unknown): TelegramEnableErrorCode {
    if (error instanceof WebhookActiveError) {
      this.runtime = { phase: 'webhook-active' }
      return 'webhook-active'
    }
    if (error instanceof BotUsernameMissingError) {
      this.runtime = { phase: 'error' }
      return 'bot-username-missing'
    }
    if (error instanceof TelegramBotApiError) {
      if (error.kind === 'credential-missing') {
        this.runtime = { phase: 'credential-missing' }
        return 'credential-missing'
      }
      if (error.status === 401) {
        this.runtime = { phase: 'unauthorized' }
        return 'unauthorized'
      }
      if (error.status === 409) {
        this.runtime = { phase: 'api-conflict' }
        return 'api-conflict'
      }
    }
    this.runtime = { phase: 'error' }
    return 'connection-failed'
  }

  private classifyBeginFailure(error: unknown): TelegramBeginPairingErrorCode {
    return this.classifyConnectionFailure(error)
  }

  private async beginFailure(code: TelegramBeginPairingErrorCode): Promise<TelegramBeginPairingResult> {
    return Object.freeze({ ok: false, error: Object.freeze({ code }), status: await this.projectStatus(this.state()) })
  }

  private async enableFailure(code: TelegramEnableErrorCode): Promise<TelegramEnableResult> {
    return Object.freeze({ ok: false, error: Object.freeze({ code }), status: await this.projectStatus(this.state()) })
  }

  private async confirmFailure(
    code: 'candidate-missing' | 'candidate-expired' | 'candidate-mismatch' | 'service-stopping',
    state = this.state(),
  ): Promise<TelegramConfirmPairingResult> {
    return Object.freeze({ ok: false, error: Object.freeze({ code }), status: await this.projectStatus(state) })
  }

  private async setProxyFailure(
    code: 'invalid-proxy' | 'service-stopping',
  ): Promise<TelegramSetProxyResult> {
    return Object.freeze({ ok: false, error: Object.freeze({ code }), status: await this.projectStatus(this.state()) })
  }

  /** Public projection deliberately excludes token hash, webhook URL, and credential fingerprint. */
  private async projectStatus(state: TelegramDurableState): Promise<TelegramChannelStatus> {
    let credentialConfigured = false
    try {
      credentialConfigured = (await this.ctx.credentials.describe(TELEGRAM_BOT_TOKEN)).configured
    } catch (error) {
      // Cordis may tear down injected dependencies while this service is
      // joining an explicitly aborted control request. Only that lifecycle
      // path may use the conservative projection.
      if (!this.stopping) throw error
    }
    const pairing = this.pairingStatus(state)
    const processed = lastProcessedUpdateId(state.nextUpdateOffset)
    return Object.freeze({
      enabled: state.enabled,
      credentialConfigured,
      runtime: this.runtime.phase,
      pairing,
      ...(state.bot === undefined ? {} : { bot: state.bot }),
      ...(processed === undefined ? {} : { lastProcessedUpdateId: processed }),
      ...(this.runtime.retryAt === undefined ? {} : { retryAt: this.runtime.retryAt }),
      ...(this.runtime.pendingUpdateCount === undefined
        ? {}
        : { pendingUpdateCount: this.runtime.pendingUpdateCount }),
      ...(state.proxyUrl === undefined ? {} : { proxyUrl: state.proxyUrl }),
    })
  }

  private pairingStatus(state: TelegramDurableState): TelegramPairingStatus {
    if (state.binding !== undefined) {
      return Object.freeze({ kind: 'paired', account: publicBoundAccount(state.binding) })
    }
    if (state.pairing?.kind === 'waiting' && Date.now() < state.pairing.expiresAt) {
      return Object.freeze({ kind: 'waiting', expiresAt: state.pairing.expiresAt })
    }
    if (state.pairing?.kind === 'candidate' && Date.now() < state.pairing.candidate.expiresAt) {
      return Object.freeze({ kind: 'candidate', candidate: state.pairing.candidate })
    }
    return Object.freeze({ kind: 'unpaired' })
  }

  private state(): TelegramDurableState {
    if (this.domain === undefined) throw new Error('channel-telegram: durable domain is not initialized')
    return this.domain.global.get()
  }

  private async writeState(state: TelegramDurableState): Promise<void> {
    if (this.domain === undefined) throw new Error('channel-telegram: durable domain is not initialized')
    await this.domain.global.set(state)
  }

  /** Serialize every durable state transition, including post-admission offset movement. */
  private enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    if (this.stopping) return Promise.reject(new Error('channel-telegram: service is stopping'))
    const result = this.mutationTail.then(operation)
    this.mutationTail = result.then(() => undefined, () => undefined)
    return result
  }

  /** Serialize desktop control actions and credential-driven restarts. */
  private enqueueControl<T>(operation: () => Promise<T>): Promise<T> {
    if (this.stopping) return Promise.reject(new Error('channel-telegram: service is stopping'))
    const result = this.controlTail.then(operation)
    this.controlTail = result.then(() => undefined, () => undefined)
    return result
  }

  private shouldStop(signal: AbortSignal): boolean {
    return signal.aborted || this.stopping
  }
}

export default TelegramChannelService
