/** Boot the packaged Harness runtime, prove post-readiness stability, and stop it. */
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

interface CloseResult {
  code: number | null
  signal: NodeJS.Signals | null
}

const READY_LINE = /^dsh web: (http:\/\/127\.0\.0\.1:\d+)(?:\s|$)/u
const START_TIMEOUT_MS = 60_000
const STOP_TIMEOUT_MS = 8_000
const STABILITY_MS = 3_000
const MAX_TRANSCRIPT_LINES = 100

const root = resolve(import.meta.dirname, '..')
const appRoot = join(root, 'apps', 'desktop', 'release', 'mac-arm64', 'DeepSeek Harness Desktop.app', 'Contents')
const executable = join(appRoot, 'MacOS', 'DeepSeek Harness Desktop')
const cli = join(appRoot, 'Resources', 'app', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const home = await mkdtemp(join(tmpdir(), 'deepseek-harness-desktop-smoke-'))

let child: ChildProcess | undefined
try {
  child = spawn(executable, ['--expose-internals', cli, 'web', '--host', '127.0.0.1', '--port', '0'], {
    detached: process.platform !== 'win32',
    env: { ...process.env, DSH_HOME: home, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const transcript: string[] = []
  const close = new Promise<CloseResult>((resolveClose) => {
    child?.once('close', (code, signal) => { resolveClose({ code, signal }) })
  })
  const url = await waitForReady(child, close, transcript)
  const firstBytes = await fetchPage(url)
  await delay(STABILITY_MS)
  if (child.exitCode !== null || child.signalCode !== null) {
    const result = await close
    throw new Error(`packaged Harness exited after readiness (${formatClose(result)}).${formatTranscript(transcript)}`)
  }
  const secondBytes = await fetchPage(url)

  signalProcessTree(child, 'SIGTERM')
  let result = await settlesWithin(close, STOP_TIMEOUT_MS)
  if (result === undefined) {
    signalProcessTree(child, 'SIGKILL')
    result = await close
  }
  if (result.code !== 0) {
    throw new Error(`packaged Harness did not shut down cleanly (${formatClose(result)}).${formatTranscript(transcript)}`)
  }
  console.log(
    `smoke-desktop-runtime: HTTP 200 before and after ${String(STABILITY_MS)}ms stability window (${String(firstBytes)}/${String(secondBytes)} bytes); clean exit.`,
  )
} finally {
  if (child !== undefined && child.exitCode === null && child.signalCode === null) {
    signalProcessTree(child, 'SIGKILL')
  }
  await rm(home, { recursive: true, force: true })
}

/** Resolve once the packaged CLI emits its exact loopback readiness line. */
function waitForReady(
  child: ChildProcess,
  close: Promise<CloseResult>,
  transcript: string[],
): Promise<string> {
  return new Promise((resolveReady, rejectReady) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      fail(new Error(`packaged Harness was not ready within ${String(START_TIMEOUT_MS / 1000)} seconds.${formatTranscript(transcript)}`))
    }, START_TIMEOUT_MS)
    const cleanup = (): void => {
      clearTimeout(timer)
      child.stdout?.off('data', onStdout)
      child.stderr?.off('data', onStderr)
      child.off('error', onError)
    }
    const succeed = (url: string): void => {
      if (settled) return
      settled = true
      cleanup()
      resolveReady(url)
    }
    const fail = (error: Error): void => {
      if (settled) return
      settled = true
      cleanup()
      rejectReady(error)
    }
    const onStdout = (chunk: Buffer): void => {
      stdout = consumeLines(stdout + chunk.toString('utf8'), (line) => {
        appendTranscript(transcript, `stdout: ${line}`)
        const url = READY_LINE.exec(line)?.[1]
        if (url !== undefined) succeed(url)
      })
    }
    const onStderr = (chunk: Buffer): void => {
      stderr = consumeLines(stderr + chunk.toString('utf8'), (line) => {
        appendTranscript(transcript, `stderr: ${line}`)
      })
    }
    const onError = (error: Error): void => {
      fail(new Error(`could not spawn packaged Harness: ${error.message}.${formatTranscript(transcript)}`))
    }
    child.stdout?.on('data', onStdout)
    child.stderr?.on('data', onStderr)
    child.once('error', onError)
    void close.then((result) => {
      if (stdout !== '') appendTranscript(transcript, `stdout: ${stdout}`)
      if (stderr !== '') appendTranscript(transcript, `stderr: ${stderr}`)
      fail(new Error(`packaged Harness exited before readiness (${formatClose(result)}).${formatTranscript(transcript)}`))
    })
  })
}

/** Fetch and fully consume the packaged Web entry. */
async function fetchPage(url: string): Promise<number> {
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, 5_000)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) throw new Error(`packaged Harness returned HTTP ${String(response.status)} for ${url}`)
    const body = await response.arrayBuffer()
    if (body.byteLength === 0) throw new Error(`packaged Harness returned an empty document for ${url}`)
    return body.byteLength
  } finally {
    clearTimeout(timer)
  }
}

function consumeLines(buffer: string, consume: (line: string) => void): string {
  const lines = buffer.split(/\r?\n/u)
  const remainder = lines.pop() ?? ''
  for (const line of lines) consume(line)
  return remainder
}

function appendTranscript(transcript: string[], line: string): void {
  transcript.push(line)
  if (transcript.length > MAX_TRANSCRIPT_LINES) transcript.shift()
}

function formatTranscript(transcript: string[]): string {
  return transcript.length === 0 ? '' : `\n\nRecent output:\n${transcript.join('\n')}`
}

function formatClose(result: CloseResult): string {
  return `code=${String(result.code)}, signal=${String(result.signal)}`
}

function signalProcessTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (process.platform !== 'win32' && child.pid !== undefined) {
    try {
      process.kill(-child.pid, signal)
      return
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ESRCH') return
    }
  }
  child.kill(signal)
}

async function settlesWithin<T>(promise: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<undefined>((resolveTimeout) => {
    timer = setTimeout(() => { resolveTimeout(undefined) }, timeoutMs)
  })
  const result = await Promise.race([promise, timeout])
  if (timer !== undefined) clearTimeout(timer)
  return result
}

function delay(ms: number): Promise<void> {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms))
}
