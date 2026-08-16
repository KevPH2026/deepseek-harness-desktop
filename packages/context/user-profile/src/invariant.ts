/** Package-owned public-profile context invariant. @module @deepseek-ai/dsh-user-profile/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-system-prompt'
import {
  renderUserProfileContext, USER_PROFILE_CONTEXT_NAME, USER_PROFILE_SETTINGS_NAMESPACE,
  type UserProfileSettings,
} from '@deepseek-ai/dsh-user-profile'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'

const PACKAGE_NAME = '@deepseek-ai/dsh-user-profile'

/** Cordis companion plugin name. */
export const name = 'user-profile-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Ensure any unsuppressed profile context is exactly the current consent-filtered projection. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const assembled = await next()
    const entries = assembled.contexts.filter(entry => entry.name === USER_PROFILE_CONTEXT_NAME)
    if (entries.length === 0) return assembled
    const value = ctx.settings.get(settingsNamespace(USER_PROFILE_SETTINGS_NAMESPACE)) as UserProfileSettings | undefined
    const expected = renderUserProfileContext(value ?? {})
    if (entries.length !== 1 || entries[0]?.text !== expected) {
      fail('public profile context must equal the current explicit agentVisible projection')
    }
    return assembled
  }, { global: true, prepend: true })
}, { inject: ['settings', 'systemPrompt'] })

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
