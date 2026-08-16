/** Loopback-only Profile Settings and onboarding contribution, browser half. */

import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { ProfileSettingsSection, type ProfileSettingsInjected } from './ProfileSettingsSection.tsx'
import {
  PublicProfileOnboarding, type PublicProfileOnboardingInjected,
} from './PublicProfileOnboarding.tsx'
import { en, NS, zh, type ProfileLocaleKey } from './locales.ts'
import {
  ProfileSettingsController, PROFILE_SETTINGS_NAMESPACE, refreshProfileIfLoaded,
} from './profile-store.ts'

export type { ProfileSettingsInjected, ProfileSettingsSectionProps } from './ProfileSettingsSection.tsx'
export type { PublicProfileOnboardingInjected, PublicProfileOnboardingProps } from './PublicProfileOnboarding.tsx'
export type { ProfileLocaleKey } from './locales.ts'
export {
  canonicalProfileValue, editableProfile, PROFILE_FIELDS, PROFILE_FIELD_KEYS,
  type EditableProfile, type ProfileFieldKey, type ProfileFieldValue, type ProfileValue,
} from './profile-model.ts'
export {
  ProfileSettingsController, PROFILE_ONBOARDING_VERSION, PROFILE_SETTINGS_NAMESPACE,
  refreshProfileIfLoaded, type ProfileSettingsControllerFace, type ProfileSettingsState,
} from './profile-store.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Local public-profile settings and first-run copy. */
    'settings.profile': ProfileLocaleKey
  }
}

/** Services required by the local Profile Settings contribution. */
export const inject = ['slots', 'locale', 'connection', 'remote']

/** Register profile surfaces only for the desktop's loopback connection. */
export function apply(ctx: ClientContext): void {
  const connection = ctx.get('connection') as ConnectionHandle
  if (!connection.isLoopback) return

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-profile: dictionaries')
  const controller = new ProfileSettingsController(connection.api)
  const common = () => ({ refreshProfile: () => controller.load() })
  const sectionInjected = (): ProfileSettingsInjected => ({
    hooks: { profileSettings: controller.store },
    ...common(),
    saveProfile: (draft, finish) => controller.save(draft, finish),
    clearProfile: () => controller.clear(),
  })
  const onboardingInjected = (): PublicProfileOnboardingInjected => ({
    hooks: { publicProfileOnboarding: controller.store },
    ...common(),
    saveProfile: (draft, finish) => controller.save(draft, finish),
    skipProfile: () => controller.skip(),
  })

  ctx.effect(() => {
    void controller.load()
    const disposers = [
      ctx.remote.$on('settings/document-updated', (namespace) => {
        if (String(namespace) === PROFILE_SETTINGS_NAMESPACE) refreshProfileIfLoaded(controller)
      }),
      ctx.on('connection/reset', () => { refreshProfileIfLoaded(controller) }),
    ]
    return () => {
      controller.dispose()
      for (const dispose of disposers) dispose()
    }
  }, 'ui-settings-profile: controller')

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'profile',
    order: 5,
    label: () => ctx.locale.bind(NS)('nav'),
    locale: NS,
    inject: sectionInjected,
  }, ProfileSettingsSection))
  ctx.slots.inject('settings.onboarding', () => ctx.slots.register({
    name: 'settings.onboarding',
    id: 'public-profile',
    order: -50,
    locale: NS,
    inject: onboardingInjected,
  }, PublicProfileOnboarding))
}
