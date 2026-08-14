/** Small, dependency-free adapters for OpenAI-compatible images and Google Veo. */

import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { GeneratedMediaStore } from './artifact-store.ts'
import type {
  ImageQuality, ImageSize, MediaArtifact, VideoAspectRatio, VideoDuration, VideoResolution,
} from './types.ts'

const JSON_ERROR_LIMIT = 16 * 1024
const REQUEST_TIMEOUT_MS = 60_000
const MEDIA_DOWNLOAD_TIMEOUT_MS = 10 * 60_000

/** Fully resolved OpenAI-compatible image provider settings. */
export interface ResolvedImageProfile {
  /** Normalized provider origin and optional path prefix. */
  baseURL: string
  /** Model identifier sent to the Images API. */
  model: string
  /** Credential reference or environment variable holding the API key. */
  apiKeyEnv: string
  /** Size used when a generation call omits an override. */
  defaultSize: ImageSize
  /** Quality used when a generation call omits an override. */
  defaultQuality: ImageQuality
}

/** Fully resolved Google Veo provider settings. */
export interface ResolvedVideoProfile {
  /** Normalized Google API origin or explicit loopback emulator origin. */
  baseURL: string
  /** Veo model identifier used for long-running prediction. */
  model: string
  /** Credential reference or environment variable holding the API key. */
  apiKeyEnv: string
  /** Aspect ratio used when a generation call omits an override. */
  defaultAspectRatio: VideoAspectRatio
  /** Duration used when a generation call omits an override. */
  defaultDuration: VideoDuration
  /** Resolution used when a generation call omits an override. */
  defaultResolution: VideoResolution
}

/**
 * Accept only user-chosen HTTPS endpoints and explicit loopback HTTP endpoints.
 *
 * @param value - Absolute provider base URL from configuration.
 * @returns Normalized URL without one trailing slash.
 */
export function normalizeMediaBaseURL(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('media provider base URL must be an absolute http(s) URL')
  }
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
    throw new Error('media provider base URL cannot contain credentials, a query, or a fragment')
  }
  if (url.protocol === 'http:') {
    const host = url.hostname.toLowerCase()
    if (host !== 'localhost' && host !== '127.0.0.1' && host !== '[::1]' && host !== '::1') {
      throw new Error('unencrypted media provider URLs are allowed only on loopback')
    }
  } else if (url.protocol !== 'https:') {
    throw new Error('media provider base URL must use https (or loopback http)')
  }
  return url.toString().replace(/\/$/, '')
}

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

async function readLimited(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = response.headers.get('content-length')
  if (declared !== null) {
    const length = Number(declared)
    if (!Number.isSafeInteger(length) || length < 0 || length > maxBytes) {
      throw new Error(`media provider response exceeds the ${maxBytes}-byte limit`)
    }
  }
  if (response.body === null) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      total += next.value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        throw new Error(`media provider response exceeds the ${maxBytes}-byte limit`)
      }
      chunks.push(next.value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

async function responseError(response: Response): Promise<Error> {
  let detail = ''
  try {
    const bytes = await readLimited(response, JSON_ERROR_LIMIT)
    const text = new TextDecoder().decode(bytes)
    const parsed = object(JSON.parse(text))
    const nested = object(parsed?.error)
    detail = typeof nested?.message === 'string'
      ? nested.message
      : typeof parsed?.message === 'string' ? parsed.message : text.slice(0, 2_000)
  } catch {
    detail = ''
  }
  const suffix = detail.trim().length > 0 ? `: ${detail.trim()}` : ''
  return new Error(`media provider request failed (${response.status} ${response.statusText})${suffix}`)
}

async function boundedFetch(
  input: string,
  init: RequestInit,
  callerSignal: AbortSignal,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  callerSignal.throwIfAborted()
  // Keep both signals attached through body consumption, not merely until
  // response headers arrive. jsonRequest and media downloads read the body
  // after this helper returns, so removing the caller listener here would
  // make cancellation and timeouts ineffective on a stalled stream.
  const timeout = AbortSignal.timeout(timeoutMs)
  const signal = AbortSignal.any([callerSignal, timeout])
  return fetch(input, { ...init, signal })
}

async function jsonRequest(
  input: string,
  init: RequestInit,
  signal: AbortSignal,
  maxBytes: number,
): Promise<Record<string, unknown>> {
  const response = await boundedFetch(input, { ...init, redirect: 'error' }, signal)
  if (!response.ok) throw await responseError(response)
  const bytes = await readLimited(response, maxBytes)
  try {
    const value = object(JSON.parse(new TextDecoder().decode(bytes)))
    if (value === undefined) throw new Error('response root is not an object')
    return value
  } catch (error) {
    throw new Error(`media provider returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Resolve a media provider key through managed credentials, then the process environment.
 *
 * @param ctx - Cordis context exposing the optional credentials service.
 * @param refName - Credential reference and fallback environment variable name.
 * @returns Trimmed non-empty API key.
 */
export async function resolveMediaApiKey(ctx: Context, refName: string): Promise<string> {
  const ref = credentialRef(refName)
  const managed = ctx.get('credentials')
  const hit = managed === undefined ? undefined : await managed.resolve(ref)
  const value = hit?.value ?? process.env[refName]
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`no API key is configured for media credential ${refName}`)
  }
  return value.trim()
}

function canonicalBase64(value: string): Uint8Array {
  if (value.length === 0 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new Error('image provider returned malformed base64')
  }
  const bytes = Buffer.from(value, 'base64')
  if (bytes.toString('base64') !== value) throw new Error('image provider returned non-canonical base64')
  return bytes
}

/**
 * Generate and persist one image through an OpenAI-compatible Images API.
 *
 * @param options - Resolved provider, request, storage, size, and cancellation inputs.
 * @returns Metadata for the validated content-addressed image artifact.
 */
export async function generateOpenAICompatibleImage(options: {
  profile: ResolvedImageProfile
  apiKey: string
  prompt: string
  size: ImageSize
  quality: ImageQuality
  maxBytes: number
  store: GeneratedMediaStore
  signal: AbortSignal
}): Promise<MediaArtifact> {
  const { profile, apiKey, prompt, size, quality, maxBytes, store, signal } = options
  // OpenAI's GPT Image family always returns base64 and rejects the legacy
  // response_format field. Compatibility gateways (including Gemini's
  // OpenAI-compatible Images API) still require that field, so keep the
  // request interoperable without breaking the first-party default.
  const usesGptImageContract = /^gpt-image(?:-|$)/.test(profile.model)
  const result = await jsonRequest(
    `${profile.baseURL}/images/generations`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: profile.model,
        prompt,
        n: 1,
        size,
        quality,
        ...usesGptImageContract ? {} : { response_format: 'b64_json' },
        output_format: 'png',
      }),
    },
    signal,
    Math.ceil(maxBytes * 1.5) + 1024 * 1024,
  )
  const data = result.data
  const first = Array.isArray(data) ? object(data[0]) : undefined
  const encoded = first?.b64_json
  if (typeof encoded !== 'string') {
    throw new Error('image provider did not return b64_json; URL-only outputs are rejected')
  }
  if (encoded.length > Math.ceil(maxBytes * 4 / 3) + 16) {
    throw new Error(`generated image exceeds the ${maxBytes}-byte limit`)
  }
  const bytes = canonicalBase64(encoded)
  return store.saveBytes(bytes, 'image', maxBytes, {
    model: profile.model,
    provider: 'openai-images',
  })
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  const abortReason = (): Error => signal.reason instanceof Error
    ? signal.reason
    : new DOMException('The operation was aborted', 'AbortError')
  if (signal.aborted) return Promise.reject(abortReason())
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, ms)
    const abort = () => {
      clearTimeout(timer)
      reject(abortReason())
    }
    signal.addEventListener('abort', abort, { once: true })
  })
}

function googleDownloadAllowed(base: URL, target: URL): boolean {
  if (target.username !== '' || target.password !== '') return false
  // A user may explicitly point the provider at a loopback HTTP emulator.
  // Its result URI is safe only when it stays on that exact origin; every
  // cross-origin provider/CDN hop still requires HTTPS.
  if (target.origin === base.origin) return true
  if (target.protocol !== 'https:') return false
  const googleApi = base.hostname === 'generativelanguage.googleapis.com'
    || base.hostname.endsWith('.googleapis.com')
  if (!googleApi) return false
  return target.hostname === 'storage.googleapis.com'
    || target.hostname.endsWith('.googleusercontent.com')
    || target.hostname.endsWith('.googleapis.com')
}

async function googleDownload(
  initial: string,
  baseURL: string,
  apiKey: string,
  signal: AbortSignal,
): Promise<Response> {
  const base = new URL(baseURL)
  let current = new URL(initial)
  for (let hop = 0; hop < 4; hop++) {
    if (!googleDownloadAllowed(base, current)) throw new Error('Veo returned a download URL outside the Google media allowlist')
    const sameOrigin = current.origin === base.origin
    const response = await boundedFetch(current.toString(), {
      method: 'GET',
      redirect: 'manual',
      headers: sameOrigin ? { 'x-goog-api-key': apiKey } : {},
    }, signal, MEDIA_DOWNLOAD_TIMEOUT_MS)
    if (response.status < 300 || response.status >= 400) {
      if (!response.ok) throw await responseError(response)
      return response
    }
    const location = response.headers.get('location')
    await response.body?.cancel()
    if (location === null) throw new Error('Veo download redirect omitted Location')
    current = new URL(location, current)
  }
  throw new Error('Veo download exceeded the redirect limit')
}

/**
 * Start, poll, download, and persist one Google Veo generation operation.
 *
 * @param options - Resolved provider, request, polling, storage, and cancellation inputs.
 * @returns Metadata for the validated content-addressed video artifact.
 */
export async function generateGoogleVeoVideo(options: {
  profile: ResolvedVideoProfile
  apiKey: string
  prompt: string
  aspectRatio: VideoAspectRatio
  duration: VideoDuration
  resolution: VideoResolution
  maxBytes: number
  pollIntervalMs: number
  timeoutMs: number
  store: GeneratedMediaStore
  signal: AbortSignal
}): Promise<MediaArtifact> {
  const {
    profile, apiKey, prompt, aspectRatio, duration, resolution,
    maxBytes, pollIntervalMs, timeoutMs, store, signal,
  } = options
  if ((resolution === '1080p' || resolution === '4k') && duration !== '8') {
    throw new Error(`${resolution} Veo generation requires an 8-second duration`)
  }
  const operation = await jsonRequest(
    `${profile.baseURL}/models/${encodeURIComponent(profile.model)}:predictLongRunning`,
    {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instances: [{ prompt }],
        parameters: { aspectRatio, durationSeconds: Number(duration), resolution },
      }),
    },
    signal,
    1024 * 1024,
  )
  const operationName = operation.name
  if (typeof operationName !== 'string' || !/^[A-Za-z0-9._~/-]+$/.test(operationName)
    || operationName.startsWith('/') || operationName.includes('..')) {
    throw new Error('Veo returned an invalid operation name')
  }
  const deadline = Date.now() + timeoutMs
  let videoURI: string | undefined
  while (Date.now() < deadline) {
    const state = await jsonRequest(
      `${profile.baseURL}/${operationName}`,
      { method: 'GET', headers: { 'x-goog-api-key': apiKey } },
      signal,
      2 * 1024 * 1024,
    )
    if (state.done === true) {
      const failure = object(state.error)
      if (failure !== undefined) {
        throw new Error(typeof failure.message === 'string' ? failure.message : 'Veo generation failed')
      }
      const response = object(state.response)
      const generate = object(response?.generateVideoResponse)
      const samples = generate?.generatedSamples
      const sample = Array.isArray(samples) ? object(samples[0]) : undefined
      const video = object(sample?.video)
      if (typeof video?.uri !== 'string') throw new Error('Veo completed without a downloadable video')
      videoURI = video.uri
      break
    }
    await wait(Math.min(pollIntervalMs, Math.max(1, deadline - Date.now())), signal)
  }
  if (videoURI === undefined) throw new Error(`Veo generation did not finish within ${timeoutMs}ms`)
  const response = await googleDownload(videoURI, profile.baseURL, apiKey, signal)
  return store.saveResponse(response, 'video', maxBytes, {
    model: profile.model,
    provider: 'google-veo',
  }, signal)
}
