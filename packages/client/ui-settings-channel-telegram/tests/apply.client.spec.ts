/** Loopback registration, Remote adapter, and lifecycle contract. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { TestRemote, usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import type { TelegramChannelStatus } from '@deepseek-ai/dsh-api-remotes/client'
import { TelegramSettingsSection } from '../src/client/TelegramSettingsSection.tsx'
import type { TelegramSettingsInjected } from '../src/client/TelegramSettingsSection.tsx'
import { apply, inject } from '../src/client/index.ts'
import { TELEGRAM_BOT_TOKEN_REF } from '../src/client/settings-store.ts'

usePinnedBrowserLanguages('zh-CN')

const STATUS: TelegramChannelStatus = {
  enabled: false,
  credentialConfigured: true,
  runtime: 'disabled',
  pairing: { kind: 'unpaired' },
}

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: { 'settings.section': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

function telegramInjected(value: unknown): TelegramSettingsInjected {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('Telegram Settings injection is missing')
  }
  const record = value as Record<string, unknown>
  const hooks = record.hooks
  const methods = [
    'refreshTelegram',
    'saveTelegramToken',
    'removeTelegramToken',
    'saveTelegramProxy',
    'setTelegramEnabled',
    'beginTelegramPairing',
    'confirmTelegramPairing',
    'revokeTelegramBinding',
  ] as const
  if (
    typeof hooks !== 'object' || hooks === null || !('telegramSettings' in hooks)
    || methods.some(method => typeof record[method] !== 'function')
  ) {
    throw new TypeError('Telegram Settings injection has an invalid shape')
  }
  return value as unknown as TelegramSettingsInjected
}

async function bench(loopback: boolean) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  const eventRemote = new TestRemote(ctx) as TestRemote & {
    channelTelegram: {
      status: () => Promise<unknown>
      enable: () => Promise<unknown>
      disable: () => Promise<unknown>
      beginPairing: () => Promise<unknown>
      confirmPairing: (request: { candidateId: string }) => Promise<unknown>
      revoke: () => Promise<unknown>
    }
  }
  let currentStatus = STATUS
  let transportFailure = false
  function transport<T>(value: T) {
    return transportFailure
      ? { ok: false as const, error: { code: 'transport', message: 'offline' } }
      : { ok: true as const, value }
  }
  const status = vi.fn(async () => transport(currentStatus))
  const enable = vi.fn(async () => transport({
    ok: true as const,
    value: { ...currentStatus, enabled: true, runtime: 'polling' as const },
  }))
  const disable = vi.fn(async () => transport({ ...currentStatus, enabled: false, runtime: 'disabled' as const }))
  const beginPairing = vi.fn(async () => transport({
    ok: true as const,
    value: {
      token: 'pair-capability',
      deepLink: 'https://t.me/desktop_bot?start=pair-capability',
      expiresAt: 2_000_000,
      status: {
        ...currentStatus,
        enabled: true,
        runtime: 'polling' as const,
        pairing: { kind: 'waiting' as const, expiresAt: 2_000_000 },
      },
    },
  }))
  const pairedStatus: TelegramChannelStatus = {
    ...STATUS,
    enabled: true,
    runtime: 'polling',
    pairing: {
      kind: 'paired',
      account: { userId: '61', chatId: '62', firstName: 'Owner', confirmedAt: 1_000_000 },
    },
  }
  const confirmPairing = vi.fn(async () => transport({ ok: true as const, value: pairedStatus }))
  const revoke = vi.fn(async () => transport(STATUS))
  eventRemote.channelTelegram = {
    status,
    enable,
    disable,
    beginPairing,
    confirmPairing,
    revoke,
  }
  const describe = vi.fn(async () => ({
    rpcId: 'telegram-describe',
    result: {
      ok: true as const,
      value: {
        credentials: {
          [TELEGRAM_BOT_TOKEN_REF]: { configured: true, writable: true },
        },
      },
    },
  }))
  ctx.provide('connection', {
    isLoopback: loopback,
    api: {
      credentials: {
        describe,
        set: async () => ({ rpcId: 'set', result: { ok: true as const, value: {} } }),
        unset: async () => ({ rpcId: 'unset', result: { ok: true as const, value: {} } }),
      },
    },
  } as never)
  const fiber = ctx.plugin({
    inject: ['slots', 'locale', 'connection', 'remote'],
    apply: (scope) => { apply(scope) },
  })
  await fiber.await()
  return {
    ctx,
    slots: ctx.get('slots') as SlotRegistry,
    locale,
    eventRemote,
    status,
    enable,
    disable,
    beginPairing,
    confirmPairing,
    revoke,
    describe,
    fiber,
    setStatus: (next: TelegramChannelStatus) => { currentStatus = next },
    setTransportFailure: (next: boolean) => { transportFailure = next },
  }
}

describe('ui-settings-channel-telegram apply', () => {
  it('declares the generated Telegram Remote and local UI services', () => {
    expect(inject).toEqual([
      'slots', 'locale', 'connection', 'remote', 'remote.channelTelegram',
    ])
  })

  it('registers remote-channels at order 30 only on loopback', async () => {
    const local = await bench(true)
    declare(local.slots)
    await Promise.resolve()
    const entry = local.slots.entries('settings.section')[0]!
    expect(entry.component).toBe(TelegramSettingsSection)
    expect(entry.options).toMatchObject({ id: 'remote-channels', order: 30 })
    expect(resolveSlotLabel(entry.options.label)).toBe('Telegram 远程控制')
    local.locale.setLocale('en')
    expect(resolveSlotLabel(entry.options.label)).toBe('Telegram Remote')
    const injected = telegramInjected(entry.inject?.())
    expect(injected.hooks.telegramSettings).toBeDefined()
    await vi.waitFor(() => { expect(local.status).toHaveBeenCalled() })
    await local.fiber.dispose()

    const remote = await bench(false)
    declare(remote.slots)
    await Promise.resolve()
    expect(remote.slots.entries('settings.section')).toHaveLength(0)
    expect(remote.status).not.toHaveBeenCalled()
    expect(remote.describe).not.toHaveBeenCalled()
    await remote.fiber.dispose()
  })

  it('refreshes the addressed credential and connection reset, then tears down cleanly', async () => {
    const b = await bench(true)
    declare(b.slots)
    await vi.waitFor(() => { expect(b.describe).toHaveBeenCalledTimes(1) })
    b.eventRemote.$dispatch('credentials/updated', ['ANOTHER_SECRET'])
    await Promise.resolve()
    expect(b.describe).toHaveBeenCalledTimes(1)
    b.eventRemote.$dispatch('credentials/updated', [TELEGRAM_BOT_TOKEN_REF])
    await vi.waitFor(() => { expect(b.describe).toHaveBeenCalledTimes(2) })
    b.ctx.emit('connection/reset')
    await vi.waitFor(() => { expect(b.describe).toHaveBeenCalledTimes(3) })
    await b.fiber.dispose()
    expect(b.slots.entries('settings.section')).toHaveLength(0)
    b.eventRemote.$dispatch('credentials/updated', [TELEGRAM_BOT_TOKEN_REF])
    await Promise.resolve()
    expect(b.describe).toHaveBeenCalledTimes(3)
  })

  it('adapts every Telegram Remote method and contains transport failures in the controller', async () => {
    const b = await bench(true)
    declare(b.slots)
    await Promise.resolve()
    const entry = b.slots.entries('settings.section')[0]!
    const injected = telegramInjected(entry.inject?.())
    await vi.waitFor(() => { expect(injected.hooks.telegramSettings.getSnapshot().status).toBe('ready') })

    await expect(injected.setTelegramEnabled(true)).resolves.toBe(true)
    expect(b.enable).toHaveBeenCalledTimes(1)
    await expect(injected.setTelegramEnabled(false)).resolves.toBe(true)
    expect(b.disable).toHaveBeenCalledTimes(1)
    await expect(injected.setTelegramEnabled(true)).resolves.toBe(true)
    await expect(injected.beginTelegramPairing()).resolves.toBe(true)
    expect(b.beginPairing).toHaveBeenCalledTimes(1)

    b.setStatus({
      ...STATUS,
      enabled: true,
      runtime: 'polling',
      pairing: {
        kind: 'candidate',
        candidate: {
          candidateId: '00000000-0000-4000-8000-000000000061',
          userId: '61',
          chatId: '62',
          firstName: 'Owner',
          receivedAt: 1_000_000,
          expiresAt: 2_000_000,
        },
      },
    })
    await injected.refreshTelegram()
    await expect(injected.confirmTelegramPairing('00000000-0000-4000-8000-000000000061')).resolves.toBe(true)
    expect(b.confirmPairing).toHaveBeenCalledTimes(1)
    await expect(injected.revokeTelegramBinding('telegram:61:62')).resolves.toBe(true)
    expect(b.revoke).toHaveBeenCalledTimes(1)
    await expect(injected.removeTelegramToken()).resolves.toBe(true)
    expect(b.revoke).toHaveBeenCalledTimes(2)

    b.setTransportFailure(true)
    await injected.refreshTelegram()
    expect(injected.hooks.telegramSettings.getSnapshot().error).toBe('refresh')
    await b.fiber.dispose()
  })
})
