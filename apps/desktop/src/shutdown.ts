/** Coalesced Electron quit coordination that keeps every graceful quit intercepted. */

/** The small Electron quit-event surface used by the coordinator. */
export interface QuitEvent {
  /** Keep Electron alive while asynchronous teardown is pending. */
  preventDefault(): void
}

/** One desktop shutdown lifecycle shared by normal and failure exits. */
export interface DesktopShutdown {
  /** Whether cleanup has started and all later requests must join it. */
  readonly active: boolean
  /** Intercept one Electron before-quit event and start or join normal shutdown. */
  beforeQuit(event: QuitEvent): void
  /** Start or join cleanup; the first requested exit code wins. */
  request(exitCode: number): Promise<void>
}

/**
 * Create one Electron shutdown lifecycle around an asynchronous disposer.
 * @param cleanup - Whole desktop-process-tree teardown that resolves at quiescence.
 * @param exit - Final synchronous Electron exit invoked after cleanup settles.
 * @returns A coordinator whose requests share one shutdown promise.
 */
export function createDesktopShutdown(
  cleanup: () => Promise<void>,
  exit: (exitCode: number) => void,
): DesktopShutdown {
  let shutdownPromise: Promise<void> | undefined

  const request = (exitCode: number): Promise<void> => {
    shutdownPromise ??= Promise.resolve()
      .then(cleanup)
      // Teardown is best-effort at the final application boundary: either
      // outcome must release Electron, and request() must not reject through
      // a void event-listener call as an unhandled promise.
      .catch(() => {})
      .then(() => { exit(exitCode) })
    return shutdownPromise
  }

  return {
    get active() { return shutdownPromise !== undefined },
    beforeQuit(event) {
      // Electron can emit before-quit again while async cleanup is pending.
      // Every emission stays intercepted; request() merely joins the first.
      event.preventDefault()
      void request(0)
    },
    request,
  }
}
