// @vitest-environment jsdom
/** AppearanceRow behavior: grouped modes and skins, accessible selection,
 * palette-only previews, and restore-default routing. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createSnapshotStore, type SessionListState, type WorkspaceListState } from '@deepseek-ai/dsh-client-runtime/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { AppearanceRow } from '../src/client/AppearanceRow.tsx'
import type { AppearanceRowComponentProps } from '../src/client/AppearanceRow.tsx'
import { createAppearanceRowStore } from '../src/client/settings-store.ts'
import type { ThemePreference } from '../src/client/index.ts'

afterEach(cleanup)

const COPY: Record<string, string> = {
  'appearance.title': 'Appearance',
  'appearance.modeTitle': 'Display mode',
  'appearance.light': 'Light',
  'appearance.dark': 'Dark',
  'appearance.system': 'System',
  'appearance.skinTitle': 'Built-in skins',
  'appearance.deepSea': 'Deep Sea Blue',
  'appearance.auroraNight': 'Aurora Night',
  'appearance.warmPaper': 'Warm Paper',
  'appearance.darkSkin': 'Dark',
  'appearance.lightSkin': 'Light',
  'appearance.palette': 'Palette',
  'appearance.restoreDefault': 'Restore default',
}

/** Empty global standard-kit hooks (the row reads neither). */
function emptySessions() {
  const store = createSnapshotStore<SessionListState>(
    { ids: [], byId: {}, current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined })
  return bindSnapshotSelector(store)
}
function emptyWorkspaces() {
  const store = createSnapshotStore<WorkspaceListState>({
    items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
    baselinesReady: true, recentWorkspaceId: undefined,
  })
  return bindSnapshotSelector(store)
}

function mount(preference: ThemePreference = 'system') {
  // Real store instance — the sanctioned zero-machinery path for tests.
  const store = createAppearanceRowStore().create()
  store.actions.sync(preference, 0)
  const setTheme = vi.fn()
  const props: AppearanceRowComponentProps = {
    useSessions: emptySessions(),
    useWorkspaces: emptyWorkspaces(),
    useStore: bindSnapshotSelector(store),
    actions: store.actions,
    t: (key: string) => COPY[key] ?? key,
    setTheme,
  }
  render(<AppearanceRow {...props} />)
  return { store, setTheme }
}

const pressed = (name: RegExp): string | null =>
  screen.getByRole('button', { name }).getAttribute('aria-pressed')

describe('AppearanceRow', () => {
  it('renders separately labelled mode and skin groups with one persisted selection', () => {
    mount('aurora-night')
    expect(screen.getByText('Appearance')).toBeDefined()
    expect(screen.getByRole('group', { name: 'Display mode' })).toBeDefined()
    expect(screen.getByRole('group', { name: 'Built-in skins' })).toBeDefined()
    expect(pressed(/Aurora Night/)).toBe('true')
    expect(pressed(/^Light$/)).toBe('false')
    expect(pressed(/^Dark$/)).toBe('false')
    expect(pressed(/^System$/)).toBe('false')
    expect(screen.getAllByRole('button').filter(button => button.hasAttribute('aria-pressed'))).toHaveLength(6)
  })

  it('click drives setTheme; selection follows the store mirror, not the click echo', () => {
    const b = mount('dark')
    fireEvent.click(screen.getByRole('button', { name: /Deep Sea Blue/ }))
    expect(b.setTheme).toHaveBeenCalledWith('deep-sea')
    // No store write yet: selection is unchanged.
    expect(pressed(/^Dark$/)).toBe('true')
    act(() => { b.store.actions.sync('deep-sea', 1) })
    expect(pressed(/Deep Sea Blue/)).toBe('true')
    expect(pressed(/^Dark$/)).toBe('false')
  })

  it('uses honest palette swatches and restores the system default', () => {
    const b = mount('warm-paper')
    const skin = screen.getByRole('button', { name: /Warm Paper/ })
    expect(skin.textContent).toContain('Palette')
    const palette = skin.querySelector('[aria-hidden="true"]')
    expect(palette?.children).toHaveLength(4)
    expect(palette?.querySelector('img')).toBeNull()

    const restore = screen.getByRole('button', { name: 'Restore default' })
    expect(restore).not.toHaveProperty('disabled', true)
    fireEvent.click(restore)
    expect(b.setTheme).toHaveBeenLastCalledWith('system')

    cleanup()
    mount('system')
    expect(screen.getByRole('button', { name: 'Restore default' })).toHaveProperty('disabled', true)
  })
})
