/**
 * Durable Agent consumer for authenticated text channels.
 * @module @deepseek-ai/dsh-channel-agent
 */

import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {
  ChannelAdmissionResult,
  ChannelConsumer,
  ChannelInboundMessage,
} from '@deepseek-ai/dsh-channel'
import {
  ChannelConversationId,
  ChannelError,
  ChannelExternalMessageId,
  ChannelSenderId,
} from '@deepseek-ai/dsh-channel'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { MessageSource } from '@deepseek-ai/dsh-llm'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type {} from '@deepseek-ai/dsh-permission-presets'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-tools'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { CHANNEL_HELP, parseChannelInput } from './command.ts'
import { Config, resolveConfig, type ResolvedConfig } from './config.ts'
import { DeliveryOutbox } from './delivery-outbox.ts'
import { channelAgentDomainSpec } from './spec.ts'
import { applyRemoteChannelToolPolicy } from './tool-policy.ts'
import {
  channelPromptSettlement,
  renderChannelPromptSettlement,
  type ChannelPromptSettlement,
} from './settlement.ts'
import type {
  ChannelAgentAdmissionIdentity,
  ChannelAgentAdmissionKey,
  ChannelAgentAdmissionRow,
  ChannelAgentConversationKey,
  ChannelAgentConversationRow,
  ChannelAgentDeliveryAbandonment,
  ChannelAgentProcessingAdmission,
  ChannelAgentPromptAdmission,
  ChannelAgentReplyAdmission,
  ChannelUserMessageSource,
} from './types.ts'

export { Config }
export { parseChannelInput, CHANNEL_HELP } from './command.ts'
export { channelAgentDomainSpec } from './spec.ts'
export { channelPromptSettlement, renderChannelPromptSettlement } from './settlement.ts'
export type * from './types.ts'

/** Cordis plugin name. */
export const name = 'channel-agent'
/** Services required by the channel Agent consumer. */
export const inject = [
  'agentDefaultModel',
  'agentPresets',
  'agents',
  'channel',
  'permissionPresets',
  'sessionPersistence',
  'sessions',
  'storageDomain',
  'tools',
  'workspaceRegistry',
]

/** Machine-routable consumer failure that never exposes model or credential data. */
export class ChannelAgentError extends Error {
  /** @param message - Human-readable failure. @param code - Stable failure code. */
  constructor(message: string, readonly code: string) {
    super(message)
    this.name = 'ChannelAgentError'
  }
}

/** Hash a provider-qualified identity into one storage-safe opaque key. */
function digest(parts: readonly string[]): string {
  const hash = createHash('sha256')
  for (const part of parts) {
    hash.update(String(Buffer.byteLength(part, 'utf8')))
    hash.update(':')
    hash.update(part)
    hash.update(';')
  }
  return hash.digest('hex')
}

/**
 * Derive the opaque sidecar key for one complete external conversation identity.
 * @param message - Complete external identity.
 * @returns Its conversation sidecar key.
 */
export function channelAgentConversationKeyOf(message: ChannelInboundMessage): ChannelAgentConversationKey {
  return channelAgentConversationKeyFromIdentity(message)
}

function channelAgentConversationKeyFromIdentity(
  identity: Pick<ChannelAgentAdmissionIdentity, 'provider' | 'conversationId' | 'senderId'>,
): ChannelAgentConversationKey {
  return `conversation-${digest([identity.provider, identity.conversationId, identity.senderId])}` as ChannelAgentConversationKey
}

/**
 * Derive the opaque idempotency key for one complete external message identity.
 * @param message - Complete external identity.
 * @returns Its idempotent admission key.
 */
export function channelAgentAdmissionKeyOf(message: ChannelInboundMessage): ChannelAgentAdmissionKey {
  return `admission-${digest([
    message.provider,
    message.conversationId,
    message.senderId,
    message.externalMessageId,
  ])}` as ChannelAgentAdmissionKey
}

/** @param message - Inbound text. @returns a collision-detecting text digest. */
function textDigest(message: ChannelInboundMessage): string {
  return digest([message.text])
}

function sourceConversationId(identity: ChannelAgentAdmissionIdentity): ChannelConversationId {
  return ChannelConversationId(`sha256:${digest([
    'channel-source-conversation-v1',
    identity.provider,
    identity.conversationId,
  ])}`)
}

function sourceSenderId(identity: ChannelAgentAdmissionIdentity): ChannelSenderId {
  return ChannelSenderId(`sha256:${digest([
    'channel-source-sender-v1',
    identity.provider,
    identity.senderId,
  ])}`)
}

function sourceExternalMessageId(identity: ChannelAgentAdmissionIdentity): ChannelExternalMessageId {
  return ChannelExternalMessageId(`sha256:${digest([
    'channel-source-message-v1',
    identity.provider,
    identity.conversationId,
    identity.senderId,
    identity.externalMessageId,
  ])}`)
}

function sameExternalIdentity(row: ChannelAgentAdmissionRow, message: ChannelInboundMessage): boolean {
  return row.provider === message.provider
    && row.conversationId === message.conversationId
    && row.senderId === message.senderId
    && row.externalMessageId === message.externalMessageId
    && row.textDigest === textDigest(message)
}

function sameChannelSource(source: MessageSource, identity: ChannelAgentAdmissionIdentity): boolean {
  return source.kind === 'user'
    && 'channel' in source
    && source.provider === identity.provider
    && source.conversationId === sourceConversationId(identity)
    && source.senderId === sourceSenderId(identity)
    && source.externalMessageId === sourceExternalMessageId(identity)
}

function identityOf(message: ChannelInboundMessage, admittedAt: number): ChannelAgentAdmissionIdentity {
  return {
    provider: message.provider,
    conversationId: message.conversationId,
    senderId: message.senderId,
    externalMessageId: message.externalMessageId,
    textDigest: textDigest(message),
    admittedAt,
  }
}

function conversationOf(message: ChannelInboundMessage): ChannelAgentConversationRow {
  return {
    provider: message.provider,
    conversationId: message.conversationId,
    senderId: message.senderId,
    sessionIds: [],
  }
}

function promptBytes(text: string): number {
  return Buffer.byteLength(text, 'utf8')
}

type ConversationTable = KvTable<ChannelAgentConversationKey, ChannelAgentConversationRow>
type AdmissionTable = KvTable<ChannelAgentAdmissionKey, ChannelAgentAdmissionRow>

interface PreparedPromptDelivery {
  readonly row: ChannelAgentPromptAdmission
  readonly text: string
}

/** Convert arbitrary failures to a contained diagnostic without including message content. */
function renderFailure(error: unknown): string {
  if (error instanceof ChannelAgentError) return error.code
  if (error instanceof Error) return error.name
  return typeof error
}

function deliveryAbandonment(error: unknown): ChannelAgentDeliveryAbandonment | undefined {
  if (!(error instanceof ChannelError)) return undefined
  switch (error.code) {
    case 'CHANNEL_TELEGRAM_ROUTE_EXPIRED': return error.code
    case 'CHANNEL_TELEGRAM_TEXT_TOO_LONG': return error.code
    default: return undefined
  }
}

function deliveryPending(row: ChannelAgentPromptAdmission | ChannelAgentReplyAdmission): boolean {
  return !row.delivered && row.deliveryAbandoned === undefined
}

/** One keyed serial queue whose returned operation retains its own result. */
function enqueue<K, T>(
  tails: Map<K, Promise<void>>,
  key: K,
  operation: () => Promise<T>,
): Promise<T> {
  const predecessor = tails.get(key) ?? Promise.resolve()
  const result = predecessor.then(operation, operation)
  const tail = result.then(() => {}, () => {})
  tails.set(key, tail)
  void tail.finally(() => {
    if (tails.get(key) === tail) tails.delete(key)
  })
  return result
}

/** Stateful consumer over one opened storage domain. */
class ChannelAgentRuntime implements ChannelConsumer {
  private readonly config: ResolvedConfig
  private readonly lifecycle = new AbortController()
  private readonly deliveryOutbox: DeliveryOutbox<ChannelAgentAdmissionKey>
  private readonly admissionTails = new Map<ChannelAgentAdmissionKey, Promise<void>>()
  private readonly conversationTails = new Map<ChannelAgentConversationKey, Promise<void>>()
  private readonly processingRecoveries = new Map<
    ChannelAgentAdmissionKey,
    Promise<ChannelAgentPromptAdmission | undefined>
  >()
  private readonly completions = new Map<ChannelAgentAdmissionKey, Promise<void>>()
  private readonly activePromptReservations = new Map<ChannelAgentConversationKey, Set<ChannelAgentAdmissionKey>>()
  private readonly handles = new Map<SessionId, AgentHandle>()
  private closing = false

  constructor(
    private readonly ctx: Context,
    config: Config,
    private readonly conversations: ConversationTable,
    private readonly admissions: AdmissionTable,
  ) {
    this.config = resolveConfig(config)
    this.deliveryOutbox = new DeliveryOutbox({
      signal: this.lifecycle.signal,
      retry: {
        initialDelayMs: this.config.deliveryRetryInitialMs,
        maxDelayMs: this.config.deliveryRetryMaxMs,
      },
      onRetry: (notice) => {
        this.ctx.logger.warn(
          'channel-agent delivery retry %s: %s',
          notice.phase,
          notice.failure,
        )
      },
    })
  }

  /** Validate local references before accepting a transport message. */
  async validateConfiguration(): Promise<void> {
    await this.ctx.agentPresets.resolve(this.config.agentPreset)
    this.ctx.permissionPresets.resolve(this.config.permissionPreset)
  }

  /** Recover undelivered durable responses without blocking plugin readiness. */
  recover(): void {
    for (const [key, row] of this.admissions.entries()) {
      if (row.kind === 'processing') this.startProcessingRecovery(key, row)
      if (row.kind === 'prompt' && deliveryPending(row)) this.startCompletion(key, row)
      if (row.kind === 'reply' && deliveryPending(row)) {
        this.startBackground(key, () => this.deliverReply(key, row))
      }
    }
  }

  /**
   * Reserve and commit one external identity exactly once.
   * @param message - Authenticated normalized provider text.
   * @param signal - Provider-operation cancellation before admission.
   * @returns accepted only after sidecar and prompt-log durability; duplicate after a prior commit is known.
   */
  async admit(message: ChannelInboundMessage, signal: AbortSignal): Promise<ChannelAdmissionResult> {
    if (this.closing) {
      throw new ChannelAgentError('channel Agent consumer is closing', 'CHANNEL_AGENT_CLOSING')
    }
    signal.throwIfAborted()
    const admissionKey = channelAgentAdmissionKeyOf(message)
    return await enqueue(this.admissionTails, admissionKey, async () => {
      if (this.closing) {
        throw new ChannelAgentError('channel Agent consumer is closing', 'CHANNEL_AGENT_CLOSING')
      }
      signal.throwIfAborted()
      let stored = this.admissions.get(admissionKey)
      if (stored?.kind === 'processing') {
        await this.processingRecoveries.get(admissionKey)
        stored = this.admissions.get(admissionKey)
      }
      if (stored !== undefined && !sameExternalIdentity(stored, message)) {
        throw new ChannelAgentError(
          'a channel provider reused an external message id for different content or identity',
          'CHANNEL_AGENT_EXTERNAL_ID_CONFLICT',
        )
      }
      if (stored?.kind === 'prompt') {
        if (deliveryPending(stored)) this.startCompletion(admissionKey, stored)
        return { kind: 'duplicate' }
      }
      if (stored?.kind === 'reply') {
        if (deliveryPending(stored)) {
          this.startBackground(admissionKey, () => this.deliverReply(admissionKey, stored))
        }
        return { kind: 'duplicate' }
      }

      const identity = stored ?? { ...identityOf(message, Date.now()), kind: 'processing' as const }
      if (stored === undefined) await this.admissions.put(admissionKey, identity)
      const conversationKey = channelAgentConversationKeyOf(message)
      const committed = await enqueue(this.conversationTails, conversationKey, async () =>
        await this.process(message, admissionKey, conversationKey, identity))
      await this.admissions.put(admissionKey, committed)
      if (committed.kind === 'reply') {
        this.startBackground(admissionKey, () => this.deliverReply(admissionKey, committed))
      }
      else this.startCompletion(admissionKey, committed)
      return { kind: 'accepted' }
    })
  }

  /** Stop admission, abort observers/deliveries, and await every owned asynchronous operation. */
  async close(): Promise<void> {
    if (this.closing) return
    this.closing = true
    this.lifecycle.abort(new Error('channel Agent consumer disposed'))
    await Promise.allSettled([
      ...this.admissionTails.values(),
      ...this.conversationTails.values(),
      ...this.processingRecoveries.values(),
      ...this.completions.values(),
    ])
    await this.deliveryOutbox.drain()
    const handles = [...this.handles.values()]
    this.handles.clear()
    await Promise.allSettled(handles.map(async (handle) => { await handle.dispose() }))
  }

  private async process(
    message: ChannelInboundMessage,
    admissionKey: ChannelAgentAdmissionKey,
    conversationKey: ChannelAgentConversationKey,
    identity: ChannelAgentAdmissionIdentity,
  ): Promise<ChannelAgentPromptAdmission | ChannelAgentReplyAdmission> {
    const input = parseChannelInput(message.text)
    if (input.kind === 'unknown-command') {
      return this.reply(identity, `Unknown command /${input.name}.\n\n${CHANNEL_HELP}`)
    }
    if (input.kind === 'prompt') {
      return await this.admitPrompt(message, admissionKey, conversationKey, identity, input.text, false)
    }
    switch (input.name) {
      case 'help': return this.reply(identity, CHANNEL_HELP)
      case 'sessions': return this.reply(identity, this.listSessions(message, conversationKey))
      case 'use': return this.reply(identity, await this.useSession(message, conversationKey, input.input))
      case 'status': return this.reply(identity, await this.status(message, conversationKey))
      case 'stop': return this.reply(identity, await this.stop(message, conversationKey))
      case 'new': {
        const text = input.input.trim()
        if (text.length === 0) {
          const current = this.conversations.get(conversationKey) ?? conversationOf(message)
          if (this.hasRunningTask(conversationKey, current)) {
            return this.reply(identity, 'A task is already running. Use /status or /stop before starting another.')
          }
          let session: Agent
          try {
            session = await this.createAndSelect(message, admissionKey, conversationKey)
          } catch (error: unknown) {
            const failure = this.creationFailure(error)
            if (failure !== undefined) return this.reply(identity, failure)
            throw error
          }
          const row = this.requireConversation(conversationKey, message)
          return this.reply(identity, `New session selected (#${row.sessionIds.indexOf(session.id) + 1}).`)
        }
        return await this.admitPrompt(message, admissionKey, conversationKey, identity, text, true)
      }
      default: return this.reply(identity, CHANNEL_HELP)
    }
  }

  private reply(identity: ChannelAgentAdmissionIdentity, replyText: string): ChannelAgentReplyAdmission {
    return { ...identity, kind: 'reply', replyText, delivered: false }
  }

  private async admitPrompt(
    message: ChannelInboundMessage,
    admissionKey: ChannelAgentAdmissionKey,
    conversationKey: ChannelAgentConversationKey,
    identity: ChannelAgentAdmissionIdentity,
    rawText: string,
    forceNew: boolean,
  ): Promise<ChannelAgentPromptAdmission | ChannelAgentReplyAdmission> {
    const text = rawText.trim()
    if (text.length === 0) {
      return this.reply(identity, 'Task text must not be empty.')
    }
    const actualBytes = promptBytes(text)
    if (actualBytes > this.config.maxInputBytes) {
      return this.reply(
        identity,
        `Task is too large (${actualBytes} bytes; maximum ${this.config.maxInputBytes}).`,
      )
    }
    const before = this.conversations.get(conversationKey) ?? conversationOf(message)
    if (this.hasRunningTask(conversationKey, before)) {
      return this.reply(identity, 'A task is already running. Use /status or /stop before starting another.')
    }
    let agent: Agent
    try {
      if (forceNew) {
        agent = await this.createAndSelect(message, admissionKey, conversationKey)
      } else {
        const conversation = this.conversations.get(conversationKey) ?? conversationOf(message)
        agent = conversation.activeSessionId === undefined
          ? await this.createAndSelect(message, admissionKey, conversationKey)
          : await this.materialize(conversation.activeSessionId)
      }
    } catch (error: unknown) {
      if (!forceNew && error instanceof ChannelAgentError
        && error.code === 'CHANNEL_AGENT_UNSAFE_PRESET') {
        try {
          // A legacy channel session may carry local-capability prompt context
          // or tool results. Never replay it; migrate this admission to a new,
          // deterministic remote-safe session instead.
          agent = await this.createAndSelect(message, admissionKey, conversationKey)
        } catch (migrationError: unknown) {
          const failure = this.creationFailure(migrationError)
          if (failure !== undefined) return this.reply(identity, failure)
          throw migrationError
        }
      } else {
        const failure = this.creationFailure(error)
        if (failure !== undefined) return this.reply(identity, failure)
        throw error
      }
    }
    const source: ChannelUserMessageSource = {
      kind: 'user',
      channel: 'external',
      provider: message.provider,
      conversationId: sourceConversationId(identity),
      senderId: sourceSenderId(identity),
      externalMessageId: sourceExternalMessageId(identity),
    }
    const userMessage = createUserMessage({ content: [{ type: 'text', text }], source })
    agent.followup(userMessage)
    await this.ctx.sessions.flush(agent.session)
    return {
      ...identity,
      kind: 'prompt',
      sessionId: agent.id,
      messageId: userMessage.id,
      delivered: false,
    }
  }

  private async createAndSelect(
    message: ChannelInboundMessage,
    admissionKey: ChannelAgentAdmissionKey,
    conversationKey: ChannelAgentConversationKey,
  ): Promise<Agent> {
    const prefixLength = 'admission-'.length
    const sessionId = SessionId(`session-channel-${String(admissionKey).slice(prefixLength, prefixLength + 48)}`)
    const current = this.conversations.get(conversationKey) ?? conversationOf(message)
    if (!current.sessionIds.includes(sessionId)) {
      if (current.sessionIds.length >= this.config.maxSessionsPerConversation) {
        throw new ChannelAgentError(
          `this conversation already has ${this.config.maxSessionsPerConversation} sessions`,
          'CHANNEL_AGENT_SESSION_LIMIT',
        )
      }
      const next: ChannelAgentConversationRow = {
        ...current,
        sessionIds: [sessionId, ...current.sessionIds],
        activeSessionId: sessionId,
      }
      await this.conversations.put(conversationKey, next)
    } else if (current.activeSessionId !== sessionId) {
      await this.conversations.put(conversationKey, { ...current, activeSessionId: sessionId })
    }
    return await this.materialize(sessionId)
  }

  private async materialize(sessionId: SessionId, requirePersisted = false): Promise<Agent> {
    const live = this.ctx.agents.get(sessionId)
    if (live !== undefined) {
      if (live.session.header.agentPreset !== this.config.agentPreset) {
        throw new ChannelAgentError(
          'stored channel session uses a preset that is not remote-safe',
          'CHANNEL_AGENT_UNSAFE_PRESET',
        )
      }
      this.ctx.permissionPresets.set(live.session, this.config.permissionPreset)
      await this.ctx.sessions.flush(live.session)
      return live
    }
    const workspace = this.config.workspaceId === undefined
      ? this.ctx.workspaceRegistry.list()[0]
      : this.ctx.workspaceRegistry.get(WorkspaceId(this.config.workspaceId))
    if (workspace === undefined) {
      throw new ChannelAgentError('configured channel workspace does not exist', 'CHANNEL_AGENT_WORKSPACE_MISSING')
    }
    const headers = await this.ctx.sessionPersistence.list()
    const persisted = headers.find(header => header.id === sessionId)
    if (persisted === undefined && requirePersisted) {
      throw new ChannelAgentError(
        'the durable channel admission refers to a missing session',
        'CHANNEL_AGENT_SESSION_MISSING',
      )
    }
    if (persisted !== undefined && persisted.agentPreset !== this.config.agentPreset) {
      throw new ChannelAgentError(
        'stored channel session uses a preset that is not remote-safe',
        'CHANNEL_AGENT_UNSAFE_PRESET',
      )
    }
    const selection = this.ctx.agentDefaultModel.currentSelection()
    let handle: AgentHandle
    if (persisted === undefined) {
      const preset = await this.ctx.agentPresets.resolve(this.config.agentPreset)
      handle = await this.ctx.agents.create({
        sessionId,
        meta: { cwd: workspace.path, agentPreset: preset.id },
        agentOptions: { provider: selection.provider, model: selection.model },
        setup: async (agentCtx) => { await this.setupAgent(agentCtx, preset.id) },
      })
      await workspace.attachSession(sessionId)
    } else {
      if (persisted.cwd !== workspace.path) {
        throw new ChannelAgentError('stored channel session belongs to another workspace', 'CHANNEL_AGENT_WORKSPACE_MISMATCH')
      }
      handle = await this.ctx.agents.resume({
        resumeSessionId: sessionId,
        agentOptions: { provider: selection.provider, model: selection.model },
        setup: async (agentCtx) => { await this.setupAgent(agentCtx, this.config.agentPreset) },
      })
    }
    this.ctx.permissionPresets.set(handle.agent.session, this.config.permissionPreset)
    await this.ctx.sessions.flush(handle.agent.session)
    this.handles.set(sessionId, handle)
    return handle.agent
  }

  private async setupAgent(agentCtx: Context, presetId: string): Promise<void> {
    await this.ctx.agentPresets.mount(agentCtx, presetId)
    applyRemoteChannelToolPolicy(agentCtx)
    const agent = agentCtx.agent
    if (agent === undefined) {
      throw new ChannelAgentError('channel Agent setup has no scoped Agent', 'CHANNEL_AGENT_SETUP_MISSING')
    }
    this.ctx.permissionPresets.set(agent.session, this.config.permissionPreset)
  }

  private listSessions(
    message: ChannelInboundMessage,
    conversationKey: ChannelAgentConversationKey,
  ): string {
    const row = this.conversations.get(conversationKey) ?? conversationOf(message)
    if (row.sessionIds.length === 0) return 'No channel sessions yet. Send text or use /new to create one.'
    const lines = row.sessionIds.map((sessionId, index) => {
      const marker = row.activeSessionId === sessionId ? ' • selected' : ''
      const running = this.ctx.agents.get(sessionId)?.status === 'running' ? ' • running' : ''
      return `${index + 1}. Session ${index + 1}${marker}${running}`
    })
    return ['Channel sessions:', ...lines, '', 'Use /use <number> to select one.'].join('\n')
  }

  private async useSession(
    message: ChannelInboundMessage,
    conversationKey: ChannelAgentConversationKey,
    input: string,
  ): Promise<string> {
    const raw = input.trim()
    if (!/^[1-9][0-9]*$/u.test(raw)) return 'Usage: /use <number>'
    const index = Number(raw) - 1
    const current = this.conversations.get(conversationKey) ?? conversationOf(message)
    const sessionId = current.sessionIds[index]
    if (sessionId === undefined) return `No session ${raw}. Use /sessions to list available sessions.`
    await this.conversations.put(conversationKey, { ...current, activeSessionId: sessionId })
    return `Session ${raw} selected.`
  }

  private async status(
    message: ChannelInboundMessage,
    conversationKey: ChannelAgentConversationKey,
  ): Promise<string> {
    const current = this.conversations.get(conversationKey) ?? conversationOf(message)
    const runningSession = this.runningSession(current)
    if (runningSession !== undefined) {
      const index = current.sessionIds.indexOf(runningSession) + 1
      return `A channel task is running in session ${index}.`
    }
    if (this.activePromptReservations.has(conversationKey)) {
      return 'A channel task is starting, finishing, or being recovered.'
    }
    const sessionId = current.activeSessionId
    if (sessionId === undefined) return 'No selected session. Send text or use /new.'
    const live = this.ctx.agents.get(sessionId)
    if (live?.status === 'running') return 'Selected task is running.'
    const latest = this.latestPrompt(message, sessionId)
    if (latest === undefined) return 'Selected session is ready for a task.'
    let events: readonly SessionEvent[]
    try {
      events = await this.eventsOf(sessionId)
    } catch {
      return 'Selected task status is temporarily unavailable. Try again or open the desktop app.'
    }
    const settlement = channelPromptSettlement(events, latest.messageId)
    if (settlement === undefined) return 'Selected task is queued or awaiting desktop attention.'
    switch (settlement.reason.kind) {
      case 'completed': return 'Selected task completed.'
      case 'max-tokens': return 'Selected task ended at its output limit.'
      case 'blocked': return 'Selected task needs attention in the desktop app.'
      case 'error': return 'Selected task failed. Open the desktop app for details.'
      case 'interrupted': return 'Selected task was interrupted by a desktop restart.'
      case 'aborted': return settlement.reason.reason.kind === 'user'
        ? 'Selected task was stopped.'
        : 'Selected task stopped in the desktop app.'
      default: return 'Selected task ended. Open the desktop app for details.'
    }
  }

  private async stop(
    message: ChannelInboundMessage,
    conversationKey: ChannelAgentConversationKey,
  ): Promise<string> {
    const current = this.conversations.get(conversationKey) ?? conversationOf(message)
    const sessionId = current.activeSessionId
    if (sessionId === undefined) return 'No selected session.'
    const selected = this.ctx.agents.get(sessionId)
    const agent = selected?.status === 'running'
      ? selected
      : this.ctx.agents.get(this.runningSession(current) ?? sessionId)
    if (agent === undefined || agent.status !== 'running') return 'Selected task is not running.'
    agent.cancel({ kind: 'user' }, { keepInbox: false })
    await agent.whenIdle()
    await this.ctx.sessions.flush(agent.session)
    return 'Stop requested.'
  }

  private runningSession(row: ChannelAgentConversationRow): SessionId | undefined {
    return row.sessionIds.find((sessionId) => {
      const agent = this.ctx.agents.get(sessionId)
      return agent?.status === 'running'
        && agent.session.header.agentPreset === this.config.agentPreset
    })
  }

  private hasRunningTask(
    conversationKey: ChannelAgentConversationKey,
    row: ChannelAgentConversationRow,
  ): boolean {
    return this.activePromptReservations.has(conversationKey) || this.runningSession(row) !== undefined
  }

  private creationFailure(error: unknown): string | undefined {
    if (!(error instanceof ChannelAgentError)) return undefined
    if (error.code === 'CHANNEL_AGENT_WORKSPACE_MISSING') {
      return 'No workspace is available. Add a workspace in the desktop app, then try again.'
    }
    if (error.code === 'CHANNEL_AGENT_SESSION_LIMIT') {
      return `${error.message}. Use /sessions and /use <number> to continue an existing session.`
    }
    if (error.code === 'CHANNEL_AGENT_WORKSPACE_MISMATCH'
      || error.code === 'CHANNEL_AGENT_PRESET_MISSING'
      || error.code === 'CHANNEL_AGENT_UNSAFE_PRESET') {
      return 'The selected session cannot be resumed safely. Open the desktop app for details.'
    }
    return undefined
  }

  private latestPrompt(message: ChannelInboundMessage, sessionId: SessionId): ChannelAgentPromptAdmission | undefined {
    let latest: ChannelAgentPromptAdmission | undefined
    for (const [, row] of this.admissions.entries()) {
      if (row.kind !== 'prompt' || row.sessionId !== sessionId) continue
      if (row.provider !== message.provider || row.conversationId !== message.conversationId
        || row.senderId !== message.senderId) continue
      if (latest === undefined || row.admittedAt > latest.admittedAt) latest = row
    }
    return latest
  }

  private requireConversation(
    key: ChannelAgentConversationKey,
    message: ChannelInboundMessage,
  ): ChannelAgentConversationRow {
    return this.conversations.get(key) ?? conversationOf(message)
  }

  private async eventsOf(sessionId: SessionId): Promise<readonly SessionEvent[]> {
    const live = this.ctx.sessions.get(sessionId)
    if (live !== undefined) return live.events
    return (await this.ctx.sessionPersistence.inspect(sessionId, this.lifecycle.signal)).events
  }

  private startProcessingRecovery(
    key: ChannelAgentAdmissionKey,
    row: ChannelAgentProcessingAdmission,
  ): void {
    if (this.closing || this.processingRecoveries.has(key)) return
    const conversationKey = channelAgentConversationKeyFromIdentity(row)
    const reservations = this.reservePrompt(conversationKey, key)
    const recovery = this.recoverProcessing(key, row).finally(() => {
      this.releasePrompt(conversationKey, key, reservations)
      if (this.processingRecoveries.get(key) === recovery) this.processingRecoveries.delete(key)
    })
    this.processingRecoveries.set(key, recovery)
    void recovery.then((prompt) => {
      if (prompt !== undefined) this.startCompletion(key, prompt)
    }).catch((error: unknown) => {
      if (!this.lifecycle.signal.aborted) {
        this.ctx.logger.warn('channel-agent processing recovery failed: %s', renderFailure(error))
      }
    })
  }

  private async recoverProcessing(
    key: ChannelAgentAdmissionKey,
    row: ChannelAgentProcessingAdmission,
  ): Promise<ChannelAgentPromptAdmission | undefined> {
    const conversationKey = channelAgentConversationKeyFromIdentity(row)
    const conversation = this.conversations.get(conversationKey)
    if (conversation === undefined) return undefined
    const persisted = new Set((await this.ctx.sessionPersistence.list()).map(header => header.id))
    const matches = new Map<MessageId, SessionId>()
    for (const sessionId of conversation.sessionIds) {
      const live = this.ctx.sessions.get(sessionId)
      if (live === undefined && !persisted.has(sessionId)) continue
      const events = live?.events
        ?? (await this.ctx.sessionPersistence.inspect(sessionId, this.lifecycle.signal)).events
      for (const event of events) {
        if (event.type !== 'agent/inbox/spliced') continue
        for (const message of event.data.inserted) {
          if (sameChannelSource(message.source, row)) matches.set(message.id, sessionId)
        }
      }
    }
    if (matches.size === 0) return undefined
    if (matches.size !== 1) {
      throw new ChannelAgentError(
        'a processing channel admission maps to more than one durable inbox message',
        'CHANNEL_AGENT_PROCESSING_CONFLICT',
      )
    }
    const [messageId, sessionId] = matches.entries().next().value as [MessageId, SessionId]
    const prompt: ChannelAgentPromptAdmission = {
      ...row,
      kind: 'prompt',
      sessionId,
      messageId,
      delivered: false,
    }
    await this.admissions.put(key, prompt)
    return prompt
  }

  private reservePrompt(
    conversationKey: ChannelAgentConversationKey,
    key: ChannelAgentAdmissionKey,
  ): Set<ChannelAgentAdmissionKey> {
    const reservations = this.activePromptReservations.get(conversationKey) ?? new Set<ChannelAgentAdmissionKey>()
    reservations.add(key)
    this.activePromptReservations.set(conversationKey, reservations)
    return reservations
  }

  private releasePrompt(
    conversationKey: ChannelAgentConversationKey,
    key: ChannelAgentAdmissionKey,
    reservations: Set<ChannelAgentAdmissionKey>,
  ): void {
    reservations.delete(key)
    if (reservations.size === 0 && this.activePromptReservations.get(conversationKey) === reservations) {
      this.activePromptReservations.delete(conversationKey)
    }
  }

  private startCompletion(key: ChannelAgentAdmissionKey, row: ChannelAgentPromptAdmission): void {
    if (this.closing || this.completions.has(key)) return
    const conversationKey = channelAgentConversationKeyFromIdentity(row)
    const reservations = this.reservePrompt(conversationKey, key)
    this.startBackground(key, async () => {
      let prepared: PreparedPromptDelivery | undefined
      try {
        prepared = await this.preparePromptDelivery(key, row)
      } finally {
        this.releasePrompt(conversationKey, key, reservations)
      }
      if (prepared !== undefined) {
        await this.deliverPromptText(key, prepared.row, prepared.text)
      }
    })
  }

  private startBackground(key: ChannelAgentAdmissionKey, operation: () => Promise<void>): void {
    if (this.closing || this.completions.has(key)) return
    const tracked = operation().catch((error: unknown) => {
      if (!this.lifecycle.signal.aborted) {
        this.ctx.logger.warn('channel-agent background delivery failed: %s', renderFailure(error))
      }
    }).finally(() => {
      if (this.completions.get(key) === tracked) this.completions.delete(key)
    })
    this.completions.set(key, tracked)
  }

  private async preparePromptDelivery(
    key: ChannelAgentAdmissionKey,
    row: ChannelAgentPromptAdmission,
  ): Promise<PreparedPromptDelivery | undefined> {
    if (row.failureText !== undefined) {
      return { row, text: row.failureText }
    }
    let live
    try {
      live = this.ctx.sessions.get(row.sessionId)
      if (live !== undefined && live.header.agentPreset !== this.config.agentPreset) {
        throw new ChannelAgentError(
          'stored channel session uses a preset that is not remote-safe',
          'CHANNEL_AGENT_UNSAFE_PRESET',
        )
      }
      if (live === undefined) {
        live = (await this.materialize(row.sessionId, true)).session
      }
    } catch (error: unknown) {
      if (!(error instanceof ChannelAgentError)
        || ![
          'CHANNEL_AGENT_SESSION_MISSING',
          'CHANNEL_AGENT_WORKSPACE_MISMATCH',
          'CHANNEL_AGENT_PRESET_MISSING',
          'CHANNEL_AGENT_UNSAFE_PRESET',
        ].includes(error.code)) throw error
      const current = this.admissions.get(key)
      if (current?.kind !== 'prompt' || current.messageId !== row.messageId || !deliveryPending(current)) {
        return undefined
      }
      const failureText = 'Task could not be resumed safely. Open the desktop app for details.'
      const failed: ChannelAgentPromptAdmission = {
        ...current,
        failureText,
        delivered: false,
      }
      await this.admissions.put(key, failed)
      return { row: failed, text: failureText }
    }
    const settlement = channelPromptSettlement(live.events, row.messageId)
      ?? await this.waitForSettlement(live, row.messageId)
    await this.ctx.sessions.flush(live)
    const current = this.admissions.get(key)
    if (current?.kind !== 'prompt' || current.messageId !== row.messageId || !deliveryPending(current)) {
      return undefined
    }
    const settled: ChannelAgentPromptAdmission = { ...current, turn: settlement.turn, delivered: false }
    await this.admissions.put(key, settled)
    return { row: settled, text: renderChannelPromptSettlement(settlement) }
  }

  private async deliverPromptText(
    key: ChannelAgentAdmissionKey,
    row: ChannelAgentPromptAdmission,
    text: string,
  ): Promise<void> {
    if (!deliveryPending(row)) return
    await this.deliveryOutbox.run(key, async (signal) => {
      await this.deliverDurable(key, row, text, signal)
    })
  }

  private async deliverReply(key: ChannelAgentAdmissionKey, row: ChannelAgentReplyAdmission): Promise<void> {
    if (!deliveryPending(row)) return
    await this.deliveryOutbox.run(key, async (signal) => {
      await this.deliverDurable(key, row, row.replyText, signal)
    })
  }

  /**
   * Send and then persist one result as a single retry unit. Provider send and
   * local marker persistence cannot be atomic, so a crash or marker failure
   * after a successful send may produce an at-least-once duplicate.
   */
  private async deliverDurable(
    key: ChannelAgentAdmissionKey,
    row: ChannelAgentPromptAdmission | ChannelAgentReplyAdmission,
    text: string,
    signal: AbortSignal,
  ): Promise<void> {
    const current = this.admissions.get(key)
    if (!this.sameDelivery(current, row) || !deliveryPending(current)) return
    try {
      await this.ctx.channel.deliver({
        provider: current.provider,
        conversationId: current.conversationId,
        replyTo: current.externalMessageId,
        text,
      }, signal)
    } catch (error: unknown) {
      const abandoned = deliveryAbandonment(error)
      if (abandoned === undefined) throw error
      const latest = this.admissions.get(key)
      if (this.sameDelivery(latest, row) && deliveryPending(latest)) {
        await this.admissions.put(key, { ...latest, deliveryAbandoned: abandoned })
      }
      return
    }
    const latest = this.admissions.get(key)
    if (this.sameDelivery(latest, row) && deliveryPending(latest)) {
      await this.admissions.put(key, { ...latest, delivered: true })
    }
  }

  private sameDelivery(
    current: ChannelAgentAdmissionRow | undefined,
    expected: ChannelAgentPromptAdmission | ChannelAgentReplyAdmission,
  ): current is ChannelAgentPromptAdmission | ChannelAgentReplyAdmission {
    if (current?.kind !== expected.kind) return false
    return current.kind === 'reply'
      || (expected.kind === 'prompt' && current.messageId === expected.messageId)
  }

  private waitForSettlement(session: Session, messageId: MessageId): Promise<ChannelPromptSettlement> {
    const existing = channelPromptSettlement(session.events, messageId)
    if (existing !== undefined) return Promise.resolve(existing)
    return new Promise<ChannelPromptSettlement>((resolve, reject) => {
      let settled = false
      const finish = (result: ChannelPromptSettlement | Error): void => {
        if (settled) return
        settled = true
        this.lifecycle.signal.removeEventListener('abort', onAbort)
        void dispose()
        if (result instanceof Error) reject(result)
        else resolve(result)
      }
      const check = (): void => {
        const result = channelPromptSettlement(session.events, messageId)
        if (result !== undefined) finish(result)
      }
      const onAbort = (): void => {
        const reason: unknown = this.lifecycle.signal.reason
        finish(reason instanceof Error ? reason : new Error('channel Agent consumer disposed'))
      }
      const dispose = this.ctx.on('session/event', (changed) => {
        if (changed === session) check()
      })
      this.lifecycle.signal.addEventListener('abort', onAbort, { once: true })
      check()
      if (this.lifecycle.signal.aborted) onAbort()
    })
  }
}

/**
 * Open the sidecar domain and register the sole Agent consumer.
 * @param ctx - Host context carrying Agent, session, workspace, policy, storage, and channel services.
 * @param config - Local-only workspace, preset, permission, and bound policies.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const domain = await ctx.storageDomain.open(channelAgentDomainSpec)
  const runtime = new ChannelAgentRuntime(
    ctx,
    config,
    domain.table('conversations'),
    domain.table('admissions'),
  )
  try {
    await runtime.validateConfiguration()
    const unregister = ctx.channel.registerConsumer(runtime)
    ctx.effect(() => async () => {
      unregister()
      await runtime.close()
      await domain.close()
    }, 'channel-agent.lifecycle')
    runtime.recover()
  } catch (error: unknown) {
    await domain.close()
    throw error
  }
}
