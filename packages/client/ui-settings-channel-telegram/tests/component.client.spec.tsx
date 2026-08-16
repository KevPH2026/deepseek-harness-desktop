// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import {
  TelegramSettingsSection, type TelegramSettingsSectionProps,
} from '../src/client/TelegramSettingsSection.tsx'
import { en, zh } from '../src/client/locales.ts'
import type { TelegramSettingsState } from '../src/client/settings-store.ts'

afterEach(() => {
  cleanup()
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
})

function state(overrides: Partial<TelegramSettingsState> = {}): TelegramSettingsState {
  return {
    status: 'ready',
    writable: true,
    enabled: false,
    runtime: 'disabled',
    credential: {
      ref: 'TELEGRAM_BOT_TOKEN',
      status: 'ready',
      configured: true,
      writable: true,
    },
    pairing: null,
    pairingPhase: 'unpaired',
    candidate: null,
    bindings: [],
    action: 'idle',
    error: null,
    success: null,
    ...overrides,
  }
}

const t: TelegramSettingsSectionProps['t'] = makeTranslate(zh, commonZh)

function props(snapshot: TelegramSettingsState, overrides: Partial<TelegramSettingsSectionProps> = {}) {
  const useTelegramSettings: TelegramSettingsSectionProps['useTelegramSettings'] = selector => selector(snapshot)
  return {
    useTelegramSettings,
    refreshTelegram: vi.fn(async () => {}),
    saveTelegramToken: vi.fn(async (_token: string) => true),
    removeTelegramToken: vi.fn(async () => true),
    saveTelegramProxy: vi.fn(async (_proxyUrl: string) => true),
    setTelegramEnabled: vi.fn(async (_enabled: boolean) => true),
    beginTelegramPairing: vi.fn(async () => true),
    confirmTelegramPairing: vi.fn(async (_candidateId: string) => true),
    revokeTelegramBinding: vi.fn(async (_bindingId: string) => true),
    t,
    ...overrides,
  } as unknown as TelegramSettingsSectionProps
}

describe('TelegramSettingsSection', () => {

  it('saves a proxy override draft and restores direct connection on demand', async () => {
    const saveProxy = vi.fn(async (_proxyUrl: string) => true)
    const direct = render(<TelegramSettingsSection {...props(state(), { saveTelegramProxy: saveProxy })} />)
    expect(direct.container.textContent).toContain('当前：直连')
    expect(screen.queryByRole('button', { name: '恢复直连' })).toBeNull()
    const input = direct.container.querySelector('#telegram-proxy-url') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'http://127.0.0.1:7890' } })
    fireEvent.click(screen.getByRole('button', { name: '保存代理' }))
    await vi.waitFor(() => { expect(saveProxy).toHaveBeenCalledWith('http://127.0.0.1:7890') })
    cleanup()

    const proxied = render(<TelegramSettingsSection {...props(state({
      proxyUrl: 'http://127.0.0.1:7890/',
    }), { saveTelegramProxy: saveProxy })} />)
    expect(proxied.container.textContent).toContain('当前：http://127.0.0.1:7890/')
    fireEvent.click(screen.getByRole('button', { name: '恢复直连' }))
    await vi.waitFor(() => { expect(saveProxy).toHaveBeenCalledWith('') })
  })

  it('renders loading, unavailable, and retryable error states', () => {
    const loading = render(<TelegramSettingsSection {...props(state({ status: 'loading' }))} />)
    expect(loading.container.textContent).toBe('正在加载 Telegram 设置…')
    cleanup()
    render(<TelegramSettingsSection {...props(state({ status: 'unavailable' }))} />)
    expect(screen.getByText('当前 Host 未提供 Telegram 远程通道。')).not.toBeNull()
    cleanup()
    const refresh = vi.fn(async () => {})
    render(<TelegramSettingsSection {...props(state({ status: 'error' }), { refreshTelegram: refresh })} />)
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('keeps the password draft in the component and clears it after a successful write', async () => {
    const save = vi.fn(async (_token: string) => true)
    const view = render(<TelegramSettingsSection {...props(state(), { saveTelegramToken: save })} />)
    const input = view.container.querySelector('#telegram-bot-token') as HTMLInputElement
    expect(input.type).toBe('password')
    expect(input.autocomplete).toBe('off')
    fireEvent.change(input, { target: { value: '123456:private-token' } })
    expect(input.value).toBe('123456:private-token')
    expect(view.container.textContent).not.toContain('123456:private-token')
    fireEvent.click(screen.getByRole('button', { name: '保存 Token' }))
    await vi.waitFor(() => { expect(save).toHaveBeenCalledWith('123456:private-token') })
    await vi.waitFor(() => { expect(input.value).toBe('') })
    const botFather = screen.getByRole('link', { name: '打开 BotFather' })
    expect(botFather.getAttribute('href')).toBe('https://t.me/BotFather')
    expect(botFather.getAttribute('rel')).toContain('noreferrer')
  })

  it('requires an explicit risk acknowledgement before enabling', async () => {
    const setEnabled = vi.fn(async (_enabled: boolean) => true)
    render(<TelegramSettingsSection {...props(state(), { setTelegramEnabled: setEnabled })} />)
    fireEvent.click(screen.getByRole('button', { name: '启用' }))
    const dialog = screen.getByRole('dialog', { name: '启用 Telegram 远程控制？' })
    expect(within(dialog).getByText(/本机在线时发起纯文本推理和 web_search/)).not.toBeNull()
    expect(within(dialog).getByText(/Bot 私聊不是端到端加密，消息会由 Telegram 处理/)).not.toBeNull()
    expect(within(dialog).getByText(/消耗你配置的模型与搜索额度/)).not.toBeNull()
    expect(within(dialog).getByText(/不要发送 API Key、密码、Token 或其他密钥/)).not.toBeNull()
    expect(within(dialog).getByText(/不能访问本地文件，也不能调用 Shell、PowerShell/)).not.toBeNull()
    expect(within(dialog).getByText(/激活期间提供方可能拉取并检查一批更新/)).not.toBeNull()
    expect(within(dialog).getByText(/保持停用，不执行、不确认、不推进 offset，也不清空/)).not.toBeNull()
    const confirm = screen.getByRole('button', { name: '确认启用' })
    expect(confirm.hasAttribute('disabled')).toBe(true)
    expect(setEnabled).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('checkbox', {
      name: '我了解本机必须在线、Telegram 会处理非端到端加密的 Bot 消息、任务会消耗模型和搜索额度，并承诺不发送密钥',
    }))
    expect(confirm.hasAttribute('disabled')).toBe(false)
    fireEvent.click(confirm)
    await vi.waitFor(() => { expect(setEnabled).toHaveBeenCalledWith(true) })
  })

  it('disables directly but refuses to enable without a configured credential', () => {
    const setEnabled = vi.fn(async (_enabled: boolean) => true)
    const enabled = render(<TelegramSettingsSection {...props(state({
      enabled: true, runtime: 'online',
    }), { setTelegramEnabled: setEnabled })} />)
    fireEvent.click(screen.getByRole('button', { name: '停用' }))
    expect(setEnabled).toHaveBeenCalledWith(false)
    enabled.unmount()

    render(<TelegramSettingsSection {...props(state({
      credential: { ref: 'TELEGRAM_BOT_TOKEN', status: 'ready', configured: false, writable: true },
    }))} />)
    expect(screen.getByRole('button', { name: '启用' }).hasAttribute('disabled')).toBe(true)
  })

  it('opens first pairing as soon as an enabled startup becomes online', () => {
    let current = state({ enabled: true, runtime: 'starting' })
    const beginPairing = vi.fn(async () => true)
    const useTelegramSettings: TelegramSettingsSectionProps['useTelegramSettings'] = selector => selector(current)
    const shared = props(current, {
      useTelegramSettings,
      beginTelegramPairing: beginPairing,
    })
    const view = render(<TelegramSettingsSection {...shared} />)

    expect(screen.getByRole('button', { name: '生成配对链接' }).hasAttribute('disabled')).toBe(true)
    current = { ...current, runtime: 'online' }
    view.rerender(<TelegramSettingsSection {...shared} />)

    const generate = screen.getByRole('button', { name: '生成配对链接' })
    expect(generate.hasAttribute('disabled')).toBe(false)
    fireEvent.click(generate)
    expect(beginPairing).toHaveBeenCalledTimes(1)
  })

  it('shows only the backlog count and keeps an explicit fail-closed recheck available', async () => {
    const setEnabled = vi.fn(async (_enabled: boolean) => false)
    const view = render(<TelegramSettingsSection {...props(state({
      enabled: false,
      runtime: 'backlog-pending',
      pendingUpdateCount: 17,
      error: 'backlog-pending',
    }), { setTelegramEnabled: setEnabled })} />)

    expect(screen.getByText('检测到积压，保持停用')).not.toBeNull()
    expect(screen.getByText('Telegram 报告 17 条积压更新')).not.toBeNull()
    expect(screen.getByText(/激活屏障可能拉取并检查一批更新，但不执行、不确认、不推进 offset，也不清空/)).not.toBeNull()
    expect(screen.getByText(/等待 Telegram 最多 24 小时让积压自动过期/)).not.toBeNull()
    expect(screen.getByText(/撤销绑定并移除 Token，再保存一个新的专用 Bot Token/)).not.toBeNull()
    expect(view.container.textContent).not.toContain('queued message body')

    const recheck = screen.getByRole('button', { name: '重新检查并启用' })
    expect(recheck.hasAttribute('disabled')).toBe(false)
    fireEvent.click(recheck)
    const dialog = screen.getByRole('dialog', { name: '启用 Telegram 远程控制？' })
    expect(within(dialog).getByText(/停用期间的消息绝不会自动执行/)).not.toBeNull()
    fireEvent.click(within(dialog).getByRole('checkbox', {
      name: '我了解本机必须在线、Telegram 会处理非端到端加密的 Bot 消息、任务会消耗模型和搜索额度，并承诺不发送密钥',
    }))
    fireEvent.click(within(dialog).getByRole('button', { name: '确认启用' }))
    await vi.waitFor(() => { expect(setEnabled).toHaveBeenCalledWith(true) })
  })

  it('shows a one-time link and confirms an exact candidate only from a desktop modal', async () => {
    const confirm = vi.fn(async (_candidateId: string) => true)
    const begin = vi.fn(async () => true)
    const writeText = vi.fn(async (_value: string) => {})
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const link = render(<TelegramSettingsSection {...props(state({
      enabled: true,
      runtime: 'online',
      pairingPhase: 'waiting',
      pairing: { url: 'https://t.me/desktop_bot?start=pair-once', code: 'PAIR-ONCE', expiresAt: 1_787_000_000_000 },
    }), { beginTelegramPairing: begin, confirmTelegramPairing: confirm })} />)
    expect(screen.getByText('配对码：PAIR-ONCE')).not.toBeNull()
    expect(screen.getByRole('link', { name: '在 Telegram 中打开' }).getAttribute('href'))
      .toBe('https://t.me/desktop_bot?start=pair-once')
    fireEvent.click(screen.getByRole('button', { name: '复制绑定链接' }))
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('https://t.me/desktop_bot?start=pair-once')
    })
    expect((await screen.findByRole('status')).textContent).toContain('绑定链接已复制')
    fireEvent.click(screen.getByRole('button', { name: '重新生成' }))
    expect(begin).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/绑定链接已复制/)).toBeNull()
    link.unmount()

    render(<TelegramSettingsSection {...props(state({
      enabled: true,
      runtime: 'online',
      pairingPhase: 'candidate',
      candidate: {
        id: 'candidate-1', userId: '9223372036854775001', chatId: '9223372036854775002',
        username: 'verified_owner', displayName: 'Verified Owner',
      },
    }), { beginTelegramPairing: begin, confirmTelegramPairing: confirm })} />)
    expect(screen.getByText('9223372036854775001')).not.toBeNull()
    expect(screen.getByText('9223372036854775002')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '在这台电脑上确认' }))
    expect(screen.getByRole('dialog', { name: '确认绑定这个账号？' })).not.toBeNull()
    expect(confirm).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '确认绑定' }))
    await vi.waitFor(() => { expect(confirm).toHaveBeenCalledWith('candidate-1') })
  })

  it('shows a selectable full pairing link when Clipboard access fails', async () => {
    const writeText = vi.fn(async () => { throw new Error('clipboard denied') })
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    render(<TelegramSettingsSection {...props(state({
      enabled: true,
      runtime: 'online',
      pairingPhase: 'waiting',
      pairing: { url: 'https://t.me/desktop_bot?start=manual-copy', code: 'MANUAL' },
    }))} />)

    fireEvent.click(screen.getByRole('button', { name: '复制绑定链接' }))
    expect((await screen.findByRole('alert')).textContent).toBe('复制失败，请选中下面的完整链接手动复制。')
    const fallback = screen.getByRole('textbox', { name: '完整绑定链接' }) as HTMLInputElement
    expect(fallback.value).toBe('https://t.me/desktop_bot?start=manual-copy')
    const select = vi.spyOn(fallback, 'select')
    fireEvent.focus(fallback)
    expect(select).toHaveBeenCalledTimes(1)
  })

  it('requires confirmation before removing the token or revoking a bound identity', async () => {
    const remove = vi.fn(async () => true)
    const revoke = vi.fn(async (_bindingId: string) => true)
    render(<TelegramSettingsSection {...props(state({
      enabled: true,
      runtime: 'online',
      bindings: [{
        id: 'binding-1', userId: '10001', chatId: '10002', username: 'owner', pairedAt: 1_787_000_000_000,
      }],
    }), { removeTelegramToken: remove, revokeTelegramBinding: revoke })} />)
    fireEvent.click(screen.getByRole('button', { name: '移除 Token' }))
    expect(remove).not.toHaveBeenCalled()
    fireEvent.click(screen.getAllByRole('button', { name: '移除 Token' }).at(-1)!)
    await vi.waitFor(() => { expect(remove).toHaveBeenCalledTimes(1) })

    fireEvent.click(screen.getByRole('button', { name: '撤销绑定' }))
    expect(revoke).not.toHaveBeenCalled()
    fireEvent.click(screen.getAllByRole('button', { name: '撤销绑定' }).at(-1)!)
    await vi.waitFor(() => { expect(revoke).toHaveBeenCalledWith('binding-1') })
  })

  it('states the exact capability, privacy, quota, identity, online, and no-secret rules', () => {
    render(<TelegramSettingsSection {...props(state())} />)
    expect(screen.getByText(/只在 Bot 私聊中使用/)).not.toBeNull()
    expect(screen.getByText(/精确的 Telegram 用户 ID 和私聊 ID/)).not.toBeNull()
    expect(screen.getByText(/电脑和客户端必须保持在线/)).not.toBeNull()
    expect(screen.getByText(/只支持纯文本推理和 web_search/)).not.toBeNull()
    expect(screen.getByText(/不能访问本地文件，也不能调用 Shell、PowerShell（pwsh）、代码执行、凭据、设置、审批、媒体、subagent 或 workflow/)).not.toBeNull()
    expect(screen.getByText(/Bot 私聊不是端到端加密；消息会由 Telegram 处理/)).not.toBeNull()
    expect(screen.getByText(/消耗你配置的模型和搜索额度/)).not.toBeNull()
    expect(screen.getByText(/停用期间发送给 Bot 的消息绝不会自动执行/)).not.toBeNull()
    expect(screen.getByText(/激活期间提供方可能拉取并检查一批更新/)).not.toBeNull()
    expect(screen.getByText(/保持停用，不执行、不确认、不推进 offset，也不清空/)).not.toBeNull()
    expect(screen.getByText(/等待最多 24 小时自动过期/)).not.toBeNull()
    expect(screen.getByText(/撤销绑定并移除 Token 后换一个新的专用 Bot/)).not.toBeNull()
    expect(screen.getByText(/不要在 Telegram 消息里发送 API Key/)).not.toBeNull()
  })

  it('renders every runtime, credential, error, and acknowledgement projection', () => {
    const runtimeCases = [
      ['disabled', '未启用'],
      ['starting', '正在连接'],
      ['online', '在线'],
      ['offline', '暂时重连中'],
      ['backlog-pending', '检测到积压，保持停用'],
      ['error', '连接异常'],
    ] as const
    for (const [runtime, label] of runtimeCases) {
      const view = render(<TelegramSettingsSection {...props(state({ runtime }))} />)
      expect(screen.getByText(label)).not.toBeNull()
      view.unmount()
    }

    const credentialCases = [
      [{ status: 'idle', configured: false, writable: true }, '正在检查'],
      [{ status: 'loading', configured: false, writable: true }, '正在检查'],
      [{ status: 'error', configured: false, writable: true }, '凭据状态不可用'],
      [{ status: 'ready', configured: false, writable: true }, '尚未配置'],
      [{ status: 'ready', configured: true, writable: false }, '已保存至本机凭据库'],
    ] as const
    for (const [credential, label] of credentialCases) {
      const view = render(<TelegramSettingsSection {...props(state({
        credential: { ref: TELEGRAM_BOT_TOKEN_REF_FOR_TEST, ...credential },
      }))} />)
      expect(screen.getByText(label)).not.toBeNull()
      if (!credential.writable || credential.status !== 'ready') {
        expect(screen.getByText('当前凭据提供方不允许修改 Token。')).not.toBeNull()
      }
      view.unmount()
    }

    const errorCases = [
      ['load', '暂时无法读取 Telegram 状态。'],
      ['refresh', '暂时无法刷新 Telegram 状态。'],
      ['token-save', 'Token 未能保存。请检查 Token 后重试。'],
      ['token-remove', 'Token 未能移除。'],
      ['enable', '未能启用 Telegram 远程控制。'],
      ['disable', '未能停用 Telegram 远程控制。'],
      ['pairing', '未能生成配对链接。'],
      ['backlog-pending', 'Telegram 仍有积压更新，客户端已保持停用。客户端不执行、不确认、不推进 offset，也不清空这些更新。'],
      ['confirm', '未能确认这个 Telegram 账号。'],
      ['revoke', '未能撤销这个 Telegram 账号。'],
    ] as const
    for (const [error, label] of errorCases) {
      const view = render(<TelegramSettingsSection {...props(state({ error }))} />)
      expect(screen.getByText(label)).not.toBeNull()
      view.unmount()
    }

    render(<TelegramSettingsSection {...props(state({
      writable: false,
      enabled: false,
      botUsername: 'desktop_bot',
      success: 'token-saved',
      bindings: [{ id: 'paused', userId: '7', chatId: '8' }],
    }))} />)
    expect(screen.getByText('当前 Telegram 设置为只读。')).not.toBeNull()
    expect(screen.getByText('Token 已保存。')).not.toBeNull()
    expect(screen.getByText('当前 Bot：@desktop_bot')).not.toBeNull()
    expect(screen.getByText('消息入口已暂停；已绑定账号仍保留。停用期间发送的消息绝不会自动执行。')).not.toBeNull()
    cleanup()
    render(<TelegramSettingsSection {...props(state({ success: 'token-removed' }))} />)
    expect(screen.getByText('Token 已移除，Telegram 连接已停止。')).not.toBeNull()
  })

  it('keeps failed component-owned mutations open and exercises explicit cancel/close paths', async () => {
    const save = vi.fn(async (_token: string) => false)
    const enable = vi.fn(async (_enabled: boolean) => false)
    const confirm = vi.fn(async (_candidateId: string) => false)
    const remove = vi.fn(async () => false)
    const revoke = vi.fn(async (_bindingId: string) => false)
    const snapshot = state({
      enabled: true,
      runtime: 'online',
      pairingPhase: 'candidate',
      candidate: { id: 'candidate-fail', userId: '11', chatId: '12' },
      bindings: [{ id: 'binding-fail', userId: '21', chatId: '22' }],
    })
    const view = render(<TelegramSettingsSection {...props(snapshot, {
      saveTelegramToken: save,
      setTelegramEnabled: enable,
      confirmTelegramPairing: confirm,
      removeTelegramToken: remove,
      revokeTelegramBinding: revoke,
    })} />)

    const input = view.container.querySelector('#telegram-bot-token') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'keep-this-local-draft' } })
    fireEvent.click(screen.getByRole('button', { name: '保存 Token' }))
    await vi.waitFor(() => { expect(save).toHaveBeenCalled() })
    expect(input.value).toBe('keep-this-local-draft')

    fireEvent.click(screen.getByRole('button', { name: '在这台电脑上确认' }))
    fireEvent.click(screen.getByRole('button', { name: '确认绑定' }))
    await vi.waitFor(() => { expect(confirm).toHaveBeenCalledWith('candidate-fail') })
    expect(screen.getByRole('dialog', { name: '确认绑定这个账号？' })).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '暂不确认' }))
    expect(screen.queryByRole('dialog', { name: '确认绑定这个账号？' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '在这台电脑上确认' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: '确认绑定这个账号？' })).getByRole('button', { name: '关闭' }))

    fireEvent.click(screen.getByRole('button', { name: '移除 Token' }))
    fireEvent.click(screen.getAllByRole('button', { name: '移除 Token' }).at(-1)!)
    await vi.waitFor(() => { expect(remove).toHaveBeenCalled() })
    expect(screen.getByRole('dialog', { name: '移除 Telegram Bot Token？' })).not.toBeNull()
    fireEvent.click(within(screen.getByRole('dialog', { name: '移除 Telegram Bot Token？' })).getByRole('button', { name: '取消' }))
    fireEvent.click(screen.getByRole('button', { name: '移除 Token' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: '移除 Telegram Bot Token？' })).getByRole('button', { name: '关闭' }))

    fireEvent.click(screen.getByRole('button', { name: '撤销绑定' }))
    fireEvent.click(screen.getAllByRole('button', { name: '撤销绑定' }).at(-1)!)
    await vi.waitFor(() => { expect(revoke).toHaveBeenCalledWith('binding-fail') })
    expect(screen.getByRole('dialog', { name: '撤销这个 Telegram 账号的访问权？' })).not.toBeNull()
    fireEvent.click(within(screen.getByRole('dialog', { name: '撤销这个 Telegram 账号的访问权？' })).getByRole('button', { name: '取消' }))
    fireEvent.click(screen.getByRole('button', { name: '撤销绑定' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: '撤销这个 Telegram 账号的访问权？' })).getByRole('button', { name: '关闭' }))

    view.unmount()
    const disabled = render(<TelegramSettingsSection {...props(state(), { setTelegramEnabled: enable })} />)
    fireEvent.click(screen.getByRole('button', { name: '启用' }))
    fireEvent.click(screen.getByRole('checkbox', {
      name: '我了解本机必须在线、Telegram 会处理非端到端加密的 Bot 消息、任务会消耗模型和搜索额度，并承诺不发送密钥',
    }))
    fireEvent.click(screen.getByRole('button', { name: '确认启用' }))
    await vi.waitFor(() => { expect(enable).toHaveBeenCalledWith(true) })
    expect(screen.getByRole('dialog', { name: '启用 Telegram 远程控制？' })).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    disabled.unmount()
  })

  it('renders transient action labels and optional timestamps without widening access', () => {
    const cases: Array<[Partial<TelegramSettingsState>, string]> = [
      [{ action: 'refreshing' }, '正在刷新…'],
      [{ action: 'enabling' }, '正在启用…'],
      [{ action: 'disabling', enabled: true }, '正在停用…'],
      [{ action: 'saving-token' }, '正在保存…'],
      [{ action: 'beginning-pairing', enabled: true, runtime: 'online' }, '正在生成…'],
      [{
        action: 'confirming-pairing', enabled: true, runtime: 'online', pairingPhase: 'candidate',
        candidate: { id: 'candidate', userId: '31', chatId: '32' },
      }, '正在确认…'],
    ]
    for (const [overrides, label] of cases) {
      const view = render(<TelegramSettingsSection {...props(state(overrides))} />)
      expect(screen.getByText(label)).not.toBeNull()
      view.unmount()
    }

    render(<TelegramSettingsSection {...props(state({
      enabled: true,
      runtime: 'online',
      pairingPhase: 'waiting',
      pairing: { url: 'https://t.me/desktop_bot?start=once', code: 'ONCE' },
      bindings: [{ id: 'no-time', userId: '41', chatId: '42' }],
    }))} />)
    expect(screen.getByText('配对码：ONCE')).not.toBeNull()
    expect(screen.queryByText(/有效期至/)).toBeNull()
    expect(screen.queryByText(/绑定时间：/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '刷新状态' }))
  })

  it('locks an opened revoke confirmation while the exact revoke is in flight', () => {
    let current = state({
      enabled: true,
      runtime: 'online',
      bindings: [{ id: 'binding-live', userId: '51', chatId: '52' }],
    })
    const useTelegramSettings: TelegramSettingsSectionProps['useTelegramSettings'] = selector => selector(current)
    const shared = props(current, { useTelegramSettings })
    const view = render(<TelegramSettingsSection {...shared} />)
    fireEvent.click(screen.getByRole('button', { name: '撤销绑定' }))
    current = { ...current, action: 'revoking-binding' }
    view.rerender(<TelegramSettingsSection {...shared} />)
    const revoking = screen.getAllByRole('button', { name: '正在撤销…' })
    expect(revoking).toHaveLength(2)
    expect(revoking.every(button => button.hasAttribute('disabled'))).toBe(true)
  })

  it('ships structurally paired Chinese and English dictionaries', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
    expect(en.nav).toBe('Telegram Remote')
    expect(zh.nav).toBe('Telegram 远程控制')
    expect(en.backlogDescription).toContain('may fetch and inspect an update batch')
    expect(en.backlogDescription).toContain('does not execute, acknowledge, advance the offset, or clear it')
  })
})

const TELEGRAM_BOT_TOKEN_REF_FOR_TEST = 'TELEGRAM_BOT_TOKEN'
