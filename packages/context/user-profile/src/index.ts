/** Optional, consented public-profile runtime context. @module @deepseek-ai/dsh-user-profile */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { renderUserProfileContext } from './render.ts'
import type {
  PublicProfileField, PublicProfileOnboarding, ResponseStyle, UserProfileSettings,
} from './types.ts'
import { validateUserProfileSettings } from './validate.ts'

export {
  USER_PROFILE_FIELD_KEYS, type PublicProfileField, type PublicProfileOnboarding,
  type ResponseStyle, type UserProfileFieldKey, type UserProfileSettings,
} from './types.ts'
export { renderUserProfileContext } from './render.ts'
export { validateUserProfileSettings, visibleValue } from './validate.ts'

/** Durable settings namespace. */
export const USER_PROFILE_SETTINGS_NAMESPACE = 'user-profile'
/** Dynamic context source name retained in model history. */
export const USER_PROFILE_CONTEXT_NAME = 'user:public-profile'
/** Current durable onboarding marker generation. */
export const USER_PROFILE_ONBOARDING_VERSION = 1 as const

// Object schemas default missing input to `{}`. The one-member union removes
// that collection default so the wrapper itself stays optional while a present
// wrapper still validates its required `value` member.
const field = z.union([z.object({
  value: z.string().required(),
  agentVisible: z.boolean().default(false),
})]).required(false) as z<PublicProfileField>

const responseStyleField = z.union([z.object({
  value: z.union([
    z.const('concise' as const),
    z.const('detailed' as const),
    z.const('action-first' as const),
  ]).required(),
  agentVisible: z.boolean().default(false),
})]).required(false) as z<PublicProfileField<ResponseStyle>>

const onboarding = z.union([z.object({
  version: z.const(1 as const).required(),
  state: z.union([z.const('completed' as const), z.const('skipped' as const)]).required(),
})]).required(false) as z<PublicProfileOnboarding>

/** Wire-visible schema; presence of a field never implies model consent. */
export const UserProfileSettingsSchema: z<UserProfileSettings> = z.object({
  preferredName: field,
  role: field,
  organization: field,
  region: field,
  industry: field,
  workFocus: field,
  topGoal: field,
  preferredLanguage: field,
  timezone: field,
  responseStyle: responseStyleField,
  websiteUrl: field,
  xHandle: field,
  linkedinUrl: field,
  githubHandle: field,
  douyinUrl: field,
  xiaohongshuUrl: field,
  wechatOfficialAccount: field,
  onboarding,
})

/** Services that own durable profile data and dynamic Agent context. */
export const inject = ['settings', 'systemPrompt']

/** Register the profile namespace and its live, per-assembly context provider. */
export function apply(ctx: Context): void {
  const scope = ctx.settings.register(
    settingsNamespace(USER_PROFILE_SETTINGS_NAMESPACE),
    UserProfileSettingsSchema,
    { validate: validateUserProfileSettings },
  )
  let disposeContext: (() => void) | undefined
  const reconcile = (settings: UserProfileSettings): void => {
    const visible = renderUserProfileContext(settings) !== ''
    if (!visible) {
      disposeContext?.()
      disposeContext = undefined
      return
    }
    disposeContext ??= ctx.systemPrompt.context({
      name: USER_PROFILE_CONTEXT_NAME,
      order: 30,
      text: () => renderUserProfileContext(scope.get()),
    })
  }
  reconcile(scope.get())
  const unwatch = scope.watch((next) => { reconcile(next) })
  ctx.effect(() => () => {
    unwatch()
    disposeContext?.()
    disposeContext = undefined
  }, 'user-profile: live consent projection')
}
