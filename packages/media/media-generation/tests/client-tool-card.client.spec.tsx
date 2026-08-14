// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RunningToolCall, ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { mediaArtifactMarker, type MediaArtifact } from '../src/types.ts'
import { MediaToolCard, type MediaToolCardProps } from '../src/client/MediaToolCard.tsx'
import { zh } from '../src/client/locales.ts'

const SHA = 'b'.repeat(64)
const IMAGE: MediaArtifact = {
  kind: 'image',
  url: `/generated-media/${SHA}.webp`,
  mediaType: 'image/webp',
  bytes: 4096,
  sha256: SHA,
  model: 'gpt-image-2',
  provider: 'openai-images',
}
const VIDEO: MediaArtifact = {
  kind: 'video',
  url: `/generated-media/${SHA}.mp4`,
  mediaType: 'video/mp4',
  bytes: 3 * 1024 * 1024,
  sha256: SHA,
  model: 'veo-3.1-generate-preview',
  provider: 'google-veo',
}

afterEach(cleanup)

const t: MediaToolCardProps['t'] = makeTranslate(zh, commonZh)

function running(name: string): RunningToolCall {
  return {
    callId: 'call-media',
    name,
    argsRaw: '{"prompt":"paper birds over Shanghai"}',
    turn: 1,
    step: 1,
    time: 1,
    callView: null,
    subCalls: [],
  }
}

function settled(name: string, over: Partial<ToolResultNode> = {}): ToolResultNode {
  return {
    kind: 'tool-result',
    seq: 2,
    time: 2,
    callId: 'call-media',
    call: { name, argsRaw: '{"prompt":"paper birds over Shanghai"}' },
    callTime: 1,
    content: [{ type: 'text', text: 'Generation complete.' }],
    isError: false,
    callView: null,
    resultView: null,
    subCalls: [],
    ...over,
  }
}

function props(toolName: string, block: RunningToolCall | ToolResultNode, inspect?: () => void): MediaToolCardProps {
  return { toolName, block, callId: block.callId, openFile: vi.fn(), inspect, t } as unknown as MediaToolCardProps
}

describe('MediaToolCard', () => {
  it('shows a dedicated in-progress image state', () => {
    const view = render(<MediaToolCard {...props('generate_image', running('generate_image'))} />)
    expect(screen.getByRole('status').textContent).toContain('正在生成图片')
    expect(view.container.querySelector('[data-kind="image"]')?.getAttribute('data-state')).toBe('running')
    expect(view.container.textContent).toContain('paper birds over Shanghai')
  })

  it('renders a same-origin image artifact with metadata and download', () => {
    const inspect = vi.fn()
    const view = render(<MediaToolCard {...props('generate_image', settled('generate_image', {
      meta: { kind: 'generated-media', artifact: IMAGE },
    }), inspect)} />)
    const image = screen.getByRole('img', { name: 'paper birds over Shanghai' })
    expect(image.getAttribute('src')).toBe(IMAGE.url)
    expect(view.container.textContent).toContain('gpt-image-2')
    expect(view.container.textContent).toContain('OpenAI-compatible Images')
    expect(view.container.textContent).toContain('4.0 KB')
    expect(screen.getByRole('link', { name: '下载' }).getAttribute('href')).toBe(IMAGE.url)
    screen.getByRole('button', { name: '检查' }).click()
    expect(inspect).toHaveBeenCalledTimes(1)
  })

  it('renders a video recovered from the nested text marker', () => {
    const view = render(<MediaToolCard {...props('generate_video', settled('generate_video', {
      content: [{ type: 'text', text: `Video ready.\n${mediaArtifactMarker(VIDEO)}` }],
    }))} />)
    const video = view.container.querySelector('video')
    expect(video?.getAttribute('src')).toBe(VIDEO.url)
    expect(video?.hasAttribute('controls')).toBe(true)
    expect(video?.getAttribute('preload')).toBe('metadata')
    expect(view.container.textContent).toContain('3.0 MB')
  })

  it('does not render an invalid artifact URL as media', () => {
    const view = render(<MediaToolCard {...props('generate_image', settled('generate_image', {
      meta: { kind: 'generated-media', artifact: { ...IMAGE, url: 'https://example.com/track.png' } },
    }))} />)
    expect(view.container.querySelector('img')).toBeNull()
    expect(view.container.textContent).toContain('生成已结束，但结果中没有有效的媒体产物')
  })

  it('surfaces provider failure text', () => {
    render(<MediaToolCard {...props('generate_video', settled('generate_video', {
      isError: true,
      content: [{ type: 'text', text: 'ProviderError: quota exceeded' }],
    }))} />)
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('生成失败')
    expect(alert.textContent).toContain('ProviderError: quota exceeded')
  })
})
