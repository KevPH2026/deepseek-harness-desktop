/** Safe renderer state for Telegram settings. Secret values are intentionally absent. */

import type {
  IApiClient,
  TelegramBeginPairingResult,
  TelegramBoundAccount,
  TelegramChannelStatus,
  TelegramConfirmPairingRequest,
  TelegramConfirmPairingResult,
  TelegramEnableResult,
  TelegramPairingCandidate,
  TelegramRuntimePhase,
  TelegramSetProxyRequest,
  TelegramSetProxyResult,
} from '@deepseek-ai/dsh-api-remotes/client'
import {
  createSnapshotStore, type SnapshotStore,
} from '@deepseek-ai/dsh-client-runtime/client'

/** Write-only credential reference owned by the Telegram Host provider. */
export const TELEGRAM_BOT_TOKEN_REF = 'TELEGRAM_BOT_TOKEN'

/** Telegram transport lifecycle safe to render. */
export type TelegramRuntimeStatus =
  | 'disabled'
  | 'starting'
  | 'online'
  | 'offline'
  | 'backlog-pending'
  | 'error'

/** One exact Telegram private-chat identity. */
export interface TelegramAccountIdentity {
  /** Opaque Host binding or candidate id. */
  id: string
  /** Exact Telegram numeric user id, represented losslessly as text. */
  userId: string
  /** Exact Telegram numeric private-chat id, represented losslessly as text. */
  chatId: string
  /** Optional mutable Telegram username, display-only. */
  username?: string
  /** Optional mutable Telegram display name, display-only. */
  displayName?: string
  /** ISO timestamp for an established binding. */
  pairedAt?: number
}

/** One short-lived link minted by the Host for desktop-mediated pairing. */
export interface TelegramPairingLink {
  /** Telegram deep link containing the one-time pair code. */
  url: string
  /** Human-readable one-time code. */
  code: string
  /** Optional ISO expiry timestamp. */
  expiresAt?: number
}

/** Write-only credential metadata returned by `credentials.describe`. */
export interface TelegramCredentialState {
  /** Host credential reference; never a credential value. */
  ref: string
  /** Credential lookup state. */
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** Whether any Host credential layer supplies the Bot Token. */
  configured: boolean
  /** Whether the active provider accepts set/unset. */
  writable: boolean
}

/** Telegram operation currently crossing the Host boundary. */
export type TelegramSettingsAction =
  | 'idle'
  | 'refreshing'
  | 'saving-token'
  | 'removing-token'
  | 'saving-proxy'
  | 'enabling'
  | 'disabling'
  | 'beginning-pairing'
  | 'confirming-pairing'
  | 'revoking-binding'

/** Localized error category. Raw transport errors are deliberately not rendered. */
export type TelegramSettingsError =
  | 'load'
  | 'refresh'
  | 'token-save'
  | 'token-remove'
  | 'proxy-save'
  | 'enable'
  | 'disable'
  | 'pairing'
  | 'backlog-pending'
  | 'confirm'
  | 'revoke'

/** Last successful mutation, used only for a short in-page acknowledgement. */
export type TelegramSettingsSuccess = 'token-saved' | 'token-removed' | 'proxy-saved' | null

/** Complete secret-free snapshot consumed by the Telegram Settings page. */
export interface TelegramSettingsState {
  /** Page capability lifecycle. */
  status: 'idle' | 'loading' | 'ready' | 'unavailable' | 'error'
  /** Whether the Host settings document accepts writes. */
  writable: boolean
  /** Remote channel switch; defaults false until a Host response proves otherwise. */
  enabled: boolean
  /** Current Host-owned Telegram transport status. */
  runtime: TelegramRuntimeStatus
  /** Verified username of the configured bot, when available. */
  botUsername?: string
  /** Telegram-reported update count only; update bodies never enter renderer state. */
  pendingUpdateCount?: number
  /** Write-only Bot Token metadata. */
  credential: TelegramCredentialState
  /** Current one-time pairing link, never persisted by this client package. */
  pairing: TelegramPairingLink | null
  /** Host pairing lifecycle, retained even when a waiting token is not recoverable. */
  pairingPhase: 'unpaired' | 'waiting' | 'candidate' | 'paired'
  /** Inbound pair request waiting for an explicit desktop confirmation. */
  candidate: TelegramAccountIdentity | null
  /** Exact private-chat identities already authorized by the Host. */
  bindings: readonly TelegramAccountIdentity[]
  /** Current Bot API proxy override; absent means direct connection. */
  proxyUrl?: string
  /** Current mutation or refresh. */
  action: TelegramSettingsAction
  /** Last generic error category. */
  error: TelegramSettingsError | null
  /** Last successful credential mutation. */
  success: TelegramSettingsSuccess
}

/** Structural controller face injected into the section renderer. */
export interface TelegramSettingsControllerFace {
  /** Reactive secret-free page state. */
  store: SnapshotStore<TelegramSettingsState>
  /** Refresh settings, credential metadata, and Telegram status. */
  refresh: () => Promise<void>
  /** Save a caller-owned token without retaining it in controller state. */
  saveToken: (token: string) => Promise<boolean>
  /** Remove the write-only Bot Token. */
  removeToken: () => Promise<boolean>
  /** Persist or clear the Bot API proxy override; empty string clears it. */
  saveProxy: (proxyUrl: string) => Promise<boolean>
  /** Toggle remote ingress. Enabling is gated in the desktop component. */
  setEnabled: (enabled: boolean) => Promise<boolean>
  /** Mint a short-lived link for one private-chat pairing attempt. */
  beginPairing: () => Promise<boolean>
  /** Admit the current exact candidate only after desktop confirmation. */
  confirmPairing: (candidateId: string) => Promise<boolean>
  /** Revoke one exact bound private-chat identity. */
  revokeBinding: (bindingId: string) => Promise<boolean>
}

/** Secret-free Telegram Remote methods after transport-result unwrapping. */
export interface TelegramRemotePort {
  /** Read the complete safe channel projection. */
  status: () => Promise<TelegramChannelStatus>
  /** Verify credentials and enable an existing paired or unpaired channel. */
  enable: () => Promise<TelegramEnableResult>
  /** Stop ingress while retaining pending or bound pairing state. */
  disable: () => Promise<TelegramChannelStatus>
  /** Enable the channel and mint a new one-time pair capability. */
  beginPairing: () => Promise<TelegramBeginPairingResult>
  /** Confirm only the named current candidate. */
  confirmPairing: (request: TelegramConfirmPairingRequest) => Promise<TelegramConfirmPairingResult>
  /** Disable the channel and erase pending or bound pairing state. */
  revoke: () => Promise<TelegramChannelStatus>
  /** Persist or clear the Bot API proxy override. */
  setProxy: (request: TelegramSetProxyRequest) => Promise<TelegramSetProxyResult>
}

function runtimeOf(runtime: TelegramRuntimePhase): TelegramRuntimeStatus {
  if (runtime === 'disabled') return 'disabled'
  if (runtime === 'starting' || runtime === 'stopping') return 'starting'
  if (runtime === 'polling') return 'online'
  if (runtime === 'rate-limited' || runtime === 'backing-off') return 'offline'
  if (runtime === 'backlog-pending') return 'backlog-pending'
  return 'error'
}

function displayName(firstName: string, lastName: string | undefined): string {
  return lastName === undefined ? firstName : `${firstName} ${lastName}`
}

function candidateOf(candidate: TelegramPairingCandidate): TelegramAccountIdentity {
  return {
    id: candidate.candidateId,
    userId: candidate.userId,
    chatId: candidate.chatId,
    displayName: displayName(candidate.firstName, candidate.lastName),
    ...(candidate.username === undefined ? {} : { username: candidate.username }),
  }
}

function bindingId(account: Pick<TelegramBoundAccount, 'userId' | 'chatId'>): string {
  return `telegram:${account.userId}:${account.chatId}`
}

function bindingOf(account: TelegramBoundAccount): TelegramAccountIdentity {
  return {
    id: bindingId(account),
    userId: account.userId,
    chatId: account.chatId,
    displayName: displayName(account.firstName, account.lastName),
    pairedAt: account.confirmedAt,
    ...(account.username === undefined ? {} : { username: account.username }),
  }
}

function messageSucceeded(response: { readonly result: { readonly ok: boolean } }): void {
  if (!response.result.ok) throw new Error('credential mutation rejected')
}

/**
 * Join Telegram Remote status with write-only Host credential metadata.
 * Token values are accepted only as method arguments and are never assigned
 * to fields, snapshots, errors, timers, or diagnostic strings.
 */
export class TelegramSettingsController implements TelegramSettingsControllerFace {
  /** Reactive secret-free page state. */
  readonly store: SnapshotStore<TelegramSettingsState> = createSnapshotStore({
    status: 'idle',
    writable: true,
    enabled: false,
    runtime: 'disabled',
    credential: {
      ref: TELEGRAM_BOT_TOKEN_REF,
      status: 'idle',
      configured: false,
      writable: true,
    },
    pairing: null,
    pairingPhase: 'unpaired',
    candidate: null,
    bindings: [],
    action: 'idle',
    error: null,
    success: null,
  })

  private generation = 0
  private disposed = false
  private refreshPending = false
  private pollTimer: ReturnType<typeof setTimeout> | undefined
  private pollInFlight = false

  /**
   * @param api - Host credential API; values remain write-only.
   * @param remote - unwrapped Telegram Remote face.
   * @param pollDelayMs - status polling cadence while connecting, recovering, or waiting for a candidate.
   */
  constructor(
    private readonly api: Pick<IApiClient, 'credentials'>,
    private readonly remote: TelegramRemotePort,
    private readonly pollDelayMs = 2_000,
  ) {}

  /** Load Telegram status and credential metadata together. */
  async load(): Promise<void> {
    if (this.disposed) return
    if (this.pollInFlight) {
      this.refreshPending = true
      return
    }
    if (this.store.getSnapshot().action !== 'idle') {
      this.refreshPending = true
      return
    }
    this.cancelStatusPoll()
    const generation = ++this.generation
    const initial = this.store.getSnapshot().status === 'idle'
    this.store.update((state) => {
      state.status = initial ? 'loading' : state.status
      state.action = initial ? 'idle' : 'refreshing'
      state.error = null
      state.credential.status = 'loading'
    })
    try {
      const [status, credentialResponse] = await Promise.all([
        this.remote.status(),
        this.api.credentials.describe({ refs: [TELEGRAM_BOT_TOKEN_REF] }),
      ])
      if (!credentialResponse.result.ok) throw new Error('credential describe rejected')
      if (!this.isCurrent(generation)) return
      const credential = credentialResponse.result.value.credentials[TELEGRAM_BOT_TOKEN_REF]
      this.acceptStatus(status)
      this.store.update((state) => {
        state.status = 'ready'
        state.action = 'idle'
        state.error = null
        state.credential.status = 'ready'
        state.credential.configured = credential?.configured ?? status.credentialConfigured
        state.credential.writable = credential?.writable ?? true
      })
      this.scheduleStatusPoll()
      this.flushRefresh()
    } catch {
      if (!this.isCurrent(generation)) return
      this.store.update((state) => {
        state.status = initial ? 'error' : state.status
        state.action = 'idle'
        state.error = initial ? 'load' : 'refresh'
        state.credential.status = 'error'
      })
      this.scheduleStatusPoll()
      this.flushRefresh()
    }
  }

  /** Refresh settings, credential metadata, and Telegram status. */
  refresh = async (): Promise<void> => this.load()

  /** Save a non-blank Bot Token without retaining it in client state. */
  saveToken = async (token: string): Promise<boolean> => {
    const snapshot = this.store.getSnapshot()
    const normalized = token.trim()
    if (
      this.disposed || normalized === '' || snapshot.status !== 'ready'
      || snapshot.action !== 'idle' || snapshot.credential.status !== 'ready'
      || !snapshot.credential.writable
    ) return false
    const generation = ++this.generation
    this.beginAction('saving-token')
    try {
      const response = await this.api.credentials.set({ ref: TELEGRAM_BOT_TOKEN_REF, value: normalized })
      messageSucceeded(response)
      if (!this.isCurrent(generation)) return false
      this.store.update((state) => {
        state.action = 'idle'
        state.error = null
        state.success = 'token-saved'
        state.credential.status = 'ready'
        state.credential.configured = true
      })
      this.scheduleStatusPoll()
      this.flushRefresh()
      return true
    } catch {
      return this.fail(generation, 'token-save')
    }
  }

  /** Disable Telegram first, then remove the stored Bot Token. */
  removeToken = async (): Promise<boolean> => {
    const snapshot = this.store.getSnapshot()
    if (
      this.disposed || snapshot.status !== 'ready' || snapshot.action !== 'idle'
      || snapshot.credential.status !== 'ready' || !snapshot.credential.configured
      || !snapshot.credential.writable
    ) return false
    const generation = ++this.generation
    this.beginAction('removing-token')
    try {
      const status = await this.remote.revoke()
      const response = await this.api.credentials.unset({ ref: TELEGRAM_BOT_TOKEN_REF })
      messageSucceeded(response)
      if (!this.isCurrent(generation)) return false
      this.acceptStatus(status)
      this.store.update((state) => {
        state.action = 'idle'
        state.error = null
        state.success = 'token-removed'
        state.credential.status = 'ready'
        state.credential.configured = false
      })
      this.scheduleStatusPoll()
      this.flushRefresh()
      return true
    } catch {
      return this.fail(generation, 'token-remove')
    }
  }

  /** Persist the Bot API proxy override; an empty string restores direct connection. */
  saveProxy = async (proxyUrl: string): Promise<boolean> => {
    const snapshot = this.store.getSnapshot()
    if (this.disposed || snapshot.status !== 'ready' || snapshot.action !== 'idle') return false
    const generation = ++this.generation
    this.beginAction('saving-proxy')
    try {
      const result = await this.remote.setProxy({ proxyUrl: proxyUrl.trim() })
      if (!this.isCurrent(generation)) return false
      if (!result.ok) {
        this.acceptStatus(result.status)
        return this.fail(generation, 'proxy-save')
      }
      this.acceptStatus(result.value)
      this.store.update((state) => { state.success = 'proxy-saved' })
      this.finishAction()
      return true
    } catch {
      return this.fail(generation, 'proxy-save')
    }
  }

  /** Enable through the risk-gated Remote, or stop ingress while retaining pairing state. */
  setEnabled = async (enabled: boolean): Promise<boolean> => {
    if (enabled) return this.runEnable()
    const snapshot = this.store.getSnapshot()
    if (
      this.disposed || snapshot.status !== 'ready' || snapshot.action !== 'idle'
      || !snapshot.writable || !snapshot.enabled
    ) return false
    const generation = ++this.generation
    this.beginAction('disabling')
    try {
      const status = await this.remote.disable()
      if (!this.isCurrent(generation)) return false
      this.acceptStatus(status)
      this.finishAction()
      return true
    } catch {
      return this.fail(generation, 'disable')
    }
  }

  /** Generate or replace the current one-time pairing link. */
  beginPairing = async (): Promise<boolean> => this.runBeginPairing()

  /** Confirm only the candidate currently projected by the Host. */
  confirmPairing = async (candidateId: string): Promise<boolean> => {
    const snapshot = this.store.getSnapshot()
    if (
      this.disposed || snapshot.status !== 'ready' || snapshot.action !== 'idle'
      || snapshot.candidate?.id !== candidateId
    ) return false
    const generation = ++this.generation
    this.beginAction('confirming-pairing')
    try {
      const result = await this.remote.confirmPairing({ candidateId })
      if (!this.isCurrent(generation)) return false
      if (!result.ok) {
        this.acceptStatus(result.status)
        return this.fail(generation, 'confirm')
      }
      this.acceptStatus(result.value)
      this.finishAction()
      return true
    } catch {
      return this.fail(generation, 'confirm')
    }
  }

  /** Revoke the sole binding only when its exact identity still matches. */
  revokeBinding = async (binding: string): Promise<boolean> => {
    const snapshot = this.store.getSnapshot()
    if (
      this.disposed || snapshot.status !== 'ready' || snapshot.action !== 'idle'
      || snapshot.bindings.length !== 1 || snapshot.bindings[0]?.id !== binding
    ) return false
    const generation = ++this.generation
    this.beginAction('revoking-binding')
    try {
      const status = await this.remote.revoke()
      if (!this.isCurrent(generation)) return false
      this.acceptStatus(status)
      this.finishAction()
      return true
    } catch {
      return this.fail(generation, 'revoke')
    }
  }

  /**
   * Refresh only when the Telegram Bot Token reference changed.
   * @param ref - Host-reported credential reference.
   */
  refreshCredential(ref: string): void {
    if (ref !== TELEGRAM_BOT_TOKEN_REF) return
    if (this.store.getSnapshot().action !== 'idle') {
      this.refreshPending = true
      return
    }
    void this.load()
  }

  /** Cancel timers and prevent later async responses from publishing. */
  dispose(): void {
    this.disposed = true
    this.generation += 1
    this.cancelStatusPoll()
  }

  private async runBeginPairing(): Promise<boolean> {
    const snapshot = this.store.getSnapshot()
    if (
      this.disposed || snapshot.status !== 'ready' || snapshot.action !== 'idle'
      || !snapshot.writable || !snapshot.credential.configured
    ) return false
    const generation = ++this.generation
    this.beginAction('beginning-pairing')
    try {
      const result = await this.remote.beginPairing()
      if (!this.isCurrent(generation)) return false
      if (!result.ok) {
        this.acceptStatus(result.status)
        return this.fail(
          generation,
          result.error.code === 'backlog-pending' ? 'backlog-pending' : 'pairing',
        )
      }
      this.acceptStatus(result.value.status, {
        url: result.value.deepLink,
        code: result.value.token,
        expiresAt: result.value.expiresAt,
      })
      this.finishAction()
      return true
    } catch {
      return this.fail(generation, 'pairing')
    }
  }

  private async runEnable(): Promise<boolean> {
    const snapshot = this.store.getSnapshot()
    if (
      this.disposed || snapshot.status !== 'ready' || snapshot.action !== 'idle'
      || !snapshot.writable || snapshot.enabled || !snapshot.credential.configured
    ) return false
    const generation = ++this.generation
    this.beginAction('enabling')
    try {
      const result = await this.remote.enable()
      if (!this.isCurrent(generation)) return false
      if (!result.ok) {
        this.acceptStatus(result.status)
        return this.fail(
          generation,
          result.error.code === 'backlog-pending' ? 'backlog-pending' : 'enable',
        )
      }
      this.acceptStatus(result.value)
      this.finishAction()
      return true
    } catch {
      return this.fail(generation, 'enable')
    }
  }

  private beginAction(action: Exclude<TelegramSettingsAction, 'idle' | 'refreshing'>): void {
    this.cancelStatusPoll()
    this.store.update((state) => {
      state.action = action
      state.error = null
      state.success = null
    })
  }

  private isCurrent(generation: number): boolean {
    return !this.disposed && generation === this.generation
  }

  private finishAction(): void {
    this.store.update((state) => {
      state.action = 'idle'
      state.error = null
    })
    this.scheduleStatusPoll()
    this.flushRefresh()
  }

  private fail(generation: number, error: TelegramSettingsError): false {
    if (this.isCurrent(generation)) {
      this.store.update((state) => {
        state.action = 'idle'
        state.error = error
      })
      this.scheduleStatusPoll()
      this.flushRefresh()
    }
    return false
  }

  private flushRefresh(): void {
    if (this.disposed || !this.refreshPending) return
    this.refreshPending = false
    queueMicrotask(() => { void this.load() })
  }

  private acceptStatus(status: TelegramChannelStatus, issued?: TelegramPairingLink): void {
    this.store.update((state) => {
      state.enabled = status.enabled
      state.runtime = runtimeOf(status.runtime)
      if (status.bot === undefined) delete state.botUsername
      else state.botUsername = status.bot.username
      if (status.pendingUpdateCount === undefined) delete state.pendingUpdateCount
      else state.pendingUpdateCount = status.pendingUpdateCount
      state.pairingPhase = status.pairing.kind
      state.credential.configured = status.credentialConfigured
      if (status.proxyUrl === undefined) delete state.proxyUrl
      else state.proxyUrl = status.proxyUrl
      if (status.pairing.kind === 'waiting') {
        state.pairing = issued ?? (
          state.pairing?.expiresAt === status.pairing.expiresAt ? state.pairing : null
        )
        state.candidate = null
        state.bindings = []
      } else if (status.pairing.kind === 'candidate') {
        state.pairing = null
        state.candidate = candidateOf(status.pairing.candidate)
        state.bindings = []
      } else if (status.pairing.kind === 'paired') {
        state.pairing = null
        state.candidate = null
        state.bindings = [bindingOf(status.pairing.account)]
      } else {
        state.pairing = null
        state.candidate = null
        state.bindings = []
      }
    })
    if (!this.shouldPollStatus(this.store.getSnapshot())) this.cancelStatusPoll()
  }

  private shouldPollStatus(state: TelegramSettingsState): boolean {
    return state.enabled && (
      state.runtime === 'starting'
      || state.runtime === 'offline'
      || (state.runtime === 'online' && state.pairingPhase === 'waiting')
    )
  }

  private cancelStatusPoll(): void {
    if (this.pollTimer !== undefined) clearTimeout(this.pollTimer)
    this.pollTimer = undefined
  }

  private scheduleStatusPoll(): void {
    this.cancelStatusPoll()
    const state = this.store.getSnapshot()
    if (
      this.disposed || this.pollInFlight || state.action !== 'idle'
      || !this.shouldPollStatus(state)
    ) return
    this.pollTimer = setTimeout(() => { void this.pollStatus() }, this.pollDelayMs)
  }

  private async pollStatus(): Promise<void> {
    this.pollTimer = undefined
    const state = this.store.getSnapshot()
    if (
      this.disposed || state.action !== 'idle'
      || !this.shouldPollStatus(state)
    ) return
    const generation = ++this.generation
    this.pollInFlight = true
    try {
      const status = await this.remote.status()
      if (this.isCurrent(generation)) this.acceptStatus(status)
    } catch {
      if (this.isCurrent(generation)) {
        this.store.update((state) => { state.error = 'refresh' })
      }
    } finally {
      this.pollInFlight = false
      this.scheduleStatusPoll()
      this.flushRefresh()
    }
  }
}
