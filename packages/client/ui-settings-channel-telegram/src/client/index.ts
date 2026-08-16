/** Loopback-only Telegram Settings contribution, browser half. */

import type {
  ConnectionHandle,
  TelegramBeginPairingResult,
  TelegramChannelStatus,
  TelegramConfirmPairingResult,
  TelegramEnableResult,
  TelegramSetProxyResult,
} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  TelegramSettingsSection, type TelegramSettingsInjected,
} from './TelegramSettingsSection.tsx'
import {
  en, NS, zh, type TelegramSettingsLocaleKey,
} from './locales.ts'
import {
  TelegramSettingsController, type TelegramRemotePort,
} from './settings-store.ts'

export type { TelegramSettingsInjected, TelegramSettingsSectionProps } from './TelegramSettingsSection.tsx'
export type { TelegramSettingsLocaleKey } from './locales.ts'
export {
  TELEGRAM_BOT_TOKEN_REF,
  TelegramSettingsController,
} from './settings-store.ts'
export type {
  TelegramAccountIdentity,
  TelegramCredentialState,
  TelegramPairingLink,
  TelegramRemotePort,
  TelegramRuntimeStatus,
  TelegramSettingsAction,
  TelegramSettingsControllerFace,
  TelegramSettingsError,
  TelegramSettingsState,
  TelegramSettingsSuccess,
} from './settings-store.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Local Telegram channel setup and pairing copy. */
    'settings.channelTelegram': TelegramSettingsLocaleKey
  }
}

/** Services required by the local Telegram Settings contribution. */
export const inject = [
  'slots',
  'locale',
  'connection',
  'remote',
  'remote.channelTelegram',
]

function valueOf<T>(
  result: { readonly ok: true; readonly value: T } | { readonly ok: false },
): T {
  if (!result.ok) throw new Error('Telegram Remote request failed')
  return result.value
}

/** Register the Telegram page only for the desktop's loopback connection. */
export function apply(ctx: ClientContext): void {
  const connection = ctx.get('connection') as ConnectionHandle
  if (!connection.isLoopback) return

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-channel-telegram: dictionaries')

  const remote: TelegramRemotePort = {
    status: async (): Promise<TelegramChannelStatus> => valueOf(await ctx.remote.channelTelegram.status()),
    enable: async (): Promise<TelegramEnableResult> => valueOf(await ctx.remote.channelTelegram.enable()),
    disable: async (): Promise<TelegramChannelStatus> => valueOf(await ctx.remote.channelTelegram.disable()),
    beginPairing: async (): Promise<TelegramBeginPairingResult> =>
      valueOf(await ctx.remote.channelTelegram.beginPairing()),
    confirmPairing: async (request): Promise<TelegramConfirmPairingResult> =>
      valueOf(await ctx.remote.channelTelegram.confirmPairing(request)),
    revoke: async (): Promise<TelegramChannelStatus> => valueOf(await ctx.remote.channelTelegram.revoke()),
    setProxy: async (request): Promise<TelegramSetProxyResult> =>
      valueOf(await ctx.remote.channelTelegram.setProxy(request)),
  }
  const controller = new TelegramSettingsController(connection.api, remote)
  const injected = (): TelegramSettingsInjected => ({
    hooks: { telegramSettings: controller.store },
    refreshTelegram: controller.refresh,
    saveTelegramToken: controller.saveToken,
    removeTelegramToken: controller.removeToken,
    saveTelegramProxy: controller.saveProxy,
    setTelegramEnabled: controller.setEnabled,
    beginTelegramPairing: controller.beginPairing,
    confirmTelegramPairing: controller.confirmPairing,
    revokeTelegramBinding: controller.revokeBinding,
  })

  ctx.effect(() => {
    void controller.load()
    const disposers = [
      ctx.remote.$on('credentials/updated', (ref) => { controller.refreshCredential(ref) }),
      ctx.on('connection/reset', () => { void controller.refresh() }),
    ]
    return () => {
      controller.dispose()
      for (const dispose of disposers) dispose()
    }
  }, 'ui-settings-channel-telegram: controller')

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'remote-channels',
    order: 30,
    label: () => ctx.locale.bind(NS)('nav'),
    locale: NS,
    inject: injected,
  }, TelegramSettingsSection))
}
