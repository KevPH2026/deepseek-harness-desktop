/** About & Community section registration and lifecycle contract. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { apply, inject, NS } from '@deepseek-ai/dsh-client-ui-settings-about-community/client'
import { AboutCommunitySection } from '../src/client/AboutCommunitySection.tsx'
import type { AboutCommunitySectionInjected } from '../src/client/AboutCommunitySection.tsx'

usePinnedBrowserLanguages('zh-CN')

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale }
}

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: { 'settings.section': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

describe('ui-settings-about-community apply', () => {
  it('declares only the services used by the static page', () => {
    expect(inject).toEqual(['slots', 'locale'])
  })

  it('registers after early or late section declaration and follows locale', async () => {
    const early = await bench()
    declare(early.slots)
    await early.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = early.slots.entries('settings.section')[0]!
    expect(entry.component).toBe(AboutCommunitySection)
    expect(entry.options).toMatchObject({
      id: 'about-community',
      order: 100,
    })
    expect(resolveSlotLabel(entry.options.label)).toBe('关于与社区')
    const injected = (entry.inject as unknown as () => AboutCommunitySectionInjected)()
    expect(injected.t('unofficialBody')).toContain('不是 DeepSeek 官方桌面产品')

    early.locale.setLocale('en')
    expect(resolveSlotLabel(entry.options.label)).toBe('About & Community')
    expect(injected.t('edition')).toBe('Unofficial community edition')

    const late = await bench()
    await late.ctx.plugin({ inject: [...inject], apply }).await()
    expect(late.slots.entries('settings.section')).toHaveLength(0)
    declare(late.slots)
    await Promise.resolve()
    expect(late.slots.entries('settings.section')[0]!.component).toBe(AboutCommunitySection)
  })

  it('re-registers after a declaration collapse and tears down cleanly', async () => {
    const b = await bench()
    const removeDeclaration = declare(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries('settings.section')).toHaveLength(1)

    removeDeclaration()
    expect(b.slots.entries('settings.section')).toHaveLength(0)
    declare(b.slots)
    await Promise.resolve()
    expect(b.slots.entries('settings.section')).toHaveLength(1)

    await fiber.dispose()
    expect(b.slots.entries('settings.section')).toHaveLength(0)
    expect(() => b.locale.register(NS, 'zh', {})).not.toThrow()
    expect(() => b.locale.register(NS, 'en', {})).not.toThrow()
  })
})
