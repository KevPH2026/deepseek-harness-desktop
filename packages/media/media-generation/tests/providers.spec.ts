import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GeneratedMediaStore } from '../src/artifact-store.ts'
import {
  generateGoogleVeoVideo, generateOpenAICompatibleImage, normalizeMediaBaseURL,
} from '../src/providers.ts'

const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+Av7R2QAAAABJRU5ErkJggg=='
// Minimal ISO-BMFF header sufficient for the store's bounded container gate.
const MP4 = Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0])

let home: string
let previousHome: string | undefined
let server: Server | undefined

beforeEach(async () => {
  previousHome = process.env.DSH_HOME
  home = await mkdtemp(join(tmpdir(), 'dsh-media-provider-'))
  process.env.DSH_HOME = home
})

afterEach(async () => {
  const active = server
  if (active !== undefined) {
    await new Promise<void>((resolve) => {
      active.close(() => { resolve() })
    })
  }
  server = undefined
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  await rm(home, { recursive: true, force: true })
})

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Uint8Array[] = []
  for await (const chunk of req) {
    if (typeof chunk === 'string') chunks.push(Buffer.from(chunk))
    else if (chunk instanceof Uint8Array) chunks.push(chunk)
    else throw new TypeError('fixture server received an unsupported request chunk')
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
}

async function listen(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<string> {
  server = createServer(handler)
  await new Promise<void>((resolve, reject) => {
    server?.once('error', reject)
    server?.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('fixture server did not bind')
  return `http://127.0.0.1:${String(address.port)}`
}

describe('provider URL policy', () => {
  it('accepts HTTPS and explicit loopback HTTP but rejects exposed cleartext endpoints', () => {
    expect(normalizeMediaBaseURL('https://api.openai.com/v1/')).toBe('https://api.openai.com/v1')
    expect(normalizeMediaBaseURL('http://127.0.0.1:8080/v1')).toBe('http://127.0.0.1:8080/v1')
    expect(() => normalizeMediaBaseURL('http://10.0.0.3/v1')).toThrow(/loopback/)
    expect(() => normalizeMediaBaseURL('file:///tmp/model')).toThrow(/https/)
    expect(() => normalizeMediaBaseURL('https://key@example.com/v1')).toThrow(/credentials/)
  })
})

describe('media provider adapters', () => {
  it('uses the GPT Image contract without its rejected legacy response_format field', async () => {
    let request: Record<string, unknown> | undefined
    const origin = await listen((req, res) => {
      void body(req).then((value) => {
        request = value
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ data: [{ b64_json: PNG_BASE64 }] }))
      })
    })
    const store = new GeneratedMediaStore()
    const artifact = await generateOpenAICompatibleImage({
      profile: {
        baseURL: origin,
        model: 'gpt-image-2',
        apiKeyEnv: 'TEST_KEY',
        defaultSize: 'auto',
        defaultQuality: 'auto',
      },
      apiKey: 'secret-not-logged',
      prompt: 'one green pixel',
      size: '1024x1024',
      quality: 'medium',
      maxBytes: 1024 * 1024,
      store,
      signal: new AbortController().signal,
    })
    expect(request).toMatchObject({ model: 'gpt-image-2', n: 1, output_format: 'png' })
    expect(request).not.toHaveProperty('response_format')
    expect(artifact).toMatchObject({ kind: 'image', provider: 'openai-images' })
  })

  it('keeps response_format for OpenAI-compatible gateway image models', async () => {
    let request: Record<string, unknown> | undefined
    const origin = await listen((req, res) => {
      void body(req).then((value) => {
        request = value
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ data: [{ b64_json: PNG_BASE64 }] }))
      })
    })
    await generateOpenAICompatibleImage({
      profile: {
        baseURL: origin,
        model: 'gemini-2.5-flash-image',
        apiKeyEnv: 'TEST_KEY',
        defaultSize: 'auto',
        defaultQuality: 'auto',
      },
      apiKey: 'secret-not-logged',
      prompt: 'fixture',
      size: 'auto',
      quality: 'auto',
      maxBytes: 1024 * 1024,
      store: new GeneratedMediaStore(),
      signal: new AbortController().signal,
    })
    expect(request).toHaveProperty('response_format', 'b64_json')
  })

  it('keeps caller cancellation attached while a provider response body is stalled', async () => {
    const origin = await listen((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.write('{"data":[')
    })
    const controller = new AbortController()
    const generation = generateOpenAICompatibleImage({
      profile: {
        baseURL: origin,
        model: 'gpt-image-2',
        apiKeyEnv: 'TEST_KEY',
        defaultSize: 'auto',
        defaultQuality: 'auto',
      },
      apiKey: 'fixture-key',
      prompt: 'fixture',
      size: 'auto',
      quality: 'auto',
      maxBytes: 1024 * 1024,
      store: new GeneratedMediaStore(),
      signal: controller.signal,
    })
    setTimeout(() => { controller.abort(new Error('fixture cancelled')) }, 20)
    await expect(generation).rejects.toThrow(/fixture cancelled/)
  })

  it('creates, polls and downloads one bounded Veo operation from the configured origin', async () => {
    const requests: Array<{
      method: string
      path: string
      key: string | undefined
      body?: Record<string, unknown>
    }> = []
    const origin = await listen((req, res) => {
      const path = new URL(req.url ?? '/', 'http://fixture').pathname
      const fact = { method: req.method ?? '', path, key: req.headers['x-goog-api-key'] as string | undefined }
      if (path.endsWith(':predictLongRunning')) {
        void body(req).then((value) => {
          requests.push({ ...fact, body: value })
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ name: 'operations/fixture' }))
        })
        return
      }
      requests.push(fact)
      if (path === '/operations/fixture') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          done: true,
          response: { generateVideoResponse: { generatedSamples: [{ video: { uri: `${origin}/download.mp4` } }] } },
        }))
        return
      }
      if (path === '/download.mp4') {
        res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': String(MP4.byteLength) })
        res.end(MP4)
        return
      }
      res.writeHead(404)
      res.end()
    })

    const artifact = await generateGoogleVeoVideo({
      profile: {
        baseURL: origin,
        model: 'veo-3.1-generate-preview',
        apiKeyEnv: 'TEST_KEY',
        defaultAspectRatio: '16:9',
        defaultDuration: '4',
        defaultResolution: '720p',
      },
      apiKey: 'fixture-key',
      prompt: 'cinematic fixture',
      aspectRatio: '16:9',
      duration: '4',
      resolution: '720p',
      maxBytes: 1024 * 1024,
      pollIntervalMs: 1,
      timeoutMs: 1000,
      store: new GeneratedMediaStore(),
      signal: new AbortController().signal,
    })

    expect(artifact).toMatchObject({ kind: 'video', provider: 'google-veo', mediaType: 'video/mp4' })
    expect(requests.map(item => item.path)).toEqual([
      '/models/veo-3.1-generate-preview:predictLongRunning',
      '/operations/fixture',
      '/download.mp4',
    ])
    expect(requests.every(item => item.key === 'fixture-key')).toBe(true)
    expect(requests[0]?.body).toMatchObject({
      parameters: { aspectRatio: '16:9', durationSeconds: 4, resolution: '720p' },
    })
  })

  it('rejects an invalid high-resolution Veo duration before any network charge', async () => {
    let requests = 0
    const origin = await listen((_req, res) => {
      requests += 1
      res.writeHead(500)
      res.end()
    })
    await expect(generateGoogleVeoVideo({
      profile: {
        baseURL: origin,
        model: 'veo-3.1-generate-preview',
        apiKeyEnv: 'TEST_KEY',
        defaultAspectRatio: '16:9',
        defaultDuration: '4',
        defaultResolution: '1080p',
      },
      apiKey: 'fixture-key',
      prompt: 'fixture',
      aspectRatio: '16:9',
      duration: '4',
      resolution: '1080p',
      maxBytes: 1024 * 1024,
      pollIntervalMs: 1,
      timeoutMs: 1000,
      store: new GeneratedMediaStore(),
      signal: new AbortController().signal,
    })).rejects.toThrow(/requires an 8-second duration/)
    expect(requests).toBe(0)
  })
})
