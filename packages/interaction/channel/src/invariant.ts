/** Package-owned invariant companion for `@deepseek-ai/dsh-channel`. @module @deepseek-ai/dsh-channel/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-channel'

/** Cordis companion plugin name. */
export const name = 'channel-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: registration uniqueness is enforced synchronously and
 * the provider/consumer registrations are effect-owned; behavior tests prove removal.
 */
const install: InvariantInstaller = () => {}

/** @param ctx - Context carrying the invariant registry. @returns the registration disposer. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
