/** Minimal, strict Telegram Bot API HTTP client with secret-safe failures. */

import { createHash } from 'node:crypto'

/** Credential resolver called once for every Bot API operation. */
export type TelegramTokenResolver = () => Promise<string | undefined>

/** Telegram user fields consumed by this provider. */
export interface TelegramApiUser {
  readonly id: number
  readonly is_bot: boolean
  readonly first_name: string
  readonly last_name?: string
  readonly username?: string
}

/** Telegram chat fields consumed by this provider. */
export interface TelegramApiChat {
  readonly id: number
  readonly type: 'private' | 'group' | 'supergroup' | 'channel'
}

/** Telegram message fields consumed by this provider. */
export interface TelegramApiMessage {
  readonly message_id: number
  /** Retained as unknown so activation can durably fail closed on malformed Bot API input. */
  readonly date?: unknown
  readonly from?: TelegramApiUser
  readonly chat: TelegramApiChat
  readonly text?: string
}

/** Telegram update fields consumed by allowed_updates=['message']. */
export interface TelegramApiUpdate {
  readonly update_id: number
  readonly message?: TelegramApiMessage
}

/** Safe getMe result plus an opaque in-memory credential generation marker. */
export interface TelegramAuthenticatedBot {
  readonly bot: TelegramApiUser
  readonly credentialFingerprint: string
}

/** Webhook state. Callers must never project or log url. */
export interface TelegramWebhookInfo {
  readonly url: string
  readonly pending_update_count: number
}

/** Telegram API failure categories with no request URL or credential content. */
export type TelegramBotApiErrorKind =
  | 'credential-missing'
  | 'credential-changed'
  | 'network'
  | 'protocol'
  | 'api'

/** Secret-safe Telegram failure. Raw fetch errors and URLs are deliberately not retained. */
export class TelegramBotApiError extends Error {
  constructor(
    readonly kind: TelegramBotApiErrorKind,
    readonly status?: number,
    readonly retryAfter?: number,
  ) {
    super(`Telegram Bot API operation failed (${kind})`)
    this.name = 'TelegramBotApiError'
  }
}

interface TelegramEnvelope<T> {
  readonly ok: boolean
  readonly result?: T
  readonly error_code?: number
  readonly parameters?: { readonly retry_after?: number }
}

interface RequestOptions<T> {
  readonly signal?: AbortSignal | undefined
  readonly expectedCredentialFingerprint?: string
  readonly validate: (value: unknown) => value is T
}

const TOKEN_PATTERN = /^[0-9]+:[A-Za-z0-9_-]+$/u
const UPDATE_LIMIT = 100
/** Telegram Bot API maximum accepted plain-text message length in UTF-16 units. */
export const TELEGRAM_TEXT_LIMIT = 4096

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isApiUser(value: unknown): value is TelegramApiUser {
  return isRecord(value) && typeof value.id === 'number' && typeof value.is_bot === 'boolean'
    && typeof value.first_name === 'string'
}

function isWebhookInfo(value: unknown): value is TelegramWebhookInfo {
  return isRecord(value) && typeof value.url === 'string' && typeof value.pending_update_count === 'number'
}

function isApiMessage(value: unknown): value is TelegramApiMessage {
  if (!isRecord(value) || typeof value.message_id !== 'number' || !isRecord(value.chat)
    || typeof value.chat.id !== 'number'
    || !['private', 'group', 'supergroup', 'channel'].includes(String(value.chat.type))) return false
  if (value.from !== undefined && !isApiUser(value.from)) return false
  // Date is interpreted by the provider's durable activation barrier. Keeping
  // malformed input here lets that barrier disable safely instead of retrying
  // the same ambiguous update forever as a transport protocol failure.
  return value.text === undefined || typeof value.text === 'string'
}

function isUpdateArray(value: unknown): value is readonly TelegramApiUpdate[] {
  return Array.isArray(value) && value.every((update: unknown) => isRecord(update)
    && typeof update.update_id === 'number' && (update.message === undefined || isApiMessage(update.message)))
}

/** Hash a high-entropy token without retaining it outside one request. */
function fingerprint(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * Split plain text conservatively by UTF-16 units without cutting a surrogate pair.
 * @param text - Complete plain text to split.
 * @param limit - Maximum UTF-16 units per chunk; must be at least two.
 * @returns Frozen chunks whose concatenation equals the input text.
 */
export function splitTelegramPlainText(text: string, limit = TELEGRAM_TEXT_LIMIT): readonly string[] {
  // Two UTF-16 units are required to keep an astral code point intact.
  if (!Number.isSafeInteger(limit) || limit < 2) throw new TypeError('Telegram text limit must be at least two')
  if (text.length === 0) return Object.freeze([])
  const chunks: string[] = []
  let start = 0
  while (start < text.length) {
    let end = Math.min(start + limit, text.length)
    if (end < text.length) {
      const previous = text.charCodeAt(end - 1)
      const next = text.charCodeAt(end)
      if (previous >= 0xD800 && previous <= 0xDBFF && next >= 0xDC00 && next <= 0xDFFF) end -= 1
    }
    chunks.push(text.slice(start, end))
    start = end
  }
  return Object.freeze(chunks)
}

/** Minimal Bot API client. Every method re-resolves the CredentialRef value. */
export class TelegramBotApiClient {
  constructor(
    private readonly resolveToken: TelegramTokenResolver,
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
    private readonly apiOrigin = 'https://api.telegram.org',
  ) {}

  /**
   * Validate the current credential with `getMe`.
   * @param signal - Optional operation cancellation.
   * @returns Sanitized Bot API user plus an in-memory credential fingerprint.
   */
  async getMe(signal?: AbortSignal): Promise<TelegramAuthenticatedBot> {
    const resolved = await this.request('getMe', {}, { signal, validate: isApiUser })
    return Object.freeze({ bot: resolved.value, credentialFingerprint: resolved.credentialFingerprint })
  }

  /**
   * Read webhook state; a non-empty URL must fail closed in the provider.
   * @param expectedCredentialFingerprint - Fingerprint established by the preceding `getMe`.
   * @param signal - Optional operation cancellation.
   * @returns Current webhook state for fail-closed inspection.
   */
  async getWebhookInfo(
    expectedCredentialFingerprint: string,
    signal?: AbortSignal,
  ): Promise<TelegramWebhookInfo> {
    return (await this.request('getWebhookInfo', {}, {
      signal,
      expectedCredentialFingerprint,
      validate: isWebhookInfo,
    })).value
  }

  /**
   * Receive one long-poll batch with the provider's only allowed update type.
   * @param offset - First update id Telegram may return, or undefined for the initial poll.
   * @param timeout - Telegram long-poll timeout in seconds.
   * @param expectedCredentialFingerprint - Fingerprint established by the current connection.
   * @param signal - Optional operation cancellation.
   * @returns Validated message-update batch.
   */
  async getUpdates(
    offset: number | undefined,
    timeout: number,
    expectedCredentialFingerprint: string,
    signal?: AbortSignal,
  ): Promise<readonly TelegramApiUpdate[]> {
    const body = {
      ...(offset === undefined ? {} : { offset }),
      limit: UPDATE_LIMIT,
      timeout,
      allowed_updates: ['message'],
    }
    return (await this.request('getUpdates', body, {
      signal,
      expectedCredentialFingerprint,
      validate: isUpdateArray,
    })).value
  }

  /**
   * Send one already-bounded plain-text chunk.
   * @param chatId - Exact authorized private-chat id.
   * @param text - Non-empty plain-text chunk no longer than the Telegram limit.
   * @param expectedCredentialFingerprint - Fingerprint established by the current connection.
   * @param replyTo - Optional Telegram message id for reply metadata.
   * @param signal - Optional operation cancellation.
   * @returns Telegram's validated sent-message receipt.
   */
  async sendMessage(
    chatId: string,
    text: string,
    expectedCredentialFingerprint: string,
    replyTo: string | undefined,
    signal?: AbortSignal,
  ): Promise<TelegramApiMessage> {
    if (text.length < 1 || text.length > TELEGRAM_TEXT_LIMIT) {
      throw new TypeError(`Telegram message text must contain 1-${TELEGRAM_TEXT_LIMIT} UTF-16 units`)
    }
    const replyMessageId = replyTo === undefined ? undefined : Number(replyTo)
    const body = {
      chat_id: chatId,
      text,
      ...(replyMessageId !== undefined && Number.isSafeInteger(replyMessageId) && replyMessageId > 0
        ? { reply_parameters: { message_id: replyMessageId, allow_sending_without_reply: true } }
        : {}),
    }
    return (await this.request('sendMessage', body, {
      signal,
      expectedCredentialFingerprint,
      validate: isApiMessage,
    })).value
  }

  private async request<T>(
    method: string,
    body: Record<string, unknown>,
    options: RequestOptions<T>,
  ): Promise<{ readonly value: T; readonly credentialFingerprint: string }> {
    options.signal?.throwIfAborted()
    let token: string | undefined
    try {
      token = await this.resolveToken()
    } catch {
      // Credential backend failures are intentionally collapsed so resolver
      // exceptions can never carry a secret into logs or Remote errors.
      throw new TelegramBotApiError('credential-missing')
    }
    if (token === undefined || token.length === 0 || !TOKEN_PATTERN.test(token)) {
      throw new TelegramBotApiError('credential-missing')
    }
    const credentialFingerprint = fingerprint(token)
    if (options.expectedCredentialFingerprint !== undefined
      && options.expectedCredentialFingerprint !== credentialFingerprint) {
      throw new TelegramBotApiError('credential-changed')
    }

    let response: Response
    try {
      response = await this.fetchImpl(`${this.apiOrigin}/bot${token}/${method}`, {
        method: 'POST',
        // The Bot token is part of Telegram's URL path. Never let a 30x send
        // that credential to a redirect target, even if fetch would allow it.
        redirect: 'error',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      })
    } catch {
      if (options.signal?.aborted === true) options.signal.throwIfAborted()
      throw new TelegramBotApiError('network')
    }

    let envelope: TelegramEnvelope<unknown>
    try {
      envelope = await response.json() as TelegramEnvelope<unknown>
    } catch {
      throw new TelegramBotApiError('protocol', response.status)
    }
    if (!envelope.ok || envelope.result === undefined) {
      const status = envelope.error_code ?? response.status
      const retryAfter = envelope.parameters?.retry_after
      throw new TelegramBotApiError(
        'api',
        status,
        typeof retryAfter === 'number' && Number.isSafeInteger(retryAfter) && retryAfter >= 0
          ? retryAfter
          : undefined,
      )
    }
    if (!options.validate(envelope.result)) throw new TelegramBotApiError('protocol', response.status)
    return { value: envelope.result, credentialFingerprint }
  }
}

export default TelegramBotApiClient
