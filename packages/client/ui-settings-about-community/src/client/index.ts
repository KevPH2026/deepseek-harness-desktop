/** About & Community Settings contribution, browser half. */

import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  AboutCommunitySection,
  type AboutCommunitySectionInjected,
} from './AboutCommunitySection.tsx'
import { en, zh, type AboutCommunityLocaleKey } from './locales.ts'

export type { AboutCommunitySectionInjected, AboutCommunitySectionProps } from './AboutCommunitySection.tsx'
export type { AboutCommunityLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** About & Community attribution and support copy. */
    'settings.aboutCommunity': AboutCommunityLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.aboutCommunity'

/** Services required by the Settings registration. */
export const inject = ['slots', 'locale']

/** Contribute the static About & Community page to Settings. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-about-community: dictionaries')

  const t = ctx.locale.bind(NS) as AboutCommunitySectionInjected['t']
  const injected = (): AboutCommunitySectionInjected => ({ t })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'about-community',
    order: 100,
    label: () => t('nav'),
    locale: NS,
    inject: injected,
  }, AboutCommunitySection))
}
