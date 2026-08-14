import type { ChildProcess } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createProcessTreeStop, harnessProcessArgs, parseHarnessReadyUrl, type HarnessExit,
} from '../src/harness-process.ts'
import { externalHttpUrl, isHarnessNavigation } from '../src/navigation.ts'
import { createDesktopShutdown } from '../src/shutdown.ts'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('parseHarnessReadyUrl', () => {
  it('accepts only the exact loopback readiness line', () => {
    expect(parseHarnessReadyUrl('dsh web: http://127.0.0.1:43129')).toBe('http://127.0.0.1:43129')
    expect(parseHarnessReadyUrl('dsh web: http://127.0.0.1:43129 (LAN: http://10.0.0.1:43129)')).toBe('http://127.0.0.1:43129')
  })

  it('rejects non-loopback and malformed output', () => {
    expect(parseHarnessReadyUrl('dsh web: http://0.0.0.0:43129')).toBeUndefined()
    expect(parseHarnessReadyUrl('dsh web: https://127.0.0.1:43129')).toBeUndefined()
    expect(parseHarnessReadyUrl('http://127.0.0.1:43129')).toBeUndefined()
  })
})

describe('harnessProcessArgs', () => {
  it('enables Node internals before loading the Web profile on a random loopback port', () => {
    expect(harnessProcessArgs('/runtime/dsh.js')).toEqual([
      '--expose-internals',
      '/runtime/dsh.js',
      'web',
      '--host',
      '127.0.0.1',
      '--port',
      '0',
    ])
  })
})

describe('desktop shutdown lifecycle', () => {
  it('prevents every before-quit event while all requests join one cleanup', async () => {
    let finishCleanup!: () => void
    const cleanup = vi.fn(() => new Promise<void>((resolve) => { finishCleanup = resolve }))
    const exit = vi.fn()
    const shutdown = createDesktopShutdown(cleanup, exit)
    const first = { preventDefault: vi.fn() }
    const second = { preventDefault: vi.fn() }

    shutdown.beforeQuit(first)
    shutdown.beforeQuit(second)
    const pending = shutdown.request(9)
    await Promise.resolve()

    expect(first.preventDefault).toHaveBeenCalledOnce()
    expect(second.preventDefault).toHaveBeenCalledOnce()
    expect(cleanup).toHaveBeenCalledOnce()
    expect(exit).not.toHaveBeenCalled()

    finishCleanup()
    await pending
    expect(exit).toHaveBeenCalledOnce()
    expect(exit).toHaveBeenCalledWith(0)
  })
})

describe('Harness process-tree shutdown', () => {
  const exited: HarnessExit = { code: 1, signal: null }

  function closedChild(pid: number): Pick<ChildProcess, 'pid' | 'exitCode' | 'signalCode' | 'kill'> {
    return {
      pid,
      exitCode: 1,
      signalCode: null,
      kill: vi.fn(),
    }
  }

  it('signals the saved POSIX group after its direct child has already closed', async () => {
    let groupAlive = true
    const delivered: Array<string | number> = []
    const kill = (pid: number, signal: string | number): boolean => {
      expect(pid).toBe(-4242)
      if (signal === 0) {
        if (groupAlive) return true
        throw Object.assign(new Error('gone'), { code: 'ESRCH' })
      }
      delivered.push(signal)
      groupAlive = false
      return true
    }
    const stop = createProcessTreeStop(closedChild(4242), Promise.resolve(exited), {
      platform: 'darwin', kill, timeoutMs: 50, pollMs: 1,
    })

    await stop()

    expect(delivered).toEqual(['SIGTERM'])
  })

  it('escalates a surviving group once and treats ESRCH as permanent quiescence', async () => {
    vi.useFakeTimers()
    let groupAlive = true
    const delivered: Array<string | number> = []
    const kill = (_pid: number, signal: string | number): boolean => {
      if (signal === 0) {
        if (groupAlive) return true
        throw Object.assign(new Error('gone'), { code: 'ESRCH' })
      }
      delivered.push(signal)
      if (signal === 'SIGKILL') groupAlive = false
      return true
    }
    const stop = createProcessTreeStop(closedChild(4343), Promise.resolve(exited), {
      platform: 'darwin', kill, timeoutMs: 25, pollMs: 5,
    })

    const first = stop()
    const second = stop()
    expect(second).toBe(first)
    await vi.advanceTimersByTimeAsync(25)
    await first
    await stop()

    expect(delivered).toEqual(['SIGTERM', 'SIGKILL'])
  })
})

describe('desktop navigation policy', () => {
  const origin = 'http://127.0.0.1:43129'

  it('allows only the current Harness origin in the Electron renderer', () => {
    expect(isHarnessNavigation(`${origin}/settings`, origin)).toBe(true)
    expect(isHarnessNavigation('http://127.0.0.1:43130/', origin)).toBe(false)
    expect(isHarnessNavigation('https://example.com/', origin)).toBe(false)
  })

  it('hands only HTTP and HTTPS targets to the system browser', () => {
    expect(externalHttpUrl('https://example.com/docs')).toBe('https://example.com/docs')
    expect(externalHttpUrl('file:///etc/passwd')).toBeUndefined()
    expect(externalHttpUrl('javascript:alert(1)')).toBeUndefined()
  })
})
