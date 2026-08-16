import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DeliveryOutbox,
  deliveryFailureTag,
  type DeliveryOutboxRetryNotice,
} from '@deepseek-ai/dsh-channel-agent/src/delivery-outbox.ts'

afterEach(() => {
  vi.useRealTimers()
})

describe('DeliveryOutbox', () => {
  it('runs one worker per row and continues at the capped interval until success', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const notices: DeliveryOutboxRetryNotice[] = []
    const outbox = new DeliveryOutbox<string>({
      signal: controller.signal,
      retry: { initialDelayMs: 2, maxDelayMs: 4 },
      onRetry: (notice) => { notices.push(notice) },
    })
    let attempts = 0
    const operation = vi.fn(async () => {
      attempts += 1
      if (attempts <= 7) throw Object.assign(new Error('provider response must stay private'), {
        code: 'CHANNEL_TEMPORARY',
      })
    })

    const first = outbox.run('row', operation)
    const joined = outbox.run('row', async () => { throw new Error('must not run') })
    expect(joined).toBe(first)
    await vi.advanceTimersByTimeAsync(30)
    await expect(first).resolves.toBeUndefined()

    expect(operation).toHaveBeenCalledTimes(8)
    expect(notices).toEqual([
      { phase: 'first-failure', failure: 'CHANNEL_TEMPORARY' },
      { phase: 'capped-interval', failure: 'CHANNEL_TEMPORARY' },
    ])
    expect(outbox.size).toBe(0)
  })

  it('repeats the send-and-marker operation when the delivered-marker commit fails', async () => {
    vi.useFakeTimers()
    const outbox = new DeliveryOutbox<string>({
      signal: new AbortController().signal,
      retry: { initialDelayMs: 1, maxDelayMs: 1 },
    })
    let sends = 0
    let markers = 0
    const worker = outbox.run('row', async () => {
      sends += 1
      markers += 1
      if (markers === 1) throw new Error('temporary storage failure')
    })

    await vi.advanceTimersByTimeAsync(1)
    await expect(worker).resolves.toBeUndefined()
    expect({ sends, markers }).toEqual({ sends: 2, markers: 2 })
  })

  it('aborts a capped worker and drains without another attempt', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const outbox = new DeliveryOutbox<string>({
      signal: controller.signal,
      retry: { initialDelayMs: 5, maxDelayMs: 5 },
    })
    const operation = vi.fn(async () => { throw new Error('offline') })
    const worker = outbox.run('row', operation)
    await vi.advanceTimersByTimeAsync(0)
    expect(operation).toHaveBeenCalledTimes(1)

    controller.abort('runtime closing')
    await expect(worker).rejects.toThrow('channel delivery outbox disposed')
    await expect(outbox.drain()).resolves.toBeUndefined()
    await vi.advanceTimersByTimeAsync(100)
    expect(operation).toHaveBeenCalledTimes(1)
    expect(outbox.size).toBe(0)
  })

  it('contains diagnostic callback failures and never exposes an unsafe error name', async () => {
    vi.useFakeTimers()
    const outbox = new DeliveryOutbox<string>({
      signal: new AbortController().signal,
      retry: { initialDelayMs: 1, maxDelayMs: 1 },
      onRetry: () => { throw new Error('diagnostic failure') },
    })
    let attempts = 0
    const worker = outbox.run('row', async () => {
      attempts += 1
      if (attempts === 1) {
        const error = new Error('secret response')
        error.name = 'secret response with spaces'
        throw error
      }
    })

    await vi.advanceTimersByTimeAsync(1)
    await expect(worker).resolves.toBeUndefined()
    expect(deliveryFailureTag(Object.assign(new Error('hidden'), { name: 'unsafe name' }))).toBe('Error')
    expect(deliveryFailureTag(Object.defineProperty({}, 'code', {
      get: () => { throw new Error('secret getter') },
    }))).toBe('object')
    expect(deliveryFailureTag(new Proxy({}, {
      has: () => false,
      getPrototypeOf: () => { throw new Error('secret prototype') },
    }))).toBe('object')
  })

  it('uses the lifecycle reason when an active provider attempt observes cancellation', async () => {
    const controller = new AbortController()
    const outbox = new DeliveryOutbox<string>({
      signal: controller.signal,
      retry: { initialDelayMs: 1, maxDelayMs: 1 },
    })
    const reason = new Error('closing')
    const worker = outbox.run('row', async () => {
      controller.abort(reason)
      throw new Error('provider cancellation')
    })

    await expect(worker).rejects.toBe(reason)
  })
})
