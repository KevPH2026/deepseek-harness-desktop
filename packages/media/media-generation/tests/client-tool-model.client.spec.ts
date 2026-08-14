import { describe, expect, it } from 'vitest'
import type { RunningToolCall, ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client'
import { mediaArtifactMarker, type MediaArtifact } from '../src/types.ts'
import {
  artifactFromToolBlock, formatMediaBytes, mediaToolModel,
} from '../src/client/media-tool-model.ts'

const SHA = 'a'.repeat(64)
const IMAGE: MediaArtifact = {
  kind: 'image',
  url: `/generated-media/${SHA}.png`,
  mediaType: 'image/png',
  bytes: 2048,
  sha256: SHA,
  model: 'gpt-image-2',
  provider: 'openai-images',
}
const VIDEO: MediaArtifact = {
  kind: 'video',
  url: `/generated-media/${SHA}.mp4`,
  mediaType: 'video/mp4',
  bytes: 2 * 1024 * 1024,
  sha256: SHA,
  model: 'veo-3.1-generate-preview',
  provider: 'google-veo',
}

function running(toolName: string, argsRaw = '{"prompt":"a glass city at dawn"}'): RunningToolCall {
  return {
    callId: 'call-media',
    name: toolName,
    argsRaw,
    turn: 1,
    step: 1,
    time: 1,
    callView: null,
    subCalls: [],
  }
}

function settled(over: Partial<ToolResultNode> = {}): ToolResultNode {
  return {
    kind: 'tool-result',
    seq: 2,
    time: 2,
    callId: 'call-media',
    call: { name: 'generate_image', argsRaw: '{"prompt":"a glass city at dawn"}' },
    callTime: 1,
    content: [{ type: 'text', text: 'Generated image.' }],
    isError: false,
    callView: null,
    resultView: null,
    subCalls: [],
    ...over,
  }
}

describe('mediaToolModel', () => {
  it('derives a running image card from durable arguments', () => {
    expect(mediaToolModel('generate_image', running('generate_image'))).toEqual({
      kind: 'image',
      prompt: 'a glass city at dawn',
      state: 'running',
      artifact: undefined,
      output: '',
    })
  })

  it('prefers strictly validated presentation metadata', () => {
    const block = settled({
      meta: { kind: 'generated-media', artifact: IMAGE },
      content: [{ type: 'text', text: `Generated image.\n${mediaArtifactMarker(VIDEO)}` }],
    })
    expect(artifactFromToolBlock(block, 'image')).toEqual(IMAGE)
    expect(mediaToolModel('generate_image', block).artifact).toEqual(IMAGE)
  })

  it('recovers a nested video result from its text marker', () => {
    const block = settled({
      call: { name: 'generate_video', argsRaw: '{"prompt":"waves through tall grass"}' },
      content: [{ type: 'text', text: `Video ready.\n${mediaArtifactMarker(VIDEO)}` }],
    })
    const model = mediaToolModel('generate_video', block)
    expect(model.kind).toBe('video')
    expect(model.prompt).toBe('waves through tall grass')
    expect(model.artifact).toEqual(VIDEO)
  })

  it('rejects external URLs, cross-kind artifacts, and protocol-provider mismatches', () => {
    const external = {
      ...IMAGE,
      url: 'https://example.com/image.png',
    }
    expect(artifactFromToolBlock(settled({ meta: { kind: 'generated-media', artifact: external } }), 'image')).toBeUndefined()
    expect(artifactFromToolBlock(settled({ meta: { kind: 'generated-media', artifact: VIDEO } }), 'image')).toBeUndefined()
    expect(artifactFromToolBlock(settled({
      meta: { kind: 'generated-media', artifact: { ...IMAGE, provider: 'google-veo' } },
    }), 'image')).toBeUndefined()
  })

  it('keeps failure and interruption output without accepting an artifact', () => {
    const failed = mediaToolModel('generate_image', settled({
      isError: true,
      content: [{ type: 'text', text: 'ProviderError: quota exceeded' }],
      meta: { kind: 'generated-media', artifact: IMAGE },
    }))
    expect(failed).toMatchObject({ state: 'error', artifact: undefined, output: 'ProviderError: quota exceeded' })

    const stopped = mediaToolModel('generate_video', settled({
      call: null,
      content: [],
      error: { name: 'InterruptedError', code: 'interrupted' },
    }))
    expect(stopped).toMatchObject({
      state: 'stopped',
      prompt: 'call-media',
      artifact: undefined,
      output: 'InterruptedError: interrupted',
    })
  })

  it('falls back to raw arguments and formats artifact byte counts', () => {
    expect(mediaToolModel('generate_image', running('generate_image', '{"prompt":')).prompt).toBe('{"prompt":')
    expect(formatMediaBytes(512)).toBe('512 B')
    expect(formatMediaBytes(2048)).toBe('2.0 KB')
    expect(formatMediaBytes(2 * 1024 * 1024)).toBe('2.0 MB')
  })
})
