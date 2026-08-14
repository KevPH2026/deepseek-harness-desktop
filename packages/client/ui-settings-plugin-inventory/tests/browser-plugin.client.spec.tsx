// @vitest-environment jsdom
import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject, NS } from '../src/client/index.ts'
import { PluginInventorySettingsTab } from '../src/client/PluginInventorySettingsTab.tsx'
import type { PluginInventorySettingsTabInjected } from '../src/client/PluginInventorySettingsTab.tsx'
import { PluginMarketplaceSettingsTab } from '../src/client/PluginMarketplaceSettingsTab.tsx'
import type { PluginMarketplaceSettingsTabInjected } from '../src/client/PluginMarketplaceSettingsTab.tsx'

usePinnedBrowserLanguages('zh-CN')
afterEach(cleanup)

const EMPTY = { entries: [] }
const EMPTY_MARKETPLACE = {
  status: 'empty' as const,
  items: [],
  publicOffers: [],
  fromCache: false,
  nextRefreshAt: 1,
}
const RESOURCES = {
  topicUrl: 'https://github.com/topics/dsh-plugin',
  docsUrl: 'https://example.test/docs',
  publishGuideUrl: 'https://example.test/publish',
  template: { files: [] },
}
type ListResult =
  | { readonly ok: true; readonly value: typeof EMPTY }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  class RemoteService extends Service {
    constructor(serviceCtx: Context) {
      super(serviceCtx, 'remote')
    }
  }
  new RemoteService(ctx)
  const list = vi.fn<() => Promise<ListResult>>()
    .mockResolvedValue({ ok: true, value: EMPTY })
  ctx.provide('remote.pluginInventory', { list })
  const catalog = vi.fn(async () => ({ ok: true as const, value: EMPTY_MARKETPLACE }))
  const resources = vi.fn(async () => ({ ok: true as const, value: RESOURCES }))
  const validateCatalogItem = vi.fn(async () => ({
    ok: true as const,
    value: { ok: false as const, error: { code: 'catalog-item-not-found' as const, message: 'missing' } },
  }))
  ctx.provide('remote.pluginMarketplace', { catalog, resources, validateCatalogItem })
  return {
    ctx,
    slots: ctx.get('slots') as SlotRegistry,
    locale,
    list,
    catalog,
    resources,
    validateCatalogItem,
  }
}

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: { 'settings.plugins.tab': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

describe('ui-settings-plugin-inventory browser plugin', () => {
  it('declares only the services used by the Settings Remote contribution', () => {
    expect(inject).toEqual([
      'slots', 'locale', 'remote', 'remote.pluginInventory', 'remote.pluginMarketplace',
    ])
  })

  it('registers a localized tab without reading the Remote eagerly', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    const entry = b.slots.entries('settings.plugins.tab')[0]!
    const marketplace = b.slots.entries('settings.plugins.tab')[1]!
    expect(entry.component).toBe(PluginInventorySettingsTab)
    expect(entry.options).toMatchObject({ id: 'all', order: 10 })
    expect(entry.locale).toBe(NS)
    expect(resolveSlotLabel(entry.options.label)).toBe('插件列表')
    expect(b.list).not.toHaveBeenCalled()
    expect(marketplace.component).toBe(PluginMarketplaceSettingsTab)
    expect(marketplace.options).toMatchObject({ id: 'marketplace', order: 20 })
    expect(resolveSlotLabel(marketplace.options.label)).toBe('第三方插件市场')
    expect(b.catalog).not.toHaveBeenCalled()
    expect(b.resources).not.toHaveBeenCalled()
    expect(b.validateCatalogItem).not.toHaveBeenCalled()

    const injected = (entry.inject as unknown as () => PluginInventorySettingsTabInjected)()
    await expect(injected.list()).resolves.toEqual(EMPTY)
    expect(b.list).toHaveBeenCalledOnce()
    b.list.mockResolvedValueOnce({ ok: false, error: { code: 'REMOTE_ERROR', message: 'unavailable' } })
    await expect(injected.list()).rejects.toThrow('pluginInventory.list failed: REMOTE_ERROR: unavailable')
    const marketplaceInjected = (
      marketplace.inject as unknown as () => PluginMarketplaceSettingsTabInjected
    )()
    await expect(marketplaceInjected.catalog({ category: 'design' })).resolves.toEqual(EMPTY_MARKETPLACE)
    await expect(marketplaceInjected.resources()).resolves.toEqual(RESOURCES)
    await expect(marketplaceInjected.validateCatalogItem('missing')).resolves.toMatchObject({ ok: false })
    await b.ctx.fiber.dispose()
  })

  it('follows locale and recovers across late declaration and declarer reload', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries('settings.plugins.tab')).toHaveLength(0)

    const stop = declare(b.slots)
    await vi.waitFor(() => { expect(b.slots.entries('settings.plugins.tab')).toHaveLength(2) })
    b.locale.setLocale('en')
    expect(resolveSlotLabel(b.slots.entries('settings.plugins.tab')[0]!.options.label)).toBe('Plugin list')
    expect(resolveSlotLabel(b.slots.entries('settings.plugins.tab')[1]!.options.label)).toBe('Third-party marketplace')

    stop()
    expect(b.slots.entries('settings.plugins.tab')).toHaveLength(0)
    declare(b.slots)
    await vi.waitFor(() => {
      expect(b.slots.entries('settings.plugins.tab')).toHaveLength(2)
    })

    await fiber.dispose()
    expect(b.slots.entries('settings.plugins.tab')).toHaveLength(0)
    expect(() => b.locale.register(NS, 'zh', {})).not.toThrow()
    await b.ctx.fiber.dispose()
  })
})
