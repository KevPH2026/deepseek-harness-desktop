/** Read-only Host plugin inventory registered into Web Settings. */

import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { PluginInventorySettingsTab, type PluginInventorySettingsTabInjected } from './PluginInventorySettingsTab.tsx'
import {
  PluginMarketplaceSettingsTab,
  type PluginMarketplaceSettingsTabInjected,
} from './PluginMarketplaceSettingsTab.tsx'
import { en, zh, type PluginInventoryLocaleKey } from './locales.ts'

export type { PluginInventorySettingsTabInjected, PluginInventorySettingsTabProps } from './PluginInventorySettingsTab.tsx'
export type {
  PluginMarketplaceSettingsTabInjected,
  PluginMarketplaceSettingsTabProps,
} from './PluginMarketplaceSettingsTab.tsx'
export { verifiedPartnerOffers } from './PluginMarketplaceSettingsTab.tsx'
export type { PluginInventoryLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Read-only Host plugin inventory copy. */
    'settings.pluginInventory': PluginInventoryLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.pluginInventory'

/** Services required by the Settings registration and generated Remote face. */
export const inject = [
  'slots',
  'locale',
  'remote',
  'remote.pluginInventory',
  'remote.pluginMarketplace',
]

/** Contribute the lazy inventory tab to the Plugins settings section. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-plugin-inventory: dictionaries')

  const t = ctx.locale.bind(NS)
  const list: PluginInventorySettingsTabInjected['list'] = async () => {
    const result = await ctx.remote.pluginInventory.list()
    if (!result.ok) {
      throw new Error(`pluginInventory.list failed: ${result.error.code}: ${result.error.message}`)
    }
    return result.value
  }
  const injected = (): PluginInventorySettingsTabInjected => ({ list })
  const marketplaceInjected = (): PluginMarketplaceSettingsTabInjected => ({
    catalog: async (request) => {
      const result = await ctx.remote.pluginMarketplace.catalog(request)
      if (!result.ok) {
        throw new Error(`pluginMarketplace.catalog failed: ${result.error.code}: ${result.error.message}`)
      }
      return result.value
    },
    resources: async () => {
      const result = await ctx.remote.pluginMarketplace.resources()
      if (!result.ok) {
        throw new Error(`pluginMarketplace.resources failed: ${result.error.code}: ${result.error.message}`)
      }
      return result.value
    },
    validateCatalogItem: async (itemId) => {
      const result = await ctx.remote.pluginMarketplace.validateCatalogItem({ itemId })
      if (!result.ok) {
        throw new Error(`pluginMarketplace.validateCatalogItem failed: ${result.error.code}: ${result.error.message}`)
      }
      return result.value
    },
    curatedBundleStatus: async () => {
      const result = await ctx.remote.pluginMarketplace.curatedBundleStatus()
      if (!result.ok) {
        throw new Error('pluginMarketplace.curatedBundleStatus failed')
      }
      return result.value
    },
    installCuratedBundle: async (acknowledgedRisk) => {
      const result = await ctx.remote.pluginMarketplace.installCuratedBundle({ acknowledgedRisk })
      if (!result.ok) {
        throw new Error('pluginMarketplace.installCuratedBundle failed')
      }
      return result.value
    },
    uninstallCuratedBundle: async () => {
      const result = await ctx.remote.pluginMarketplace.uninstallCuratedBundle()
      if (!result.ok) {
        throw new Error('pluginMarketplace.uninstallCuratedBundle failed')
      }
      return result.value
    },
  })

  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'all',
    order: 10,
    label: () => t('tab'),
    locale: NS,
    inject: injected,
  }, PluginInventorySettingsTab))

  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'marketplace',
    order: 20,
    label: () => t('marketTab'),
    locale: NS,
    inject: marketplaceInjected,
  }, PluginMarketplaceSettingsTab))
}
