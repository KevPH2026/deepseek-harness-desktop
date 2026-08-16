/**
 * Pure validation for the optional Telegram Bot API proxy override.
 *
 * Networks that cannot reach api.telegram.org directly route the Bot API
 * through a local HTTP proxy instead. Only host-addressed http(s) URLs are
 * admitted: credentials, paths, queries, and fragments would either store a
 * secret in plain durable state or describe a target the Bot API client never
 * uses.
 */

/** Longest accepted proxy URL, matching the durable-boundary schema. */
export const TELEGRAM_PROXY_URL_LIMIT = 200

/**
 * Normalize one candidate proxy override.
 * @param value - Raw user input; surrounding whitespace is ignored.
 * @returns The normalized absolute URL, `undefined` when the input clears the
 * override, or `null` when the input is not an acceptable proxy URL.
 */
export function normalizeTelegramProxyUrl(value: string): string | undefined | null {
  const trimmed = value.trim()
  if (trimmed === '') return undefined
  if (trimmed.length > TELEGRAM_PROXY_URL_LIMIT) return null
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  if (parsed.username !== '' || parsed.password !== '') return null
  if (parsed.pathname !== '' && parsed.pathname !== '/') return null
  if (parsed.search !== '' || parsed.hash !== '') return null
  return parsed.toString()
}
