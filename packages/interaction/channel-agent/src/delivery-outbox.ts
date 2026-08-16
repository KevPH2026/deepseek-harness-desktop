/** Lifecycle-owned retry scheduler for durable channel deliveries. */

/** Retry timing for one pending durable delivery. */
export interface DeliveryOutboxRetryPolicy {
  /** Delay before the second delivery attempt. */
  readonly initialDelayMs: number
  /** Maximum interval retained after exponential backoff reaches its cap. */
  readonly maxDelayMs: number
}

/** Sparse retry transition reported without provider error messages. */
export interface DeliveryOutboxRetryNotice {
  /** First failure, or the first failure attempted at the capped interval. */
  readonly phase: 'first-failure' | 'capped-interval'
  /** Sanitized provider error code, error name, or JavaScript value type. */
  readonly failure: string
}

/** Construction values shared by every row worker in one runtime. */
export interface DeliveryOutboxOptions {
  /** Runtime lifecycle signal that cancels waits and active provider calls. */
  readonly signal: AbortSignal
  /** Exponential delay policy with a retained maximum interval. */
  readonly retry: DeliveryOutboxRetryPolicy
  /** Optional sparse diagnostic sink; callback failures are contained. */
  readonly onRetry?: (notice: DeliveryOutboxRetryNotice) => void
}

const SAFE_FAILURE_TAG = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/u

/**
 * Reduce an arbitrary provider failure to a log-safe stable tag.
 * @param error - Provider or channel failure.
 * @returns A bounded code, name, or primitive type without the error message.
 */
export function deliveryFailureTag(error: unknown): string {
  try {
    if (error !== null && typeof error === 'object' && 'code' in error) {
      const code = (error as { readonly code?: unknown }).code
      if (typeof code === 'string' && SAFE_FAILURE_TAG.test(code)) return code
    }
  } catch {
    // A hostile failure object cannot break durable retry scheduling.
  }
  try {
    if (error instanceof Error) {
      return SAFE_FAILURE_TAG.test(error.name) ? error.name : 'Error'
    }
  } catch {
    // A Proxy may throw while JavaScript checks its prototype.
  }
  return typeof error
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('channel delivery outbox disposed')
}

function waitForRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, delayMs)
    const onAbort = (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      reject(abortReason(signal))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/** One retrying worker per durable row key, owned by a runtime lifecycle signal. */
export class DeliveryOutbox<Key> {
  private readonly workers = new Map<Key, Promise<void>>()

  /** @param options - Shared lifecycle, retry timing, and sparse diagnostics. */
  constructor(private readonly options: DeliveryOutboxOptions) {}

  /** Number of row workers that have not delivered and committed successfully. */
  get size(): number {
    return this.workers.size
  }

  /**
   * Start or join the sole worker for one durable row.
   * @param key - Stable durable row key.
   * @param operation - One at-least-once attempt that sends and persists its delivered marker.
   * @returns The shared worker promise, settled only after success or lifecycle cancellation.
   */
  run(key: Key, operation: (signal: AbortSignal) => Promise<void>): Promise<void> {
    const existing = this.workers.get(key)
    if (existing !== undefined) return existing
    const worker = Promise.resolve()
      .then(async () => { await this.retry(operation) })
      .finally(() => {
        this.workers.delete(key)
      })
    this.workers.set(key, worker)
    return worker
  }

  /**
   * Wait for the current worker set after the owner has stopped starts and aborted the lifecycle signal.
   * @returns Once all current workers have reached quiescence.
   */
  async drain(): Promise<void> {
    await Promise.allSettled([...this.workers.values()])
  }

  private async retry(operation: (signal: AbortSignal) => Promise<void>): Promise<void> {
    const { signal } = this.options
    let delayMs = Math.min(this.options.retry.initialDelayMs, this.options.retry.maxDelayMs)
    let failureCount = 0
    let reportedCap = delayMs >= this.options.retry.maxDelayMs
    while (true) {
      signal.throwIfAborted()
      try {
        await operation(signal)
        return
      } catch (error: unknown) {
        if (signal.aborted) throw abortReason(signal)
        if (failureCount === 0) {
          this.report({ phase: 'first-failure', failure: deliveryFailureTag(error) })
        } else if (!reportedCap && delayMs >= this.options.retry.maxDelayMs) {
          reportedCap = true
          this.report({ phase: 'capped-interval', failure: deliveryFailureTag(error) })
        }
        failureCount += 1
        await waitForRetry(delayMs, signal)
        delayMs = Math.min(this.options.retry.maxDelayMs, delayMs * 2)
      }
    }
  }

  private report(notice: DeliveryOutboxRetryNotice): void {
    try {
      this.options.onRetry?.(notice)
    } catch {
      // Diagnostics cannot change durable delivery scheduling.
    }
  }
}
