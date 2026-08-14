/**
 * Configurable image and video tools over provider APIs, private generated-media storage,
 * settings and credential references, and an optional same-origin artifact route.
 * @module @deepseek-ai/dsh-media-generation
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-attachment'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import { GeneratedMediaStore } from './artifact-store.ts'
import {
  generateGoogleVeoVideo,
  generateOpenAICompatibleImage,
  normalizeMediaBaseURL,
  resolveMediaApiKey,
} from './providers.ts'
import type { ResolvedImageProfile, ResolvedVideoProfile } from './providers.ts'
import {
  MEDIA_ROUTE_PREFIX,
  MEDIA_SETTINGS_NAMESPACE,
  mediaArtifactMarker,
} from './types.ts'
import type {
  ApprovalPolicy,
  ImageGenerationConfig,
  ImageQuality,
  ImageSize,
  MediaArtifact,
  MediaGenerationConfig,
  VideoAspectRatio,
  VideoDuration,
  VideoGenerationConfig,
  VideoResolution,
} from './types.ts'

export { GeneratedMediaStore, detectGeneratedMedia } from './artifact-store.ts'
export {
  generateGoogleVeoVideo,
  generateOpenAICompatibleImage,
  normalizeMediaBaseURL,
  resolveMediaApiKey,
} from './providers.ts'
export type { ResolvedImageProfile, ResolvedVideoProfile } from './providers.ts'
export * from './types.ts'

/** Cordis plugin name. */
export const name = 'media-generation'
/** Required registries and authoritative generated-image validator. */
export const inject = ['tools', 'attachments']

/** Model-facing image tool name. */
export const IMAGE_TOOL_NAME = 'generate_image'
/** Model-facing video tool name. */
export const VIDEO_TOOL_NAME = 'generate_video'
/** Branded settings namespace registered by this package. */
export const MEDIA_SETTINGS_NS = settingsNamespace(MEDIA_SETTINGS_NAMESPACE)

/** Default OpenAI-compatible Images endpoint. */
export const DEFAULT_IMAGE_BASE_URL = 'https://api.openai.com/v1'
/** Default GPT Image model. */
export const DEFAULT_IMAGE_MODEL = 'gpt-image-2'
/** Default image credential reference. */
export const DEFAULT_IMAGE_API_KEY_ENV = 'OPENAI_API_KEY'
/** Default image size sent when the tool call omits one. */
export const DEFAULT_IMAGE_SIZE: ImageSize = 'auto'
/** Default image quality sent when the tool call omits one. */
export const DEFAULT_IMAGE_QUALITY: ImageQuality = 'auto'

/** Default Google generative-language endpoint. */
export const DEFAULT_VIDEO_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'
/** Default Veo model. */
export const DEFAULT_VIDEO_MODEL = 'veo-3.1-generate-preview'
/** Default video credential reference. */
export const DEFAULT_VIDEO_API_KEY_ENV = 'GOOGLE_API_KEY'
/** Default video aspect ratio sent when the tool call omits one. */
export const DEFAULT_VIDEO_ASPECT_RATIO: VideoAspectRatio = '16:9'
/** Default video duration sent when the tool call omits one. */
export const DEFAULT_VIDEO_DURATION: VideoDuration = '4'
/** Default video resolution sent when the tool call omits one. */
export const DEFAULT_VIDEO_RESOLUTION: VideoResolution = '720p'

/** Default generated-image byte cap, aligned with the local attachment validator. */
export const DEFAULT_MAX_IMAGE_BYTES = 5 * 1024 * 1024
/** Default generated-video byte cap. */
export const DEFAULT_MAX_VIDEO_BYTES = 512 * 1024 * 1024
/** Default Veo operation polling interval. */
export const DEFAULT_VIDEO_POLL_INTERVAL_MS = 10_000
/** Default complete Veo operation deadline. */
export const DEFAULT_VIDEO_TIMEOUT_MS = 20 * 60_000
/** Default policy asks before every provider operation. */
export const DEFAULT_APPROVAL_POLICY: ApprovalPolicy = 'always'

const MAX_TIMER_DELAY_MS = 2_147_483_647

const ImageConfig: z<ImageGenerationConfig> = z.object({
  enabled: z.boolean().default(false),
  baseURL: z.string().default(DEFAULT_IMAGE_BASE_URL),
  model: z.string().default(DEFAULT_IMAGE_MODEL),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_IMAGE_API_KEY_ENV),
  defaultSize: z.union(['auto', '1024x1024', '1536x1024', '1024x1536'] as const)
    .default(DEFAULT_IMAGE_SIZE),
  defaultQuality: z.union(['auto', 'low', 'medium', 'high'] as const)
    .default(DEFAULT_IMAGE_QUALITY),
}).default({
  enabled: false,
  baseURL: DEFAULT_IMAGE_BASE_URL,
  model: DEFAULT_IMAGE_MODEL,
  apiKeyEnv: DEFAULT_IMAGE_API_KEY_ENV,
  defaultSize: DEFAULT_IMAGE_SIZE,
  defaultQuality: DEFAULT_IMAGE_QUALITY,
})

const VideoConfig: z<VideoGenerationConfig> = z.object({
  enabled: z.boolean().default(false),
  baseURL: z.string().default(DEFAULT_VIDEO_BASE_URL),
  model: z.string().default(DEFAULT_VIDEO_MODEL),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_VIDEO_API_KEY_ENV),
  defaultAspectRatio: z.union(['16:9', '9:16'] as const).default(DEFAULT_VIDEO_ASPECT_RATIO),
  defaultDuration: z.union(['4', '6', '8'] as const).default(DEFAULT_VIDEO_DURATION),
  defaultResolution: z.union(['720p', '1080p', '4k'] as const).default(DEFAULT_VIDEO_RESOLUTION),
}).default({
  enabled: false,
  baseURL: DEFAULT_VIDEO_BASE_URL,
  model: DEFAULT_VIDEO_MODEL,
  apiKeyEnv: DEFAULT_VIDEO_API_KEY_ENV,
  defaultAspectRatio: DEFAULT_VIDEO_ASPECT_RATIO,
  defaultDuration: DEFAULT_VIDEO_DURATION,
  defaultResolution: DEFAULT_VIDEO_RESOLUTION,
})

/** Plugin config and the same-named live settings-section value. */
export type Config = MediaGenerationConfig

/** Plugin config schema, also registered as the live settings section. */
export const Config: z<Config> = z.object({
  approval: z.union(['always', 'video-only', 'never'] as const).default(DEFAULT_APPROVAL_POLICY),
  image: ImageConfig,
  video: VideoConfig,
  maxImageBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER)
    .default(DEFAULT_MAX_IMAGE_BYTES),
  maxVideoBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER)
    .default(DEFAULT_MAX_VIDEO_BYTES),
  videoPollIntervalMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS)
    .default(DEFAULT_VIDEO_POLL_INTERVAL_MS),
  videoTimeoutMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS)
    .default(DEFAULT_VIDEO_TIMEOUT_MS),
})

/** Fully validated per-operation configuration snapshot. */
export interface ResolvedMediaGenerationConfig {
  /** Approval policy applied before a provider request starts. */
  approval: ApprovalPolicy
  /** Image tool availability and provider request facts. */
  image: ResolvedImageProfile & { enabled: boolean }
  /** Video tool availability and provider request facts. */
  video: ResolvedVideoProfile & { enabled: boolean }
  /** Maximum decoded image bytes retained as one artifact. */
  maxImageBytes: number
  /** Maximum downloaded video bytes retained as one artifact. */
  maxVideoBytes: number
  /** Delay between Veo operation reads. */
  videoPollIntervalMs: number
  /** Complete Veo operation deadline. */
  videoTimeoutMs: number
}

function nonBlank(value: string, field: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) throw new Error(`media-generation: ${field} must be non-empty`)
  return trimmed
}

function positiveSafeInteger(value: number, field: string, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > max) {
    throw new Error(`media-generation: ${field} must be a positive safe integer no greater than ${String(max)}`)
  }
  return value
}

/**
 * Materialize defaults and validate one operation-consistent configuration.
 * @param config - composition config or a resolved settings snapshot.
 * @returns a detached provider and limit snapshot safe to retain for one call.
 */
export function resolveMediaGenerationConfig(config: MediaGenerationConfig): ResolvedMediaGenerationConfig {
  const image = config.image
  const video = config.video
  const videoPollIntervalMs = positiveSafeInteger(
    config.videoPollIntervalMs ?? DEFAULT_VIDEO_POLL_INTERVAL_MS,
    'videoPollIntervalMs',
    MAX_TIMER_DELAY_MS,
  )
  const videoTimeoutMs = positiveSafeInteger(
    config.videoTimeoutMs ?? DEFAULT_VIDEO_TIMEOUT_MS,
    'videoTimeoutMs',
    MAX_TIMER_DELAY_MS,
  )
  if (videoPollIntervalMs > videoTimeoutMs) {
    throw new Error('media-generation: videoPollIntervalMs cannot exceed videoTimeoutMs')
  }
  const defaultDuration = video?.defaultDuration ?? DEFAULT_VIDEO_DURATION
  const defaultResolution = video?.defaultResolution ?? DEFAULT_VIDEO_RESOLUTION
  if (defaultResolution !== '720p' && defaultDuration !== '8') {
    throw new Error(`media-generation: ${defaultResolution} video defaults require defaultDuration "8"`)
  }
  return {
    approval: config.approval ?? DEFAULT_APPROVAL_POLICY,
    image: {
      enabled: image?.enabled ?? false,
      baseURL: normalizeMediaBaseURL(image?.baseURL ?? DEFAULT_IMAGE_BASE_URL),
      model: nonBlank(image?.model ?? DEFAULT_IMAGE_MODEL, 'image.model'),
      apiKeyEnv: credentialRef(image?.apiKeyEnv ?? DEFAULT_IMAGE_API_KEY_ENV),
      defaultSize: image?.defaultSize ?? DEFAULT_IMAGE_SIZE,
      defaultQuality: image?.defaultQuality ?? DEFAULT_IMAGE_QUALITY,
    },
    video: {
      enabled: video?.enabled ?? false,
      baseURL: normalizeMediaBaseURL(video?.baseURL ?? DEFAULT_VIDEO_BASE_URL),
      model: nonBlank(video?.model ?? DEFAULT_VIDEO_MODEL, 'video.model'),
      apiKeyEnv: credentialRef(video?.apiKeyEnv ?? DEFAULT_VIDEO_API_KEY_ENV),
      defaultAspectRatio: video?.defaultAspectRatio ?? DEFAULT_VIDEO_ASPECT_RATIO,
      defaultDuration,
      defaultResolution,
    },
    maxImageBytes: positiveSafeInteger(config.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES, 'maxImageBytes'),
    maxVideoBytes: positiveSafeInteger(config.maxVideoBytes ?? DEFAULT_MAX_VIDEO_BYTES, 'maxVideoBytes'),
    videoPollIntervalMs,
    videoTimeoutMs,
  }
}

const MEDIA_ARTIFACT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    kind: { type: 'string', required: true, enum: ['image', 'video'] },
    url: { type: 'string', required: true },
    mediaType: {
      type: 'string',
      required: true,
      enum: ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4'],
    },
    bytes: { type: 'integer', required: true },
    sha256: { type: 'string', required: true },
    model: { type: 'string', required: true },
    provider: { type: 'string', required: true, enum: ['openai-images', 'google-veo'] },
  },
} as const

const MEDIA_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    artifact: { ...MEDIA_ARTIFACT_SCHEMA, required: true },
  },
} as const

function renderArtifact(artifact: MediaArtifact): Array<{ type: 'text'; text: string }> {
  return [{
    type: 'text',
    text: `Generated ${artifact.kind} with ${artifact.model}.\nOpen: ${artifact.url}\n${mediaArtifactMarker(artifact)}`,
  }]
}

function assertPrompt(prompt: string): string {
  const trimmed = prompt.trim()
  if (trimmed.length === 0) throw new Error('media generation prompt must be non-empty')
  if (trimmed.length > 32_000) {
    throw new Error('media generation prompt cannot exceed 32000 characters')
  }
  return trimmed
}

function approvalReason(
  exec: ToolExecution,
  snapshot: ResolvedMediaGenerationConfig,
): string {
  const args = typeof exec.arguments === 'object'
    && exec.arguments !== null
    && !Array.isArray(exec.arguments)
    ? exec.arguments as Record<string, unknown>
    : {}
  if (exec.name === IMAGE_TOOL_NAME) {
    const size = typeof args.size === 'string' ? args.size : snapshot.image.defaultSize
    const quality = typeof args.quality === 'string' ? args.quality : snapshot.image.defaultQuality
    return `Generate an image (${size}, ${quality}) with ${snapshot.image.model} at ${snapshot.image.baseURL}; this request may incur provider charges.`
  }
  const aspectRatio = typeof args.aspect_ratio === 'string'
    ? args.aspect_ratio
    : snapshot.video.defaultAspectRatio
  const duration = typeof args.duration === 'string' ? args.duration : snapshot.video.defaultDuration
  const resolution = typeof args.resolution === 'string' ? args.resolution : snapshot.video.defaultResolution
  return `Generate a ${duration}-second ${resolution} video (${aspectRatio}) with ${snapshot.video.model} at ${snapshot.video.baseURL}; this request may incur provider charges.`
}

/**
 * Register enabled media tools, settings, approval policy, validation, storage, and the optional HTTP route.
 * @param ctx - Host context carrying the required tool registry and attachment validator.
 * @param config - composition-layer defaults beneath the optional user settings section.
 */
export function apply(ctx: Context, config: Config): void {
  let current: () => Config = () => config
  const snapshot = (): ResolvedMediaGenerationConfig => resolveMediaGenerationConfig(current())
  snapshot()

  const store = new GeneratedMediaStore((data, mediaType) =>
    ctx.attachments.validateImage({ data, mediaType }))
  const approvedSnapshots = new WeakMap<ToolExecution, ResolvedMediaGenerationConfig>()
  const executionSnapshot = (exec: ToolExecution): ResolvedMediaGenerationConfig =>
    approvedSnapshots.get(exec) ?? snapshot()

  const imageTool = defineTool({
    name: IMAGE_TOOL_NAME,
    description: 'Generate an image from a text prompt with the configured image provider.',
    parameters: {
      prompt: { type: 'string', required: true, description: 'Image description.' },
      size: {
        type: 'string',
        enum: ['auto', '1024x1024', '1536x1024', '1024x1536'],
        description: 'Output dimensions; omitted uses the configured default.',
      },
      quality: {
        type: 'string',
        enum: ['auto', 'low', 'medium', 'high'],
        description: 'Output quality; omitted uses the configured default.',
      },
    },
    output: {
      schema: MEDIA_OUTPUT_SCHEMA,
      render: (_args, value) => renderArtifact(value.artifact),
      presentationMeta: (_args, value) => ({ kind: 'generated-media', artifact: value.artifact }),
    },
    presentCall: args => ({
      card: 'generic',
      title: 'Generate image',
      kind: 'execute',
      rawInput: args.prompt,
    }),
    async execute(args, exec) {
      const call = executionSnapshot(exec)
      if (!call.image.enabled) throw new Error('image generation is disabled')
      const apiKey = await resolveMediaApiKey(ctx, call.image.apiKeyEnv)
      const artifact = await generateOpenAICompatibleImage({
        profile: call.image,
        apiKey,
        prompt: assertPrompt(args.prompt),
        size: args.size ?? call.image.defaultSize,
        quality: args.quality ?? call.image.defaultQuality,
        maxBytes: call.maxImageBytes,
        store,
        signal: exec.signal,
      })
      return { artifact }
    },
  })

  const videoTool = defineTool({
    name: VIDEO_TOOL_NAME,
    description: 'Generate a video from a text prompt with the configured video provider.',
    parameters: {
      prompt: { type: 'string', required: true, description: 'Video description.' },
      aspect_ratio: {
        type: 'string',
        enum: ['16:9', '9:16'],
        description: 'Output aspect ratio; omitted uses the configured default.',
      },
      duration: {
        type: 'string',
        enum: ['4', '6', '8'],
        description: 'Output duration in seconds; omitted uses the configured default.',
      },
      resolution: {
        type: 'string',
        enum: ['720p', '1080p', '4k'],
        description: 'Output resolution; 1080p and 4k require an 8-second duration.',
      },
    },
    output: {
      schema: MEDIA_OUTPUT_SCHEMA,
      render: (_args, value) => renderArtifact(value.artifact),
      presentationMeta: (_args, value) => ({ kind: 'generated-media', artifact: value.artifact }),
    },
    presentCall: args => ({
      card: 'generic',
      title: 'Generate video',
      kind: 'execute',
      rawInput: args.prompt,
    }),
    async execute(args, exec) {
      const call = executionSnapshot(exec)
      if (!call.video.enabled) throw new Error('video generation is disabled')
      const apiKey = await resolveMediaApiKey(ctx, call.video.apiKeyEnv)
      const artifact = await generateGoogleVeoVideo({
        profile: call.video,
        apiKey,
        prompt: assertPrompt(args.prompt),
        aspectRatio: args.aspect_ratio ?? call.video.defaultAspectRatio,
        duration: args.duration ?? call.video.defaultDuration,
        resolution: args.resolution ?? call.video.defaultResolution,
        maxBytes: call.maxVideoBytes,
        pollIntervalMs: call.videoPollIntervalMs,
        timeoutMs: call.videoTimeoutMs,
        store,
        signal: exec.signal,
      })
      return { artifact }
    },
  })

  let disposeImage: (() => void) | undefined
  let disposeVideo: (() => void) | undefined
  const reconcileTools = (): void => {
    const next = snapshot()
    if (next.image.enabled && disposeImage === undefined) {
      disposeImage = ctx.tools.register(imageTool)
    } else if (!next.image.enabled && disposeImage !== undefined) {
      disposeImage()
      disposeImage = undefined
    }
    if (next.video.enabled && disposeVideo === undefined) {
      disposeVideo = ctx.tools.register(videoTool)
    } else if (!next.video.enabled && disposeVideo !== undefined) {
      disposeVideo()
      disposeVideo = undefined
    }
  }

  ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
    if (exec.name !== IMAGE_TOOL_NAME && exec.name !== VIDEO_TOOL_NAME) return next()
    const call = snapshot()
    approvedSnapshots.set(exec, call)
    const decision = await next()
    if (decision.kind !== 'allow') return decision
    const enabled = exec.name === IMAGE_TOOL_NAME ? call.image.enabled : call.video.enabled
    if (!enabled) return { kind: 'deny', reason: `${exec.name} is disabled` }
    const mustAsk = call.approval === 'always'
      || (call.approval === 'video-only' && exec.name === VIDEO_TOOL_NAME)
    return mustAsk ? { kind: 'ask', reason: approvalReason(exec, call) } : decision
  }, { prepend: true })

  installSettingsSection(ctx, MEDIA_SETTINGS_NS, Config, config, {
    setSource: (source) => {
      current = source
    },
    onChange: reconcileTools,
    validate: (value) => { resolveMediaGenerationConfig(value) },
  })
  reconcileTools()

  ctx.inject(['webServer'], (httpCtx) => {
    httpCtx.effect(() => httpCtx.webServer.register({
      kind: 'prefix',
      path: MEDIA_ROUTE_PREFIX,
      handler: store.handleRequest,
    }), 'media-generation: generated artifact route')
  })

  ctx.inject(['systemPrompt'], (promptCtx) => {
    promptCtx.systemPrompt.section({
      name: 'tool:media-generation',
      order: 117,
      text: () => {
        const enabled = snapshot()
        const tools = [
          ...enabled.image.enabled ? [IMAGE_TOOL_NAME] : [],
          ...enabled.video.enabled ? [VIDEO_TOOL_NAME] : [],
        ]
        if (tools.length === 0) return ''
        return `Use ${tools.join(' and ')} only when the user's requested deliverable genuinely needs a new image or video; do not call them merely to discuss or analyze media. Generate one artifact at a time by default. The result is already displayed in a media card, so do not repeat its internal URL. Provider calls may incur charges and require approval.`
      },
    })
  })
}
