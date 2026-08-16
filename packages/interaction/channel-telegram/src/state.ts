/** Pure, secret-free Telegram desired-state transitions. */

import type { TelegramDurableState } from './spec.ts'
import type { TelegramBotIdentity } from './types.ts'

/**
 * Stop runtime work without forgetting pairing, binding, bot identity, or offset.
 * The prior activation barrier ends with this enabled interval.
 * @param current - Current durable desired state.
 * @returns Disabled copy retaining every bot-specific field.
 */
export function disableTelegramState(current: TelegramDurableState): TelegramDurableState {
  const { activationBarrier, ...retained } = current
  void activationBarrier
  return Object.freeze({ ...retained, enabled: false })
}

/**
 * Explicit unlink so no old bot identity or offset can cross into a new bot.
 * The local proxy override is machine configuration, not bot identity, so it
 * survives the unlink.
 * @param current - Current durable desired state.
 * @returns Fresh default-disabled durable state retaining only the proxy.
 */
export function revokeTelegramState(current: TelegramDurableState): TelegramDurableState {
  return Object.freeze({
    enabled: false,
    ...(current.proxyUrl === undefined ? {} : { proxyUrl: current.proxyUrl }),
  })
}

/**
 * Attach a verified bot to current state. A remembered different bot fails
 * closed; a clean revoked state accepts the new identity with no inherited
 * offset.
 * @param current - Current durable desired state.
 * @param bot - Identity validated by the current credential's `getMe` response.
 * @returns Enabled state, or undefined when the remembered bot differs.
 */
export function enableTelegramState(
  current: TelegramDurableState,
  bot: TelegramBotIdentity,
): TelegramDurableState | undefined {
  if (current.bot !== undefined && current.bot.id !== bot.id) return undefined
  const { disabledBacklog, ...retained } = current
  void disabledBacklog
  return Object.freeze({ ...retained, enabled: true, bot })
}
