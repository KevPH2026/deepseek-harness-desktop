import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { TestRemote, usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { ProfileSettingsSection } from '../src/client/ProfileSettingsSection.tsx'
import { PublicProfileOnboarding } from '../src/client/PublicProfileOnboarding.tsx'
import { apply, inject } from '../src/client/index.ts'

usePinnedBrowserLanguages('zh-CN')

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: {
      'settings.section': { kind: 'list', scope: 'root' },
      'settings.onboarding': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
}

async function bench(loopback: boolean) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  const remote = new TestRemote(ctx)
  const describe = vi.fn(async () => ({
    rpcId: 'describe',
    result: {
      ok: true as const,
      value: {
        writable: true,
        hasDocument: true,
        namespaces: [{
          ns: 'user-profile', schema: {}, value: {}, revision: 0, applies: 'live' as const, secrets: [],
        }],
      },
    },
  }))
  ctx.provide('connection', {
    isLoopback: loopback,
    api: { settings: { describe, mutate: vi.fn() } },
  } as never)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale, remote, describe, fiber }
}

describe('ui-settings-profile apply', () => {
  it('declares only the standard local Settings services', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection', 'remote'])
  })

  it('registers profile order 5 and onboarding order -50 only on loopback', async () => {
    const local = await bench(true)
    declare(local.slots)
    await Promise.resolve()
    const section = local.slots.entries('settings.section')[0]!
    expect(section.component).toBe(ProfileSettingsSection)
    expect(section.options).toMatchObject({ id: 'profile', order: 5 })
    expect(resolveSlotLabel(section.options.label)).toBe('个人资料')
    const onboarding = local.slots.entries('settings.onboarding')[0]!
    expect(onboarding.component).toBe(PublicProfileOnboarding)
    expect(onboarding.options).toMatchObject({ id: 'public-profile', order: -50 })
    await vi.waitFor(() => { expect(local.describe).toHaveBeenCalledTimes(1) })
    await local.fiber.dispose()

    const remote = await bench(false)
    declare(remote.slots)
    await Promise.resolve()
    expect(remote.slots.entries('settings.section')).toHaveLength(0)
    expect(remote.slots.entries('settings.onboarding')).toHaveLength(0)
    expect(remote.describe).not.toHaveBeenCalled()
    await remote.fiber.dispose()
  })

  it('refreshes only the addressed settings namespace and follows locale', async () => {
    const b = await bench(true)
    declare(b.slots)
    await vi.waitFor(() => { expect(b.describe).toHaveBeenCalledTimes(1) })
    b.remote.$dispatch('settings/document-updated', ['ui-theme'])
    await Promise.resolve()
    expect(b.describe).toHaveBeenCalledTimes(1)
    b.remote.$dispatch('settings/document-updated', ['user-profile'])
    await vi.waitFor(() => { expect(b.describe).toHaveBeenCalledTimes(2) })
    b.locale.setLocale('en')
    expect(resolveSlotLabel(b.slots.entries('settings.section')[0]!.options.label)).toBe('Profile')
    await b.fiber.dispose()
  })
})
