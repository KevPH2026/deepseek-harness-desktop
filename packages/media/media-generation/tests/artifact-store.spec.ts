import { createServer, request, type Server } from 'node:http'
import { mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GeneratedMediaStore, detectGeneratedMedia } from '../src/artifact-store.ts'
import {
  generatedMediaFromText, generatedMediaMeta, mediaArtifactMarker, type MediaArtifact,
} from '../src/types.ts'

// A valid 1x1 RGBA PNG, kept tiny so range and content-addressing assertions
// exercise real encoded bytes without a binary fixture in the repository.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+Av7R2QAAAABJRU5ErkJggg==',
  'base64',
)

let home: string
let previousHome: string | undefined
let server: Server | undefined

beforeEach(async () => {
  previousHome = process.env.DSH_HOME
  home = await mkdtemp(join(tmpdir(), 'dsh-media-store-'))
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

describe('generated media artifacts', () => {
  it('narrows magic bytes and replay metadata before rendering a URL', () => {
    expect(detectGeneratedMedia(PNG)).toMatchObject({ kind: 'image', mediaType: 'image/png' })
    expect(detectGeneratedMedia(new Uint8Array([1, 2, 3]))).toBeUndefined()

    const artifact: MediaArtifact = {
      kind: 'image',
      url: `/generated-media/${'a'.repeat(64)}.png`,
      mediaType: 'image/png',
      bytes: PNG.byteLength,
      sha256: 'a'.repeat(64),
      model: 'fixture-image',
      provider: 'openai-images',
    }
    const marker = mediaArtifactMarker(artifact)
    expect(generatedMediaFromText(`created\n${marker}`)?.artifact).toEqual(artifact)
    expect(generatedMediaMeta({
      kind: 'generated-media',
      artifact: { ...artifact, url: 'https://attacker.invalid/image.png' },
    })).toBeUndefined()
  })

  it('fully validates images before publishing private content-addressed bytes', async () => {
    const calls: string[] = []
    const store = new GeneratedMediaStore(async (_data, mediaType) => {
      calls.push(mediaType)
    })
    const artifact = await store.saveBytes(PNG, 'image', 1024 * 1024, {
      model: 'fixture-image',
      provider: 'openai-images',
    })

    expect(calls).toEqual(['image/png'])
    expect(artifact.url).toMatch(/^\/generated-media\/[a-f0-9]{64}\.png$/)
    const path = join(store.root, artifact.url.split('/').at(-1) as string)
    expect(await readFile(path)).toEqual(PNG)
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect((await stat(store.root)).mode & 0o777).toBe(0o700)
  })

  it('rejects a corrupt existing content-addressed target and removes staging bytes', async () => {
    const store = new GeneratedMediaStore()
    const first = await store.saveBytes(PNG, 'image', 1024 * 1024, {
      model: 'fixture-image',
      provider: 'openai-images',
    })
    await expect(store.saveBytes(PNG, 'image', 1024 * 1024, {
      model: 'fixture-image',
      provider: 'openai-images',
    })).resolves.toEqual(first)
    const path = join(store.root, first.url.split('/').at(-1) as string)
    await writeFile(path, Buffer.alloc(PNG.byteLength))

    await expect(store.saveBytes(PNG, 'image', 1024 * 1024, {
      model: 'fixture-image',
      provider: 'openai-images',
    })).rejects.toThrow('existing generated media artifact failed integrity verification')
    expect((await readdir(store.root)).filter(name => name.startsWith('.tmp-'))).toEqual([])
  })

  it('serves only hashed media names and honors single byte ranges', async () => {
    const store = new GeneratedMediaStore()
    const artifact = await store.saveBytes(PNG, 'image', 1024 * 1024, {
      model: 'fixture-image',
      provider: 'openai-images',
    })
    server = createServer((req, res) => { void store.handleRequest(req, res) })
    await new Promise<void>((resolve, reject) => {
      server?.once('error', reject)
      server?.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('fixture server did not bind')
    const origin = `http://127.0.0.1:${String(address.port)}`

    const partial = await fetch(`${origin}${artifact.url}`, { headers: { Range: 'bytes=0-7' } })
    expect(partial.status).toBe(206)
    expect(partial.headers.get('content-range')).toBe(`bytes 0-7/${String(PNG.byteLength)}`)
    expect(new Uint8Array(await partial.arrayBuffer())).toEqual(new Uint8Array(PNG.subarray(0, 8)))
    expect((await fetch(`${origin}/generated-media/not-a-hash.png`)).status).toBe(404)
    expect((await fetch(`${origin}${artifact.url}`, { method: 'POST' })).status).toBe(405)

    const crossSite = await fetch(`${origin}${artifact.url}`, {
      headers: { Origin: 'https://attacker.invalid', 'Sec-Fetch-Site': 'cross-site' },
    })
    expect(crossSite.status).toBe(403)

    const reboundStatus = await new Promise<number | undefined>((resolve, reject) => {
      const rebound = request(`${origin}${artifact.url}`, {
        headers: { Host: 'attacker.invalid' },
      }, (response) => {
        response.resume()
        response.once('end', () => { resolve(response.statusCode) })
      })
      rebound.once('error', reject)
      rebound.end()
    })
    expect(reboundStatus).toBe(403)
  })

  it.skipIf(process.platform === 'win32')('does not serve a symbolic-link artifact target', async () => {
    const store = new GeneratedMediaStore()
    const artifact = await store.saveBytes(PNG, 'image', 1024 * 1024, {
      model: 'fixture-image',
      provider: 'openai-images',
    })
    const artifactPath = join(store.root, artifact.url.split('/').at(-1) as string)
    const outside = join(home, 'outside.png')
    await writeFile(outside, PNG)
    await rm(artifactPath)
    await symlink(outside, artifactPath)
    server = createServer((req, res) => { void store.handleRequest(req, res) })
    await new Promise<void>((resolve, reject) => {
      server?.once('error', reject)
      server?.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('fixture server did not bind')

    expect((await fetch(`http://127.0.0.1:${String(address.port)}${artifact.url}`)).status).toBe(404)
  })

  it('leaves no published artifact when the full image validator rejects', async () => {
    const store = new GeneratedMediaStore(() => Promise.reject(new Error('decode refused')))
    await expect(store.saveBytes(PNG, 'image', 1024 * 1024, {
      model: 'fixture-image',
      provider: 'openai-images',
    })).rejects.toThrow('decode refused')
    await expect(stat(store.root)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
