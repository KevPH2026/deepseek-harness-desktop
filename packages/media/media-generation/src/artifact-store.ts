/** Private content-addressed image/video storage plus a loopback Range route. */

import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { chmod, link, mkdir, open, type FileHandle, unlink } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { isTrustedApiRequest } from '@deepseek-ai/dsh-client-connection'
import { join } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { MEDIA_ROUTE_PREFIX, type MediaArtifact } from './types.ts'

interface DetectedMedia {
  extension: 'png' | 'jpg' | 'webp' | 'gif' | 'mp4'
  mediaType: MediaArtifact['mediaType']
  kind: MediaArtifact['kind']
}

const FILE_NAME = /^[a-f0-9]{64}\.(?:png|jpg|webp|gif|mp4)$/

function openReadOnlyNoFollow(path: string): Promise<FileHandle> {
  const flags = process.platform === 'win32'
    ? constants.O_RDONLY
    : constants.O_RDONLY | constants.O_NOFOLLOW
  return open(path, flags)
}

async function verifyExistingArtifact(path: string, sha256: string, bytes: number): Promise<void> {
  let handle: FileHandle | undefined
  try {
    handle = await openReadOnlyNoFollow(path)
    const info = await handle.stat()
    if (!info.isFile() || info.size !== bytes) throw new Error('metadata mismatch')
    const existing = await handle.readFile()
    if (createHash('sha256').update(existing).digest('hex') !== sha256) throw new Error('digest mismatch')
  } catch (error) {
    throw new Error('existing generated media artifact failed integrity verification', { cause: error })
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

/**
 * Determine the supported media container from trusted magic bytes, never MIME headers.
 *
 * @param bytes - Prefix or complete bytes of a generated media file.
 * @returns Detected container metadata, or `undefined` for an unsupported signature.
 */
export function detectGeneratedMedia(bytes: Uint8Array): DetectedMedia | undefined {
  const b = bytes
  if (b.length >= 8
    && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
    && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) {
    return { extension: 'png', mediaType: 'image/png', kind: 'image' }
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return { extension: 'jpg', mediaType: 'image/jpeg', kind: 'image' }
  }
  if (b.length >= 12
    && String.fromCharCode(...b.slice(0, 4)) === 'RIFF'
    && String.fromCharCode(...b.slice(8, 12)) === 'WEBP') {
    return { extension: 'webp', mediaType: 'image/webp', kind: 'image' }
  }
  if (b.length >= 6) {
    const head = String.fromCharCode(...b.slice(0, 6))
    if (head === 'GIF87a' || head === 'GIF89a') {
      return { extension: 'gif', mediaType: 'image/gif', kind: 'image' }
    }
  }
  if (b.length >= 12 && String.fromCharCode(...b.slice(4, 8)) === 'ftyp') {
    return { extension: 'mp4', mediaType: 'video/mp4', kind: 'video' }
  }
  return undefined
}

function asChunks(body: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncIterable<Uint8Array> {
  return {
    async *[Symbol.asyncIterator]() {
      const reader = body.getReader()
      const abort = () => { void reader.cancel(signal.reason) }
      signal.addEventListener('abort', abort, { once: true })
      try {
        while (true) {
          if (signal.aborted) throw signal.reason
          const next = await reader.read()
          if (next.done) return
          yield next.value
        }
      } finally {
        signal.removeEventListener('abort', abort)
        reader.releaseLock()
      }
    },
  }
}

/** Stores generated artifacts under DSH_HOME/media/v1 and serves only hashed names. */
export class GeneratedMediaStore {
  /** Private content-addressed directory containing generated media files. */
  readonly root = join(resolveDshHome(), 'media', 'v1')

  constructor(
    private readonly validateImage?: (
      data: Uint8Array,
      mediaType: Extract<MediaArtifact['mediaType'], `image/${string}`>,
    ) => Promise<void>,
  ) {}

  private async ensureRoot(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    await chmod(this.root, 0o700)
  }

  /**
   * Validate and persist one in-memory provider result.
   *
   * @param bytes - Complete generated media bytes.
   * @param expectedKind - Media kind required by the invoking tool.
   * @param maxBytes - Maximum accepted byte length.
   * @param facts - Provider and model identifiers recorded with the artifact.
   * @returns Content-addressed metadata for the persisted artifact.
   */
  async saveBytes(
    bytes: Uint8Array,
    expectedKind: MediaArtifact['kind'],
    maxBytes: number,
    facts: Pick<MediaArtifact, 'model' | 'provider'>,
  ): Promise<MediaArtifact> {
    if (expectedKind === 'image' && this.validateImage !== undefined) {
      const detected = detectGeneratedMedia(bytes)
      if (detected === undefined || detected.kind !== 'image') {
        throw new Error('media provider returned an unsupported image container')
      }
      await this.validateImage(
        bytes,
        detected.mediaType as Extract<MediaArtifact['mediaType'], `image/${string}`>,
      )
    }
    return this.saveChunks([bytes], expectedKind, maxBytes, facts)
  }

  /**
   * Stream, validate, and persist one provider download response.
   *
   * @param response - Successful media response whose body will be consumed.
   * @param expectedKind - Media kind required by the invoking tool.
   * @param maxBytes - Maximum accepted byte length.
   * @param facts - Provider and model identifiers recorded with the artifact.
   * @param signal - Cancellation signal retained through body consumption.
   * @returns Content-addressed metadata for the persisted artifact.
   */
  async saveResponse(
    response: Response,
    expectedKind: MediaArtifact['kind'],
    maxBytes: number,
    facts: Pick<MediaArtifact, 'model' | 'provider'>,
    signal: AbortSignal,
  ): Promise<MediaArtifact> {
    const declared = response.headers.get('content-length')
    if (declared !== null) {
      const length = Number(declared)
      if (!Number.isSafeInteger(length) || length < 0 || length > maxBytes) {
        throw new Error(`generated media exceeds the ${maxBytes}-byte limit`)
      }
    }
    if (response.body === null) throw new Error('media provider returned an empty body')
    return this.saveChunks(asChunks(response.body, signal), expectedKind, maxBytes, facts)
  }

  private async saveChunks(
    chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
    expectedKind: MediaArtifact['kind'],
    maxBytes: number,
    facts: Pick<MediaArtifact, 'model' | 'provider'>,
  ): Promise<MediaArtifact> {
    await this.ensureRoot()
    const temporary = join(this.root, `.tmp-${randomUUID()}`)
    const handle = await open(temporary, 'wx', 0o600)
    const hash = createHash('sha256')
    const head: number[] = []
    let bytes = 0
    try {
      for await (const chunk of chunks) {
        bytes += chunk.byteLength
        if (bytes > maxBytes) throw new Error(`generated media exceeds the ${maxBytes}-byte limit`)
        for (const value of chunk) {
          if (head.length >= 32) break
          head.push(value)
        }
        hash.update(chunk)
        await handle.write(chunk)
      }
      await handle.sync()
    } catch (error) {
      await handle.close().catch(() => undefined)
      await unlink(temporary).catch(() => undefined)
      throw error
    }
    await handle.close()
    if (bytes === 0) {
      await unlink(temporary).catch(() => undefined)
      throw new Error('media provider returned an empty file')
    }
    const detected = detectGeneratedMedia(new Uint8Array(head))
    if (detected === undefined || detected.kind !== expectedKind) {
      await unlink(temporary).catch(() => undefined)
      throw new Error(`media provider returned an unsupported ${expectedKind} container`)
    }
    const sha256 = hash.digest('hex')
    const fileName = `${sha256}.${detected.extension}`
    const target = join(this.root, fileName)
    try {
      try {
        await link(temporary, target)
        await chmod(target, 0o600)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        await verifyExistingArtifact(target, sha256, bytes)
      }
    } finally {
      await unlink(temporary).catch(() => undefined)
    }
    return {
      kind: detected.kind,
      url: `${MEDIA_ROUTE_PREFIX}/${fileName}`,
      mediaType: detected.mediaType,
      bytes,
      sha256,
      model: facts.model,
      provider: facts.provider,
    }
  }

  /** Exact-prefix route handler with GET/HEAD and single byte-range support. */
  readonly handleRequest = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    // Generated artifacts are a loopback-only capability surface. Reuse the
    // API carrier's Host/Origin/Fetch-Metadata fence so a leaked hash cannot be
    // read through DNS rebinding or a cross-site browser request.
    if (!isTrustedApiRequest(req, [])) {
      res.writeHead(403)
      res.end('forbidden')
      return
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' })
      res.end()
      return
    }
    const pathname = new URL(req.url ?? '/', 'http://loopback').pathname
    const fileName = pathname.slice(`${MEDIA_ROUTE_PREFIX}/`.length)
    if (!FILE_NAME.test(fileName) || fileName.includes('/')) {
      res.writeHead(404)
      res.end()
      return
    }
    const path = join(this.root, fileName)
    let handle: FileHandle | undefined
    let size: number
    try {
      handle = await openReadOnlyNoFollow(path)
      const info = await handle.stat()
      if (!info.isFile()) throw new Error('not a file')
      size = info.size
    } catch {
      await handle?.close().catch(() => undefined)
      res.writeHead(404)
      res.end()
      return
    }
    const extension = fileName.slice(fileName.lastIndexOf('.') + 1)
    const mediaType: Record<string, string> = {
      png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', mp4: 'video/mp4',
    }
    const common: Record<string, string> = {
      'Content-Type': mediaType[extension] ?? 'application/octet-stream',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=31536000, immutable',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'X-Content-Type-Options': 'nosniff',
    }
    let start = 0
    let end = size - 1
    const range = req.headers.range
    if (range !== undefined) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range)
      if (match === null || (match[1] === '' && match[2] === '')) {
        await handle.close()
        res.writeHead(416, { ...common, 'Content-Range': `bytes */${size}` })
        res.end()
        return
      }
      if (match[1] === '') {
        const suffix = Number(match[2])
        if (!Number.isSafeInteger(suffix) || suffix <= 0) {
          await handle.close()
          res.writeHead(416, { ...common, 'Content-Range': `bytes */${size}` })
          res.end()
          return
        }
        start = Math.max(0, size - suffix)
      } else {
        start = Number(match[1])
        if (match[2] !== '') end = Number(match[2])
      }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)
        || start < 0 || end < start || start >= size) {
        await handle.close()
        res.writeHead(416, { ...common, 'Content-Range': `bytes */${size}` })
        res.end()
        return
      }
      end = Math.min(end, size - 1)
      const length = end - start + 1
      res.writeHead(206, {
        ...common,
        'Content-Length': String(length),
        'Content-Range': `bytes ${start}-${end}/${size}`,
      })
    } else {
      res.writeHead(200, { ...common, 'Content-Length': String(size) })
    }
    if (req.method === 'HEAD') {
      await handle.close()
      res.end()
      return
    }
    const stream = handle.createReadStream({ start, end })
    stream.once('error', () => { res.destroy() })
    res.once('close', () => { stream.destroy() })
    stream.pipe(res)
  }
}
