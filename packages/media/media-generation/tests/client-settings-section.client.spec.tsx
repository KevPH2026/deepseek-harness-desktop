// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { MediaGenerationConfig } from '../src/types.ts'
import {
  MediaSettingsSection, type MediaSettingsSectionProps,
} from '../src/client/MediaSettingsSection.tsx'
import type { MediaSettingsState, MediaSettingsWrite } from '../src/client/settings-store.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const CONFIG: MediaGenerationConfig = {
  approval: 'always',
  image: {
    enabled: true,
    baseURL: 'https://api.openai.com/v1',
    model: 'gpt-image-2',
    apiKeyEnv: 'OPENAI_API_KEY',
    defaultSize: 'auto',
    defaultQuality: 'auto',
  },
  video: {
    enabled: false,
    baseURL: 'https://generativelanguage.googleapis.com/v1beta',
    model: 'veo-3.1-generate-preview',
    apiKeyEnv: 'GOOGLE_API_KEY',
    defaultAspectRatio: '16:9',
    defaultDuration: '4',
    defaultResolution: '720p',
  },
}

function state(over: Partial<MediaSettingsState> = {}): MediaSettingsState {
  return {
    status: 'ready',
    config: structuredClone(CONFIG),
    revision: 1,
    writable: true,
    mode: 'host',
    imageCredential: {
      ref: 'OPENAI_API_KEY', status: 'ready', configured: true, writable: true,
    },
    videoCredential: {
      ref: 'GOOGLE_API_KEY', status: 'ready', configured: false, writable: true,
    },
    credentialError: null,
    saving: false,
    saveError: null,
    savedRevision: 0,
    removingCredential: null,
    credentialActionError: null,
    removedCredential: null,
    ...over,
  }
}

const t: MediaSettingsSectionProps['t'] = makeTranslate(zh, commonZh)

function props(
  snapshot: MediaSettingsState,
  save: (write: MediaSettingsWrite) => Promise<boolean> = vi.fn(async (_write: MediaSettingsWrite) => true),
  remove: MediaSettingsSectionProps['removeMediaCredential'] = vi.fn(async (_kind: 'image' | 'video') => true),
): MediaSettingsSectionProps {
  const useMediaSettings: MediaSettingsSectionProps['useMediaSettings'] = selector => selector(snapshot)
  return {
    useMediaSettings,
    saveMediaSettings: save,
    removeMediaCredential: remove,
    t,
  } as unknown as MediaSettingsSectionProps
}

describe('MediaSettingsSection', () => {
  it('renders loading and unavailable namespace states', () => {
    const loading = render(<MediaSettingsSection {...props(state({ status: 'loading', config: undefined }))} />)
    expect(loading.container.textContent).toBe('正在加载媒体生成设置…')
    cleanup()
    render(<MediaSettingsSection {...props(state({ status: 'unavailable', config: undefined }))} />)
    expect(screen.getByText('当前部署未提供媒体生成设置。')).not.toBeNull()
  })

  it('stages provider, approval, and credential edits before saving', async () => {
    const save = vi.fn(async (_write: MediaSettingsWrite) => true)
    const view = render(<MediaSettingsSection {...props(state(), save)} />)
    expect(screen.getByText('已配置')).not.toBeNull()
    expect(screen.getByText('未配置')).not.toBeNull()

    fireEvent.change(view.container.querySelector('#media-approval')!, { target: { value: 'video-only' } })
    fireEvent.change(view.container.querySelector('#media-image-model')!, { target: { value: 'image-gateway-v2' } })
    fireEvent.change(view.container.querySelector('#media-image-api-key')!, { target: { value: 'secret-value' } })
    fireEvent.click(screen.getByRole('checkbox', { name: '启用视频生成' }))
    fireEvent.click(screen.getByRole('button', { name: '保存更改' }))

    await vi.waitFor(() => { expect(save).toHaveBeenCalledTimes(1) })
    expect(save.mock.calls[0]?.[0]).toMatchObject({
      approval: 'video-only',
      image: { enabled: true, model: 'image-gateway-v2', apiKeyEnv: 'OPENAI_API_KEY' },
      video: { enabled: true, model: 'veo-3.1-generate-preview', defaultDuration: '4' },
      imageApiKey: 'secret-value',
      videoApiKey: '',
    })
  })

  it('blocks an invalid enabled endpoint and restores the persisted draft', () => {
    const view = render(<MediaSettingsSection {...props(state())} />)
    const endpoint = view.container.querySelector('#media-image-endpoint')!
    fireEvent.change(endpoint, { target: { value: 'http://example.com/v1' } })
    expect(screen.getByText('请输入 HTTPS 地址，或本机 loopback HTTP 地址。')).not.toBeNull()
    expect(screen.getByRole('button', { name: '保存更改' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '放弃更改' }))
    expect((endpoint as HTMLInputElement).value).toBe('https://api.openai.com/v1')
  })

  it('moves high-resolution video generation to the required eight seconds', () => {
    const view = render(<MediaSettingsSection {...props(state())} />)
    const duration = view.container.querySelector('#media-video-duration') as HTMLSelectElement
    const resolution = view.container.querySelector('#media-video-resolution') as HTMLSelectElement
    expect(duration.value).toBe('4')
    fireEvent.change(resolution, { target: { value: '1080p' } })
    expect(duration.value).toBe('8')
    expect([...duration.options].find(option => option.value === '4')?.disabled).toBe(true)
  })

  it('keeps the page visible when credential status fails and disables read-only saves', () => {
    render(<MediaSettingsSection {...props(state({
      writable: false,
      credentialError: 'offline',
      imageCredential: {
        ref: 'OPENAI_API_KEY', status: 'error', configured: false, writable: false,
      },
    }))} />)
    expect(screen.getByText('暂时无法刷新凭据状态。')).not.toBeNull()
    expect(screen.getByText('当前部署的媒体生成设置为只读。')).not.toBeNull()
    expect(screen.getByRole('button', { name: '保存更改' }).hasAttribute('disabled')).toBe(true)
    expect((document.querySelector('#media-image-api-key') as HTMLInputElement).disabled).toBe(true)
    expect((document.querySelector('#media-video-api-key') as HTMLInputElement).disabled).toBe(true)
  })

  it('offers explicit removal only for a configured writable credential', async () => {
    const remove = vi.fn(async (_kind: 'image' | 'video') => true)
    render(<MediaSettingsSection {...props(state(), undefined, remove)} />)
    expect(screen.queryByRole('button', { name: '移除已存视频 API 密钥' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '移除已存图片 API 密钥' }))
    await vi.waitFor(() => { expect(remove).toHaveBeenCalledWith('image') })
  })

  it('keeps credential removal available when only the settings document is read-only', () => {
    render(<MediaSettingsSection {...props(state({ writable: false }))} />)
    expect(screen.getByRole('button', { name: '移除已存图片 API 密钥' }).hasAttribute('disabled')).toBe(false)
    expect((document.querySelector('#media-image-api-key') as HTMLInputElement).disabled).toBe(true)
  })

  it('shows credential removal progress, success, and provider-scoped failure states', () => {
    render(<MediaSettingsSection {...props(state({ removingCredential: 'image' }))} />)
    expect(screen.getByRole('button', { name: '移除已存图片 API 密钥' }).textContent).toBe('正在移除…')
    expect(screen.getByRole('button', { name: '移除已存图片 API 密钥' }).hasAttribute('disabled')).toBe(true)
    cleanup()

    render(<MediaSettingsSection {...props(state({
      credentialActionError: { kind: 'image', message: 'credential is shadowed' },
      removedCredential: 'video',
    }))} />)
    expect(screen.getByText('未能移除存储的凭据。').getAttribute('title')).toBe('credential is shadowed')
    expect(screen.getByText('已移除存储的凭据。')).not.toBeNull()
    cleanup()

    render(<MediaSettingsSection {...props(state({
      imageCredential: {
        ref: 'OPENAI_API_KEY', status: 'ready', configured: false, writable: true,
      },
      removedCredential: 'image',
    }))} />)
    expect(screen.getByText('已移除存储的凭据。')).not.toBeNull()
  })

  it('explains credential, atomic rejection, and unknown settings outcomes separately', () => {
    const cases = [
      ['credentials', '模型设置未作更改；本次填写的一个或多个凭据可能已保存。'],
      ['settings', '模型设置作为一个整体被拒绝，没有发生部分写入；已成功写入的凭据仍会保留。'],
      ['settings-unknown', '连接中断，无法确认模型设置是否已写入。请先重新加载再重试；已成功写入的凭据仍会保留。'],
    ] as const
    for (const [stage, copy] of cases) {
      const view = render(<MediaSettingsSection {...props(state({
        saveError: { stage, message: 'host detail' },
      }))} />)
      expect(screen.getByText(copy).getAttribute('title')).toBe('host detail')
      view.unmount()
    }
  })
})
