// @vitest-environment jsdom
/** Host index injection and the resulting pre-plugin browser theme. */
import { runInNewContext } from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { injectBootTheme } from '../src/boot-theme.ts'
import { BUILTIN_SKINS, BUILTIN_SKIN_TOKEN_NAMES } from '../src/builtin-themes.ts'
import { THEME_BOOTSTRAP_ATTRIBUTE, type ThemePreference } from '../src/theme-settings.ts'

const DARK_ATTRIBUTE = 'data-ds-dark-theme'

function mockSystemDark(matches: boolean): void {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches }) as MediaQueryList))
}

function executeBootstrap(
  preference?: ThemePreference,
  html = '<html><body><div id="root"></div><script type="module"></script></body></html>',
): string {
  const injected = injectBootTheme(html, preference)
  const source = /<script>([\s\S]*?)<\/script>/.exec(injected)?.[1]
  if (source === undefined) throw new Error('theme bootstrap script missing')
  runInNewContext(source, { document, matchMedia: globalThis.matchMedia })
  return injected
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.documentElement.style.removeProperty('color-scheme')
  document.documentElement.removeAttribute(THEME_BOOTSTRAP_ATTRIBUTE)
  document.body.removeAttribute(DARK_ATTRIBUTE)
  for (const name of BUILTIN_SKIN_TOKEN_NAMES) document.body.style.removeProperty(name)
})

describe('theme boot index transform', () => {
  it('runs immediately inside the body before the shell mount', () => {
    mockSystemDark(false)
    const html = executeBootstrap('dark', '<html><body class="app"><div id="root"></div></body></html>')
    expect(html.indexOf('<script>')).toBeGreaterThan(html.indexOf('<body class="app">'))
    expect(html.indexOf('<script>')).toBeLessThan(html.indexOf('<div id="root">'))
    expect(document.documentElement.style.colorScheme).toBe('dark')
    expect(document.documentElement.getAttribute(THEME_BOOTSTRAP_ATTRIBUTE)).toBe('dark')
    expect(document.body.hasAttribute(DARK_ATTRIBUTE)).toBe(true)
  })

  it('lets durable light override a dark OS and clears stale dark state', () => {
    document.body.setAttribute(DARK_ATTRIBUTE, '')
    mockSystemDark(true)
    executeBootstrap('light')
    expect(document.documentElement.style.colorScheme).toBe('light')
    expect(document.body.hasAttribute(DARK_ATTRIBUTE)).toBe(false)
  })

  it.each(BUILTIN_SKINS)('applies $id color scheme and every skin token before mount', (skin) => {
    mockSystemDark(skin.colorScheme !== 'dark')
    const html = executeBootstrap(skin.id)
    expect(document.documentElement.getAttribute(THEME_BOOTSTRAP_ATTRIBUTE)).toBe(skin.id)
    expect(document.documentElement.style.colorScheme).toBe(skin.colorScheme)
    expect(document.body.hasAttribute(DARK_ATTRIBUTE)).toBe(skin.colorScheme === 'dark')
    for (const [name, value] of Object.entries(skin.tokens)) {
      expect(document.body.style.getPropertyValue(name)).toBe(value)
    }
    expect(html.indexOf('style.setProperty')).toBeLessThan(html.indexOf('<div id="root">'))
  })

  it.each([
    [true, 'dark', true],
    [false, 'light', false],
  ] as const)('resolves system=%s to %s', (matches, colorScheme, dark) => {
    mockSystemDark(matches)
    executeBootstrap('system')
    expect(document.documentElement.style.colorScheme).toBe(colorScheme)
    expect(document.body.hasAttribute(DARK_ATTRIBUTE)).toBe(dark)
  })

  it('defaults to system and falls back to light when matchMedia is unavailable', () => {
    vi.stubGlobal('matchMedia', undefined)
    executeBootstrap()
    expect(document.documentElement.style.colorScheme).toBe('light')
    expect(document.body.hasAttribute(DARK_ATTRIBUTE)).toBe(false)
  })

  it('appends the script to a body-less fragment', () => {
    const html = injectBootTheme('<main>loading</main>', 'dark')
    expect(html.startsWith('<main>loading</main><script>')).toBe(true)
  })
})
