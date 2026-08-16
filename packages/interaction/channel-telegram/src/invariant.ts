/** Package-owned invariant companion for Telegram channel state. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-channel-telegram'

/** Cordis companion plugin name. */
export const name = 'channel-telegram-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: transitions are serialized by the provider and every durable write
 * is schema validated by the storage domain, so no additional shared invariant
 * is installed here.
 */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
