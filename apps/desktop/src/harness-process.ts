/**
 * Supervised DeepSeek Harness Web process for the Electron desktop shell.
 * @module @deepseek-ai/dsh-desktop/harness-process
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { createWriteStream, fchmodSync, mkdirSync, openSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'

const READY_LINE = /^dsh web: (http:\/\/127\.0\.0\.1:\d+)(?:\s|$)/u
const START_TIMEOUT_MS = 60_000
const STOP_TIMEOUT_MS = 8_000
const PROCESS_GROUP_POLL_MS = 15
const MAX_DIAGNOSTIC_LINES = 80

/** Options required to start the supervised Harness process. */
export interface HarnessLaunchOptions {
  /** Electron executable used in run-as-Node mode. */
  executable: string
  /** App-owned Harness home, separate from the command-line installation. */
  home: string
  /** Owner-only log file for Harness stdout and stderr. */
  logPath: string
  /** Cancels an in-progress launch, such as an early application Quit. */
  signal?: AbortSignal
}

/** Observable process exit information. */
export interface HarnessExit {
  /** Process exit status, or null when a signal ended it. */
  code: number | null
  /** Signal that ended the process, or null for an ordinary exit. */
  signal: NodeJS.Signals | null
}

/** A live Harness process owned by the desktop app. */
export interface HarnessHandle {
  /** Exact loopback origin serving the current desktop renderer. */
  url: string
  /** Resolves once the child process has completely exited. */
  exit: Promise<HarnessExit>
  /** Request bounded graceful shutdown and await process exit. */
  stop: () => Promise<void>
}

/**
 * Parse and validate the readiness URL emitted by the Web profile.
 * @param line - one complete stdout line.
 * @returns the exact loopback origin, or undefined for any other output.
 */
export function parseHarnessReadyUrl(line: string): string | undefined {
  const candidate = READY_LINE.exec(line)?.[1]
  if (candidate === undefined) return undefined
  const url = new URL(candidate)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.port === '') return undefined
  return url.origin
}

/**
 * Build Node-mode arguments for the Harness CLI.
 *
 * The Web profile loads the HMR service even in a packaged desktop runtime.
 * Node must expose its internal module hooks before the CLI entry is evaluated.
 */
export function harnessProcessArgs(executable: string): string[] {
  return ['--expose-internals', executable, 'web', '--host', '127.0.0.1', '--port', '0']
}

/** Resolve the built dsh executable through the installed package manifest. */
export function resolveDshExecutable(): string {
  const require = createRequire(import.meta.url)
  const manifestPath = require.resolve('@deepseek-ai/dsh/package.json')
  const manifest: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const bin = dshBin(manifest)
  if (bin === undefined) throw new Error(`desktop: ${manifestPath} does not declare the dsh executable`)
  return resolve(dirname(manifestPath), bin)
}

/**
 * Start Harness on an OS-assigned loopback port and wait for its readiness line.
 * @param options - executable, data home, and log destination.
 * @returns the supervised process after the Web profile is ready.
 */
export async function launchHarness(options: HarnessLaunchOptions): Promise<HarnessHandle> {
  const executable = resolveDshExecutable()
  mkdirSync(dirname(options.logPath), { recursive: true, mode: 0o700 })
  const logFile = openSync(options.logPath, 'a', 0o600)
  fchmodSync(logFile, 0o600)
  const log = createWriteStream(options.logPath, { fd: logFile })
  log.write(`\n[desktop ${new Date().toISOString()}] starting Harness\n`)

  const child = spawn(options.executable, harnessProcessArgs(executable), {
    env: {
      ...process.env,
      DSH_HOME: options.home,
      ELECTRON_RUN_AS_NODE: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
    windowsHide: true,
  })
  const diagnosticTail: string[] = []
  let stdoutBuffer = ''
  let stderrBuffer = ''

  child.stdout.on('data', (chunk: Buffer) => {
    log.write(chunk)
    stdoutBuffer = consumeLines(stdoutBuffer + chunk.toString('utf8'), (line) => {
      appendDiagnostic(diagnosticTail, `stdout: ${line}`)
    })
  })
  child.stderr.on('data', (chunk: Buffer) => {
    log.write(chunk)
    stderrBuffer = consumeLines(stderrBuffer + chunk.toString('utf8'), (line) => {
      appendDiagnostic(diagnosticTail, `stderr: ${line}`)
    })
  })
  child.on('error', (error) => {
    log.write(`[desktop] child-process error: ${error.message}\n`)
  })

  const exit = new Promise<HarnessExit>((resolveExit) => {
    child.once('close', (code, signal) => {
      if (stdoutBuffer !== '') appendDiagnostic(diagnosticTail, `stdout: ${stdoutBuffer}`)
      if (stderrBuffer !== '') appendDiagnostic(diagnosticTail, `stderr: ${stderrBuffer}`)
      log.write(`[desktop] Harness exited code=${String(code)} signal=${String(signal)}\n`)
      log.end()
      resolveExit({ code, signal })
    })
  })
  const stop = createProcessTreeStop(child, exit)

  let url: string
  try {
    url = await waitForReady(child, diagnosticTail, options.signal)
  } catch (error) {
    await stop()
    throw error
  }
  return {
    url,
    exit,
    stop,
  }
}

/** Read the dsh entry from either npm's string or named-bin form. */
function dshBin(manifest: unknown): string | undefined {
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) return undefined
  const bin = (manifest as Record<string, unknown>).bin
  if (typeof bin === 'string') return bin
  if (bin === null || typeof bin !== 'object' || Array.isArray(bin)) return undefined
  const named = (bin as Record<string, unknown>).dsh
  return typeof named === 'string' ? named : undefined
}

/** Consume complete newline-delimited records and retain the final fragment. */
function consumeLines(buffer: string, consume: (line: string) => void): string {
  const lines = buffer.split(/\r?\n/u)
  const remainder = lines.pop() ?? ''
  for (const line of lines) consume(line)
  return remainder
}

/** Retain a bounded error tail without keeping an unbounded child transcript in memory. */
function appendDiagnostic(lines: string[], line: string): void {
  lines.push(line)
  if (lines.length > MAX_DIAGNOSTIC_LINES) lines.shift()
}

/** Resolve on the first valid readiness line and reject on exit, spawn failure, or timeout. */
function waitForReady(child: ChildProcess, diagnosticTail: string[], signal?: AbortSignal): Promise<string> {
  return new Promise((resolveReady, rejectReady) => {
    let buffer = ''
    let settled = false
    const timer = setTimeout(() => {
      fail(new Error(`desktop: Harness did not become ready within ${String(START_TIMEOUT_MS / 1000)} seconds${diagnostics(diagnosticTail)}`))
    }, START_TIMEOUT_MS)

    const cleanup = (): void => {
      clearTimeout(timer)
      child.stdout?.off('data', onData)
      child.off('error', onError)
      child.off('close', onClose)
      signal?.removeEventListener('abort', onAbort)
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
    const onData = (chunk: Buffer): void => {
      buffer = consumeLines(buffer + chunk.toString('utf8'), (line) => {
        const url = parseHarnessReadyUrl(line)
        if (url !== undefined) succeed(url)
      })
    }
    const onError = (error: Error): void => {
      fail(new Error(`desktop: failed to start Harness: ${error.message}${diagnostics(diagnosticTail)}`))
    }
    const onClose = (code: number | null, closeSignal: NodeJS.Signals | null): void => {
      fail(new Error(`desktop: Harness exited before readiness (code=${String(code)}, signal=${String(closeSignal)})${diagnostics(diagnosticTail)}`))
    }
    const onAbort = (): void => {
      fail(new Error('desktop: Harness launch was cancelled'))
    }

    child.stdout?.on('data', onData)
    child.once('error', onError)
    child.once('close', onClose)
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted === true) onAbort()
  })
}

/** Injectable process-group operations used by focused desktop lifecycle tests. */
export interface ProcessTreeStopInternals {
  /** Host platform deciding between POSIX group and direct-child semantics. */
  platform?: NodeJS.Platform
  /** POSIX process-group probe and signal primitive. */
  kill?: (pid: number, signal: string | number) => boolean
  /** Grace for each TERM and KILL tier. */
  timeoutMs?: number
  /** Poll interval while waiting for the saved process group to disappear. */
  pollMs?: number
}

/**
 * Create an idempotent whole-tree stop around one detached child.
 *
 * The POSIX process-group id is captured immediately. It remains authoritative
 * after the direct child closes, so an unexpected leader exit cannot orphan a
 * surviving grandchild. ESRCH permanently records group quiescence and stops
 * every later probe or signal, limiting process-group-id reuse exposure.
 * @param child - detached child whose pid owns the process group.
 * @param exit - direct-child close promise, also sealing its log streams.
 * @param internals - platform, signal, and timing overrides for tests.
 * @returns One coalesced stop function performing TERM, bounded wait, then KILL.
 */
export function createProcessTreeStop(
  child: Pick<ChildProcess, 'pid' | 'exitCode' | 'signalCode' | 'kill'>,
  exit: Promise<HarnessExit>,
  internals: ProcessTreeStopInternals = {},
): () => Promise<void> {
  const platform = internals.platform ?? process.platform
  const kill = internals.kill ?? process.kill.bind(process)
  const timeoutMs = internals.timeoutMs ?? STOP_TIMEOUT_MS
  const pollMs = internals.pollMs ?? PROCESS_GROUP_POLL_MS
  // Save it while the leader is unquestionably ours. child.pid remains set
  // today, but teardown must not depend on mutable post-close child state.
  const processGroupId = platform === 'win32' ? undefined : child.pid
  let groupExitObserved = false
  let stopPromise: Promise<void> | undefined

  const groupAlive = (): boolean => {
    if (groupExitObserved || processGroupId === undefined) return false
    try {
      kill(-processGroupId, 0)
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
        groupExitObserved = true
        return false
      }
      // EPERM still proves that the group exists; fail closed for other
      // observation failures so cleanup keeps trying to signal our saved id.
      return true
    }
  }

  const signalGroup = (signal: NodeJS.Signals): void => {
    if (!groupAlive() || processGroupId === undefined) return
    try {
      kill(-processGroupId, signal)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') groupExitObserved = true
    }
  }

  const waitForGroupExit = async (): Promise<boolean> => {
    const deadline = Date.now() + timeoutMs
    while (groupAlive()) {
      const remaining = deadline - Date.now()
      if (remaining <= 0) return false
      await new Promise<void>(resolveWait => setTimeout(resolveWait, Math.min(pollMs, remaining)))
    }
    return true
  }

  const stopWindowsChild = async (): Promise<void> => {
    if (child.exitCode !== null || child.signalCode !== null) {
      await exit
      return
    }
    child.kill('SIGTERM')
    if (await settlesWithin(exit, timeoutMs)) return
    child.kill('SIGKILL')
    await exit
  }

  return () => {
    stopPromise ??= (async () => {
      if (platform === 'win32' || processGroupId === undefined) {
        await stopWindowsChild()
        return
      }
      signalGroup('SIGTERM')
      if (!await waitForGroupExit()) {
        signalGroup('SIGKILL')
        if (!await waitForGroupExit()) {
          throw new Error(`desktop: Harness process group ${String(processGroupId)} survived SIGKILL`)
        }
      }
      await exit
    })()
    return stopPromise
  }
}

/** Format the bounded tail only when the child produced diagnostic output. */
function diagnostics(lines: string[]): string {
  return lines.length === 0 ? '' : `\n\nRecent output:\n${lines.join('\n')}`
}

/** Wait for a promise without allowing teardown to hang forever. */
async function settlesWithin(promise: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<false>((resolveTimeout) => {
    timer = setTimeout(() => { resolveTimeout(false) }, timeoutMs)
  })
  const settled = await Promise.race([promise.then(() => true), timeout])
  if (timer !== undefined) clearTimeout(timer)
  return settled
}
