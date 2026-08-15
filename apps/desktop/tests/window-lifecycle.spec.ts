import { describe, expect, it, vi } from 'vitest'
import {
  createDesktopWindowLifecycle, type DesktopWindow,
} from '../src/window-lifecycle.ts'

function fakeWindow(overrides: Partial<DesktopWindow> = {}): DesktopWindow {
  return {
    isDestroyed: vi.fn(() => false),
    isVisible: vi.fn(() => true),
    show: vi.fn(),
    focus: vi.fn(),
    hide: vi.fn(),
    ...overrides,
  }
}

describe('desktop close-to-tray lifecycle', () => {
  it('hides an ordinary close without destroying Harness or its renderer', () => {
    const hide = vi.fn()
    const window = fakeWindow({ hide })
    const event = { preventDefault: vi.fn() }
    const lifecycle = createDesktopWindowLifecycle({
      getWindow: () => window,
      createWindow: vi.fn(),
      isQuitting: () => false,
    })

    lifecycle.onWindowClose(event)

    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(hide).toHaveBeenCalledOnce()
  })

  it('allows native close events to proceed during whole-app shutdown', () => {
    const hide = vi.fn()
    const window = fakeWindow({ hide })
    const event = { preventDefault: vi.fn() }
    const lifecycle = createDesktopWindowLifecycle({
      getWindow: () => window,
      createWindow: vi.fn(),
      isQuitting: () => true,
    })

    lifecycle.onWindowClose(event)

    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(hide).not.toHaveBeenCalled()
  })

  it('restores and focuses a hidden window from tray, Dock or second instance', () => {
    const show = vi.fn()
    const focus = vi.fn()
    const window = fakeWindow({ isVisible: vi.fn(() => false), show, focus })
    const lifecycle = createDesktopWindowLifecycle({
      getWindow: () => window,
      createWindow: vi.fn(),
      isQuitting: () => false,
    })

    lifecycle.showWindow()

    expect(show).toHaveBeenCalledOnce()
    expect(focus).toHaveBeenCalledOnce()
  })

  it('reasserts show when Electron reports a stale visible state after close', () => {
    const show = vi.fn()
    const focus = vi.fn()
    const window = fakeWindow({ isVisible: vi.fn(() => true), show, focus })
    const lifecycle = createDesktopWindowLifecycle({
      getWindow: () => window,
      createWindow: vi.fn(),
      isQuitting: () => false,
    })

    lifecycle.showWindow()

    expect(show).toHaveBeenCalledOnce()
    expect(focus).toHaveBeenCalledOnce()
  })

  it('recreates a destroyed window without revealing a blank renderer early', () => {
    const destroyed = fakeWindow({ isDestroyed: vi.fn(() => true) })
    const show = vi.fn()
    const focus = vi.fn()
    const replacement = fakeWindow({ show, focus })
    const createWindow = vi.fn(() => replacement)
    const lifecycle = createDesktopWindowLifecycle({
      getWindow: () => destroyed,
      createWindow,
      isQuitting: () => false,
    })

    lifecycle.showWindow()

    expect(createWindow).toHaveBeenCalledOnce()
    expect(show).not.toHaveBeenCalled()
    expect(focus).not.toHaveBeenCalled()
  })
})
