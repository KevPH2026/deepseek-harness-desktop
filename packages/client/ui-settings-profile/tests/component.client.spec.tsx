// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { ProfileSettingsSection, type ProfileSettingsSectionProps } from '../src/client/ProfileSettingsSection.tsx'
import { PublicProfileOnboarding, type PublicProfileOnboardingProps } from '../src/client/PublicProfileOnboarding.tsx'
import { zh } from '../src/client/locales.ts'
import type { EditableProfile } from '../src/client/profile-model.ts'
import type { ProfileSettingsState } from '../src/client/profile-store.ts'

afterEach(() => { cleanup() })

const t = makeTranslate(zh, commonZh)
function state(overrides: Partial<ProfileSettingsState> = {}): ProfileSettingsState {
  const snapshot: ProfileSettingsState = {
    status: 'ready', writable: true, revision: 1, value: {}, onboarding: undefined,
    action: 'idle', error: null, saved: false,
  }
  Object.assign(snapshot, overrides)
  return snapshot
}

function sectionProps(snapshot: ProfileSettingsState, overrides: Partial<ProfileSettingsSectionProps> = {}) {
  return {
    useProfileSettings: (selector: (value: ProfileSettingsState) => unknown) => selector(snapshot),
    refreshProfile: vi.fn(async () => {}),
    saveProfile: vi.fn(async () => true),
    clearProfile: vi.fn(async () => true),
    t,
    close: vi.fn(),
    ...overrides,
  } as unknown as ProfileSettingsSectionProps
}

function onboardingProps(snapshot: ProfileSettingsState, overrides: Partial<PublicProfileOnboardingProps> = {}) {
  return {
    usePublicProfileOnboarding: (selector: (value: ProfileSettingsState) => unknown) => selector(snapshot),
    refreshProfile: vi.fn(async () => {}),
    saveProfile: vi.fn(async () => true),
    skipProfile: vi.fn(async () => true),
    complete: vi.fn(),
    openSection: vi.fn(),
    stepId: 'public-profile',
    t,
    ...overrides,
  } as unknown as PublicProfileOnboardingProps
}

describe('ProfileSettingsSection', () => {
  it('renders the consent boundary, secret warning, and saves an explicitly visible field', async () => {
    const save = vi.fn(async (_draft: EditableProfile, _finishOnboarding?: boolean) => true)
    render(<ProfileSettingsSection {...sectionProps(state(), { saveProfile: save })} />)
    expect(screen.getByText(/不要填写密码、API Key、Token、Cookie/)).not.toBeNull()
    expect(screen.getByText(/会写入支持运行时上下文的本地 Agent 会话记录/)).not.toBeNull()
    expect(screen.getByText(/导出的会话也可能包含/)).not.toBeNull()
    expect(screen.getByText(/不会删除已有会话记录/)).not.toBeNull()
    expect(screen.getByText(/安全远程预设可能不使用/)).not.toBeNull()
    const input = screen.getByLabelText('希望怎么称呼你')
    const consent = screen.getByRole('checkbox', { name: '允许 Agent 使用“希望怎么称呼你”' })
    expect(consent.hasAttribute('disabled')).toBe(true)
    fireEvent.change(input, { target: { value: 'Kev' } })
    expect(consent.hasAttribute('disabled')).toBe(false)
    fireEvent.click(consent)
    fireEvent.click(screen.getByRole('button', { name: '保存资料' }))
    await vi.waitFor(() => { expect(save).toHaveBeenCalled() })
    expect(save.mock.calls[0]![0].preferredName).toEqual({ value: 'Kev', agentVisible: true })
  })

  it('immediately clears consent when an input becomes empty', () => {
    render(<ProfileSettingsSection {...sectionProps(state({
      value: { preferredName: { value: 'Kev', agentVisible: true } },
    }))} />)
    const input = screen.getByLabelText('希望怎么称呼你')
    const consent = screen.getByRole('checkbox', { name: '允许 Agent 使用“希望怎么称呼你”' })
    expect((consent as HTMLInputElement).checked).toBe(true)
    fireEvent.change(input, { target: { value: '' } })
    expect((consent as HTMLInputElement).checked).toBe(false)
    expect(consent.hasAttribute('disabled')).toBe(true)
  })

  it('confirms clear-all and exposes retryable loading failures', async () => {
    const clear = vi.fn(async () => true)
    render(<ProfileSettingsSection {...sectionProps(state(), { clearProfile: clear })} />)
    fireEvent.click(screen.getByRole('button', { name: '清空全部资料' }))
    const dialog = screen.getByRole('dialog', { name: '清空全部个人资料？' })
    fireEvent.click(within(dialog).getByRole('button', { name: '确认清空' }))
    await vi.waitFor(() => { expect(clear).toHaveBeenCalledTimes(1) })
    cleanup()
    const refresh = vi.fn(async () => {})
    render(<ProfileSettingsSection {...sectionProps(state({ status: 'error', error: 'load' }), { refreshProfile: refresh })} />)
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(refresh).toHaveBeenCalledTimes(1)
  })
})

describe('PublicProfileOnboarding', () => {
  it('is optional, identifies the separate model step, and persists skip before completing', async () => {
    const skip = vi.fn(async () => true)
    const complete = vi.fn()
    const root = document.createElement('div')
    root.id = 'root'
    document.body.append(root)
    render(<PublicProfileOnboarding {...onboardingProps(state(), { skipProfile: skip, complete })} />)
    expect(screen.getByText(/模型配置仍在下一步完成/)).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '暂时跳过' }))
    await vi.waitFor(() => { expect(skip).toHaveBeenCalledTimes(1) })
    await vi.waitFor(() => { expect(complete).toHaveBeenCalledTimes(1) })
    root.remove()
  })

  it('navigates three accessible optional steps and saves only from the final step', async () => {
    const save = vi.fn(async (_draft: EditableProfile, _finishOnboarding?: boolean) => true)
    const complete = vi.fn()
    render(<PublicProfileOnboarding {...onboardingProps(state(), { saveProfile: save, complete })} />)
    expect(screen.getByText('第 1/3 步').getAttribute('aria-current')).toBe('step')
    expect(screen.getByLabelText('希望怎么称呼你')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '下一步' }))
    expect(screen.getByText('第 2/3 步')).not.toBeNull()
    expect(screen.getByLabelText('行业')).not.toBeNull()
    expect(screen.queryByRole('button', { name: '暂时跳过' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '下一步' }))
    expect(screen.getByText('第 3/3 步')).not.toBeNull()
    expect(screen.getByLabelText('X 账号')).not.toBeNull()
    expect(save).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '保存并继续' }))
    await vi.waitFor(() => { expect(save).toHaveBeenCalledTimes(1) })
    expect(save.mock.calls[0]![1]).toBe(true)
    expect(complete).toHaveBeenCalledTimes(1)
  })

  it('completes immediately for the current durable marker', async () => {
    const complete = vi.fn()
    const { container } = render(<PublicProfileOnboarding {...onboardingProps(state({
      onboarding: { version: 1, state: 'completed' },
    }), { complete })} />)
    expect(container.textContent).toBe('')
    await vi.waitFor(() => { expect(complete).toHaveBeenCalledTimes(1) })
  })

  it('fails open for the current session when profile settings are read-only', async () => {
    const complete = vi.fn()
    const save = vi.fn(async (_draft: EditableProfile, _finishOnboarding?: boolean) => true)
    const skip = vi.fn(async () => true)
    const root = document.createElement('div')
    root.id = 'root'
    document.body.append(root)
    const { container } = render(<PublicProfileOnboarding {...onboardingProps(state({
      writable: false,
    }), { complete, saveProfile: save, skipProfile: skip })} />)
    expect(container.textContent).toBe('')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(root.inert).not.toBe(true)
    await vi.waitFor(() => { expect(complete).toHaveBeenCalledTimes(1) })
    expect(save).not.toHaveBeenCalled()
    expect(skip).not.toHaveBeenCalled()
    root.remove()
  })

  it('fails open without an inert surface after profile settings reads fail', async () => {
    const complete = vi.fn()
    const refresh = vi.fn(async () => {})
    const root = document.createElement('div')
    root.id = 'root'
    document.body.append(root)
    const { container } = render(<PublicProfileOnboarding {...onboardingProps(state({
      status: 'error', writable: false, error: 'load',
    }), { complete, refreshProfile: refresh })} />)
    expect(container.textContent).toBe('')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(root.inert).not.toBe(true)
    expect(refresh).not.toHaveBeenCalled()
    await vi.waitFor(() => { expect(complete).toHaveBeenCalledTimes(1) })
    root.remove()
  })
})
