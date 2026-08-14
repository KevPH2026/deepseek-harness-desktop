/** Shared, JSON-safe media-generation configuration and presentation types. */

/** Settings namespace shared by the Host and Client plugins. */
export const MEDIA_SETTINGS_NAMESPACE = 'media-generation'
/** Same-origin route prefix for content-addressed generated artifacts. */
export const MEDIA_ROUTE_PREFIX = '/generated-media'
/** Opening delimiter for a generated-artifact fallback text marker. */
export const MEDIA_MARKER_PREFIX = '<dsh-media-artifact>'
/** Closing delimiter for a generated-artifact fallback text marker. */
export const MEDIA_MARKER_SUFFIX = '</dsh-media-artifact>'

/** Image dimensions accepted by the configured Images API. */
export type ImageSize = 'auto' | '1024x1024' | '1536x1024' | '1024x1536'
/** Image quality accepted by the configured Images API. */
export type ImageQuality = 'auto' | 'low' | 'medium' | 'high'
/** Output aspect ratios supported by the Veo adapter. */
export type VideoAspectRatio = '16:9' | '9:16'
/** Veo output durations expressed as seconds. */
export type VideoDuration = '4' | '6' | '8'
/** Output resolutions supported by the Veo adapter. */
export type VideoResolution = '720p' | '1080p' | '4k'
/** Provider-operation approval policy applied before billable requests. */
export type ApprovalPolicy = 'always' | 'video-only' | 'never'

/** OpenAI-compatible image provider configuration. */
export interface ImageGenerationConfig {
  /** Whether image provider requests are permitted. */
  enabled?: boolean
  /** Absolute HTTPS provider base URL, or an explicit loopback HTTP URL. */
  baseURL?: string
  /** Model identifier sent to the Images API. */
  model?: string
  /** Managed credential reference with an environment-variable fallback. */
  apiKeyEnv?: string
  /** Output size used when a tool call omits `size`. */
  defaultSize?: ImageSize
  /** Output quality used when a tool call omits `quality`. */
  defaultQuality?: ImageQuality
}

/** Google Veo provider configuration. */
export interface VideoGenerationConfig {
  /** Whether video provider requests are permitted. */
  enabled?: boolean
  /** Absolute Google HTTPS base URL, or an explicit loopback HTTP emulator URL. */
  baseURL?: string
  /** Veo model identifier used for long-running prediction. */
  model?: string
  /** Managed credential reference with an environment-variable fallback. */
  apiKeyEnv?: string
  /** Output aspect ratio used when a tool call omits `aspect_ratio`. */
  defaultAspectRatio?: VideoAspectRatio
  /** Output duration used when a tool call omits `duration`. */
  defaultDuration?: VideoDuration
  /** Output resolution used when a tool call omits `resolution`. */
  defaultResolution?: VideoResolution
}

/** Shared provider, approval, storage, and polling configuration. */
export interface MediaGenerationConfig {
  /** Provider operations that require interactive user approval. */
  approval?: ApprovalPolicy
  /** Image provider defaults and availability. */
  image?: ImageGenerationConfig
  /** Video provider defaults and availability. */
  video?: VideoGenerationConfig
  /** Maximum decoded bytes retained for one generated image. */
  maxImageBytes?: number
  /** Maximum downloaded bytes retained for one generated video. */
  maxVideoBytes?: number
  /** Milliseconds between Veo long-running operation reads. */
  videoPollIntervalMs?: number
  /** Milliseconds allowed for the complete Veo generation operation. */
  videoTimeoutMs?: number
}

/** Persisted metadata returned by a successful media tool call. */
export interface MediaArtifact {
  /** Generated media family. */
  kind: 'image' | 'video'
  /** Same-origin content-addressed artifact URL. */
  url: string
  /** Media type verified from file bytes. */
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' | 'video/mp4'
  /** Persisted file size in bytes. */
  bytes: number
  /** Lowercase SHA-256 digest of the persisted file. */
  sha256: string
  /** Provider model that generated the artifact. */
  model: string
  /** Adapter that produced the artifact. */
  provider: 'openai-images' | 'google-veo'
}

/** Presentation metadata recognized by generated-media Client renderers. */
export interface GeneratedMediaMeta {
  /** Presentation metadata discriminant. */
  kind: 'generated-media'
  /** Validated generated artifact to render. */
  artifact: MediaArtifact
}

function isArtifact(value: unknown): value is MediaArtifact {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const artifact = value as Record<string, unknown>
  const kind = artifact.kind
  const url = artifact.url
  const mediaType = artifact.mediaType
  const provider = artifact.provider
  return (kind === 'image' || kind === 'video')
    && typeof url === 'string'
    && /^\/generated-media\/[a-f0-9]{64}\.(?:png|jpe?g|webp|gif|mp4)$/.test(url)
    && typeof artifact.bytes === 'number' && Number.isSafeInteger(artifact.bytes) && artifact.bytes > 0
    && typeof artifact.sha256 === 'string' && /^[a-f0-9]{64}$/.test(artifact.sha256)
    && typeof artifact.model === 'string' && artifact.model.length > 0
    && (provider === 'openai-images' || provider === 'google-veo')
    && (mediaType === 'image/png' || mediaType === 'image/jpeg' || mediaType === 'image/webp'
      || mediaType === 'image/gif' || mediaType === 'video/mp4')
    && (kind === 'video' ? mediaType === 'video/mp4' : mediaType.startsWith('image/'))
}

/**
 * Defensively narrow replayed tool metadata before it reaches an image or video source.
 *
 * @param value - Untrusted presentation metadata from a tool result or replay.
 * @returns Validated generated-media metadata, or `undefined` when invalid.
 */
export function generatedMediaMeta(value: unknown): GeneratedMediaMeta | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const meta = value as Record<string, unknown>
  if (meta.kind !== 'generated-media' || !isArtifact(meta.artifact)) return undefined
  return { kind: 'generated-media', artifact: meta.artifact }
}

/**
 * Encode a text marker used when Code Mode omits presentation metadata for nested calls.
 *
 * @param artifact - Valid generated artifact returned by a media tool.
 * @returns Delimited JSON marker suitable for a text tool result.
 */
export function mediaArtifactMarker(artifact: MediaArtifact): string {
  return `${MEDIA_MARKER_PREFIX}${JSON.stringify({ kind: 'generated-media', artifact })}${MEDIA_MARKER_SUFFIX}`
}

/**
 * Recover a media artifact from a text-only native or Code Mode result.
 *
 * @param text - Tool result text that may contain one generated-artifact marker.
 * @returns Validated generated-media metadata, or `undefined` when absent or invalid.
 */
export function generatedMediaFromText(text: string): GeneratedMediaMeta | undefined {
  const start = text.indexOf(MEDIA_MARKER_PREFIX)
  if (start === -1) return undefined
  const jsonStart = start + MEDIA_MARKER_PREFIX.length
  const end = text.indexOf(MEDIA_MARKER_SUFFIX, jsonStart)
  if (end === -1) return undefined
  try {
    return generatedMediaMeta(JSON.parse(text.slice(jsonStart, end)))
  } catch {
    return undefined
  }
}
