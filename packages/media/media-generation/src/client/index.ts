/** Browser plugin for media-generation settings and generated-artifact Tool cards. */

import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { MEDIA_SETTINGS_NAMESPACE, type MediaGenerationConfig } from '../types.ts'
import { MediaSettingsSection } from './MediaSettingsSection.tsx'
import type { MediaSettingsInjected } from './MediaSettingsSection.tsx'
import { MediaToolCard } from './MediaToolCard.tsx'
import { en, NS, zh } from './locales.ts'
import { MediaSettingsStore } from './settings-store.ts'

/** Required browser services. */
export const inject = ['slots', 'locale', 'connection', 'remote', 'settingsScope']

/**
 * Register the Media settings page and both media-generation Tool cards.
 * @param ctx - browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'media-generation: browser dictionaries')

  const { api } = ctx.get('connection') as ConnectionHandle
  const scope = ctx.settingsScope.bind<MediaGenerationConfig>({ namespace: MEDIA_SETTINGS_NAMESPACE })
  const controller = new MediaSettingsStore(scope, api)
  const sectionInjected = (): MediaSettingsInjected => ({
    hooks: { mediaSettings: controller.store },
    saveMediaSettings: write => controller.save(write),
    removeMediaCredential: kind => controller.removeCredential(kind),
  })

  ctx.effect(() => () => { controller.dispose() }, 'media-generation: settings controller')
  ctx.effect(
    () => ctx.remote.$on('credentials/updated', (ref) => { controller.refreshCredential(ref) }),
    'media-generation: credential invalidations',
  )

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'media-generation',
    order: 12,
    label: () => ctx.locale.bind(NS)('nav'),
    locale: NS,
    inject: sectionInjected,
  }, MediaSettingsSection))

  ctx.slots.inject('tool.call.toolview', function* () {
    yield ctx.slots.register({
      name: 'tool.call.toolview', key: 'generate_image', locale: NS,
    }, MediaToolCard)
    yield ctx.slots.register({
      name: 'tool.call.toolview', key: 'generate_video', locale: NS,
    }, MediaToolCard)
  })
}
