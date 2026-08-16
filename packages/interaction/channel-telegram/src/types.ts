/** Client-safe Telegram channel status and pairing Remote payloads. */

/** Sanitized Host runtime phase; no Telegram URL or API description crosses this boundary. */
export type TelegramRuntimePhase =
  | 'disabled'
  | 'starting'
  | 'polling'
  | 'credential-missing'
  | 'credential-changed'
  | 'webhook-active'
  | 'unauthorized'
  | 'api-conflict'
  | 'rate-limited'
  | 'backing-off'
  | 'backlog-pending'
  | 'error'
  | 'stopping'

/** Public identity returned by Telegram's getMe method. */
export interface TelegramBotIdentity {
  readonly id: string
  readonly username: string
  readonly firstName: string
}

/** One private-chat sender waiting for explicit confirmation on the desktop. */
export interface TelegramPairingCandidate {
  readonly candidateId: string
  readonly userId: string
  readonly chatId: string
  readonly firstName: string
  readonly lastName?: string | undefined
  readonly username?: string | undefined
  readonly receivedAt: number
  readonly expiresAt: number
}

/** Exact private-chat identity durably authorized by a desktop confirmation. */
export interface TelegramBoundAccount {
  readonly userId: string
  readonly chatId: string
  readonly firstName: string
  readonly lastName?: string | undefined
  readonly username?: string | undefined
  readonly confirmedAt: number
}

/** Pairing projection. The one-time token is returned only by beginPairing. */
export type TelegramPairingStatus =
  | { readonly kind: 'unpaired' }
  | { readonly kind: 'waiting'; readonly expiresAt: number }
  | { readonly kind: 'candidate'; readonly candidate: TelegramPairingCandidate }
  | { readonly kind: 'paired'; readonly account: TelegramBoundAccount }

/** Complete safe status projection for local settings UI. */
export interface TelegramChannelStatus {
  readonly enabled: boolean
  readonly credentialConfigured: boolean
  readonly runtime: TelegramRuntimePhase
  readonly pairing: TelegramPairingStatus
  readonly bot?: TelegramBotIdentity
  readonly lastProcessedUpdateId?: number
  readonly retryAt?: number
  readonly pendingUpdateCount?: number
  /** Current Bot API proxy override; absent means direct connection. Not a secret. */
  readonly proxyUrl?: string | undefined
}

/** One newly issued 128-bit, single-use pairing capability. */
export interface TelegramPairingCapability {
  readonly token: string
  readonly deepLink: string
  readonly expiresAt: number
  readonly status: TelegramChannelStatus
}

/** Stable begin-pairing failures rendered by the local UI. */
export type TelegramBeginPairingErrorCode =
  | 'already-paired'
  | 'credential-missing'
  | 'unauthorized'
  | 'webhook-active'
  | 'api-conflict'
  | 'bot-identity-changed'
  | 'bot-username-missing'
  | 'backlog-pending'
  | 'connection-failed'
  | 'service-stopping'

/** Stable enable failures after validating the configured Telegram bot. */
export type TelegramEnableErrorCode = Exclude<TelegramBeginPairingErrorCode, 'already-paired'>

/** Result of enabling or resuming the Telegram poller. */
export type TelegramEnableResult =
  | { readonly ok: true; readonly value: TelegramChannelStatus }
  | {
    readonly ok: false
    readonly error: { readonly code: TelegramEnableErrorCode }
    readonly status: TelegramChannelStatus
  }

/** Result of enabling Telegram and issuing a fresh pairing capability. */
export type TelegramBeginPairingResult =
  | { readonly ok: true; readonly value: TelegramPairingCapability }
  | {
    readonly ok: false
    readonly error: { readonly code: TelegramBeginPairingErrorCode }
    readonly status: TelegramChannelStatus
  }

/** Candidate selected by the desktop confirmation action. */
export interface TelegramConfirmPairingRequest {
  readonly candidateId: string
}

/** Stable confirmation failures. */
export type TelegramConfirmPairingErrorCode =
  | 'candidate-missing'
  | 'candidate-expired'
  | 'candidate-mismatch'
  | 'service-stopping'

/** Result of confirming one pending private-chat identity. */
export type TelegramConfirmPairingResult =
  | { readonly ok: true; readonly value: TelegramChannelStatus }
  | {
    readonly ok: false
    readonly error: { readonly code: TelegramConfirmPairingErrorCode }
    readonly status: TelegramChannelStatus
  }

/** Requested Bot API network change; an empty string clears the proxy override. */
export interface TelegramSetProxyRequest {
  readonly proxyUrl: string
}

/** Stable proxy-update failures rendered by the local UI. */
export type TelegramSetProxyErrorCode =
  | 'invalid-proxy'
  | 'service-stopping'

/** Result of persisting the Bot API proxy override. */
export type TelegramSetProxyResult =
  | { readonly ok: true; readonly value: TelegramChannelStatus }
  | {
    readonly ok: false
    readonly error: { readonly code: TelegramSetProxyErrorCode }
    readonly status: TelegramChannelStatus
  }
