/**
 * Window visibility lifecycle for a desktop app that keeps its Host alive in the tray.
 * The behavior was informed by the MIT-licensed anywhere-labs desktop fork,
 * then adapted to this wrapper's existing shutdown and process-tree ownership.
 */

/** Minimal close event accepted by the window lifecycle. */
export interface WindowCloseEvent {
  /** Cancel destruction so the window can be hidden instead. */
  preventDefault(): void
}

/** Window operations used without importing Electron in focused tests. */
export interface DesktopWindow {
  /** Whether the native window has already been destroyed. */
  isDestroyed(): boolean
  /** Whether the native window is currently visible. */
  isVisible(): boolean
  /** Reveal the native window. */
  show(): void
  /** Give the native window keyboard focus. */
  focus(): void
  /** Hide without destroying the renderer or disconnecting Harness. */
  hide(): void
}

/** Platform-neutral controller for close-to-tray and restore behavior. */
export interface DesktopWindowLifecycle {
  /** Hide an ordinary close, while allowing application shutdown to proceed. */
  onWindowClose(event: WindowCloseEvent): void
  /** Restore the existing window, or create a replacement when needed. */
  showWindow(): void
}

/** Inputs supplied by the Electron main process. */
export interface DesktopWindowLifecycleOptions {
  /** Resolve the current window, when one exists. */
  readonly getWindow: () => DesktopWindow | undefined
  /** Create a replacement window. Its ready-to-show handler owns first reveal. */
  readonly createWindow: () => DesktopWindow
  /** Whether whole-application shutdown has begun. */
  readonly isQuitting: () => boolean
}

/**
 * Keep Harness and its renderer connected across ordinary window closes.
 * @param options - Current-window access, creation and shutdown state.
 * @returns A controller used by native close, tray, Dock and second-instance events.
 */
export function createDesktopWindowLifecycle(
  options: DesktopWindowLifecycleOptions,
): DesktopWindowLifecycle {
  return {
    onWindowClose(event) {
      if (options.isQuitting()) return
      event.preventDefault()
      const window = options.getWindow()
      if (window !== undefined && !window.isDestroyed()) window.hide()
    },
    showWindow() {
      if (options.isQuitting()) return
      const window = options.getWindow()
      if (window === undefined || window.isDestroyed()) {
        options.createWindow()
        return
      }
      // Electron can briefly retain a stale visible state after a macOS close
      // event is prevented and the window is hidden. show() is idempotent for
      // an already-visible window and reliable for every restore source.
      window.show()
      window.focus()
    },
  }
}
