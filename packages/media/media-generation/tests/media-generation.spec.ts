import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AttachmentStore from '@deepseek-ai/dsh-attachment'
import type {
  ImageAttachmentLimits,
  ImageAttachmentRef,
  SaveImageAttachment,
  StoredImageAttachment,
} from '@deepseek-ai/dsh-attachment'
import { CallId } from '@deepseek-ai/dsh-llm'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as MediaGeneration from '../src/index.ts'
import { generatedMediaFromText } from '../src/types.ts'

const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+Av7R2QAAAABJRU5ErkJggg=='
const contexts: Context[] = []
let home: string
let previousHome: string | undefined
let previousOpenAIKey: string | undefined

class TestAttachments extends AttachmentStore {
  override readonly imageLimits: ImageAttachmentLimits = Object.freeze({
    maxImageBytes: 5 * 1024 * 1024,
    maxImagesPerMessage: 20,
    maxMessageImageBytes: 100 * 1024 * 1024,
    maxImagePixels: 40_000_000,
    maxImageDimension: 4096,
    mediaTypes: Object.freeze(['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const),
  })

  readonly validated: SaveImageAttachment[] = []

  override validateImage(input: SaveImageAttachment): Promise<void> {
    this.validated.push(input)
    return Promise.resolve()
  }

  override saveImage(_input: SaveImageAttachment): Promise<ImageAttachmentRef> {
    return Promise.reject(new Error('not used'))
  }

  override readImage(_ref: ImageAttachmentRef, _signal?: AbortSignal): Promise<StoredImageAttachment> {
    return Promise.reject(new Error('not used'))
  }
}

class MemorySettings extends SettingsProvider {
  override readonly writable = true

  protected override load(): Promise<Record<string, unknown>> {
    return Promise.resolve({})
  }

  protected override persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> {
    return Promise.resolve()
  }
}

beforeEach(async () => {
  previousHome = process.env.DSH_HOME
  previousOpenAIKey = process.env.OPENAI_API_KEY
  home = await mkdtemp(join(tmpdir(), 'dsh-media-tool-'))
  process.env.DSH_HOME = home
  process.env.OPENAI_API_KEY = 'fixture-key'
})

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.allSettled(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  if (previousOpenAIKey === undefined) delete process.env.OPENAI_API_KEY
  else process.env.OPENAI_API_KEY = previousOpenAIKey
  await rm(home, { recursive: true, force: true })
})

async function setup(
  config: MediaGeneration.MediaGenerationConfig,
  options: { settings?: boolean } = {},
): Promise<{ ctx: Context; mediaFiber: Awaited<ReturnType<Context['plugin']>> }> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(TestAttachments)
  if (options.settings === true) await ctx.plugin(MemorySettings)
  const mediaFiber = await ctx.plugin(MediaGeneration, config)
  return { ctx, mediaFiber }
}

describe('media-generation configuration', () => {
  it('materializes the provider defaults and rejects unusable video defaults', () => {
    expect(MediaGeneration.resolveMediaGenerationConfig({})).toMatchObject({
      approval: 'always',
      image: {
        enabled: false,
        baseURL: 'https://api.openai.com/v1',
        model: 'gpt-image-2',
        apiKeyEnv: 'OPENAI_API_KEY',
      },
      video: {
        enabled: false,
        model: 'veo-3.1-generate-preview',
        apiKeyEnv: 'GOOGLE_API_KEY',
        defaultDuration: '4',
        defaultResolution: '720p',
      },
      maxImageBytes: 5 * 1024 * 1024,
    })
    expect(() => MediaGeneration.resolveMediaGenerationConfig({
      video: { defaultResolution: '1080p' },
    })).toThrow(/require defaultDuration "8"/)
  })
})

describe('media-generation Host plugin', () => {
  it('asks before a charged request by default and never reaches the provider without approval', async () => {
    const provider = vi.spyOn(globalThis, 'fetch')
    const { ctx } = await setup({ image: { enabled: true } })

    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('media-approval'),
      name: MediaGeneration.IMAGE_TOOL_NAME,
      arguments: { prompt: 'a green pixel' },
    })

    expect(result.isError).toBe(true)
    const text = result.content[0]?.type === 'text' ? result.content[0].text : ''
    expect(text).toContain('may incur provider charges')
    expect(provider).not.toHaveBeenCalled()
  })

  it('executes an enabled image tool with full validation, replay metadata and a text marker', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: [{ b64_json: PNG_BASE64 }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    const { ctx } = await setup({ approval: 'never', image: { enabled: true } })

    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('media-image'),
      name: MediaGeneration.IMAGE_TOOL_NAME,
      arguments: { prompt: 'a green pixel' },
    })

    if (result.isError) throw new Error(result.error.message)
    const value = result.value as unknown as { artifact: MediaGeneration.MediaArtifact }
    expect(value).toMatchObject({
      artifact: {
        kind: 'image',
        mediaType: 'image/png',
        provider: 'openai-images',
        model: 'gpt-image-2',
      },
    })
    expect(result.meta).toEqual({ kind: 'generated-media', artifact: value.artifact })
    const text = result.content[0]?.type === 'text' ? result.content[0].text : ''
    expect(generatedMediaFromText(text)?.artifact).toEqual(value.artifact)
    const attachments = ctx.attachments as TestAttachments
    expect(attachments.validated).toHaveLength(1)
    expect(attachments.validated[0]).toMatchObject({ mediaType: 'image/png' })
  })

  it('hot-adds and removes tools with settings, updates guidance, and disposes every registration', async () => {
    const { ctx, mediaFiber } = await setup({ approval: 'never' }, { settings: true })
    expect(ctx.tools.get(MediaGeneration.IMAGE_TOOL_NAME)).toBeUndefined()

    await ctx.settings.update(MediaGeneration.MEDIA_SETTINGS_NS, { image: { enabled: true } })
    await vi.waitFor(() => {
      expect(ctx.tools.get(MediaGeneration.IMAGE_TOOL_NAME)).toBeDefined()
    })
    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.sections.find(section => section.name === 'tool:media-generation')?.text)
      .toContain('do not call them merely to discuss or analyze media')

    await ctx.settings.update(MediaGeneration.MEDIA_SETTINGS_NS, { image: { enabled: false } })
    await vi.waitFor(() => {
      expect(ctx.tools.get(MediaGeneration.IMAGE_TOOL_NAME)).toBeUndefined()
    })

    await ctx.settings.update(MediaGeneration.MEDIA_SETTINGS_NS, { video: { enabled: true } })
    await vi.waitFor(() => {
      expect(ctx.tools.get(MediaGeneration.VIDEO_TOOL_NAME)).toBeDefined()
    })
    await mediaFiber.dispose()
    expect(ctx.tools.get(MediaGeneration.VIDEO_TOOL_NAME)).toBeUndefined()
    expect(ctx.settings.get(MediaGeneration.MEDIA_SETTINGS_NS)).toBeUndefined()
    expect((await ctx.systemPrompt.assemble()).sections.some(section =>
      section.name === 'tool:media-generation')).toBe(false)
  })
})
