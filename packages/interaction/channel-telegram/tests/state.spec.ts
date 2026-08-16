import { describe, expect, it } from 'vitest'
import {
  disableTelegramState,
  enableTelegramState,
  revokeTelegramState,
} from '../src/state.ts'
import type { TelegramDurableState } from '../src/spec.ts'

const OLD_BOT = { id: '1', username: 'OldBot', firstName: 'Old' }
const NEW_BOT = { id: '2', username: 'NewBot', firstName: 'New' }

describe('Telegram desired-state transitions', () => {
  it('disable preserves bot, offset, pairing, and binding', () => {
    const state: TelegramDurableState = {
      enabled: true,
      bot: OLD_BOT,
      nextUpdateOffset: 81,
      binding: { userId: '3', chatId: '3', firstName: 'User', confirmedAt: 9 },
      activationBarrier: { generation: 'AAAAAAAAAAAAAAAAAAAAAA', messageDateCutoff: 7 },
    }
    expect(disableTelegramState(state)).toEqual({
      enabled: false,
      bot: OLD_BOT,
      nextUpdateOffset: 81,
      binding: state.binding,
    })
  })

  it('revoke clears the old bot and offset so a new bot starts fresh', () => {
    const revoked = revokeTelegramState({ enabled: true })
    expect(revoked).toEqual({ enabled: false })

    const begunWithNewBot = enableTelegramState(revoked, NEW_BOT)
    expect(begunWithNewBot).toEqual({ enabled: true, bot: NEW_BOT })
    expect(begunWithNewBot?.nextUpdateOffset).toBeUndefined()
    expect(revokeTelegramState({ enabled: true, proxyUrl: 'http://127.0.0.1:7890/' }).proxyUrl)
      .toBe('http://127.0.0.1:7890/')
  })

  it('rejects a different bot until explicit revoke', () => {
    const state: TelegramDurableState = { enabled: false, bot: OLD_BOT, nextUpdateOffset: 81 }
    expect(enableTelegramState(state, NEW_BOT)).toBeUndefined()
    expect(enableTelegramState(state, OLD_BOT)).toEqual({ ...state, enabled: true })
  })

  it('clears the disabled backlog marker only when enablement commits', () => {
    const state: TelegramDurableState = {
      enabled: false,
      bot: OLD_BOT,
      disabledBacklog: { generation: 'AAAAAAAAAAAAAAAAAAAAAA', cutoffOffset: 81 },
    }
    expect(enableTelegramState(state, OLD_BOT)).toEqual({ enabled: true, bot: OLD_BOT })
    expect(disableTelegramState(state)).toEqual(state)
  })
})
