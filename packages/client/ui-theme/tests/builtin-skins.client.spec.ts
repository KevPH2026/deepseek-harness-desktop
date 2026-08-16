/** Product skin integrity: stable ids, complete semantic token sets, no asset
 * escape hatches, and readable core text/accent pairs. */
import { describe, expect, it } from 'vitest'
import {
  BUILTIN_SKINS, BUILTIN_SKIN_TOKEN_NAMES,
} from '../src/builtin-themes.ts'

function relativeLuminance(hex: string): number {
  const channels = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (channels === null) throw new Error(`expected six-digit hex color, received ${hex}`)
  const linear = channels.slice(1).map((channel) => {
    const value = Number.parseInt(channel, 16) / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  const [red, green, blue] = linear
  if (red === undefined || green === undefined || blue === undefined) {
    throw new Error(`expected three color channels, received ${hex}`)
  }
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function contrastRatio(left: string, right: string): number {
  const first = relativeLuminance(left)
  const second = relativeLuminance(right)
  const lighter = Math.max(first, second)
  const darker = Math.min(first, second)
  return (lighter + 0.05) / (darker + 0.05)
}

function requiredToken(tokens: Readonly<Record<string, string>>, name: string): string {
  const value = tokens[name]
  if (value === undefined) throw new Error(`skin is missing ${name}`)
  return value
}

describe('built-in product skins', () => {
  it('ships the three original palettes in stable gallery order', () => {
    expect(BUILTIN_SKINS.map(skin => [skin.id, skin.colorScheme])).toEqual([
      ['deep-sea', 'dark'],
      ['aurora-night', 'dark'],
      ['warm-paper', 'light'],
    ])
  })

  it.each(BUILTIN_SKINS)('$id supplies every required semantic token exactly once', (skin) => {
    expect(Object.keys(skin.tokens).sort()).toEqual([...BUILTIN_SKIN_TOKEN_NAMES].sort())
    expect(Object.values(skin.tokens).every(value => value.trim().length > 0)).toBe(true)
  })

  it.each(BUILTIN_SKINS)('$id stays code-only with no remote, font, image, or DOM payload', (skin) => {
    const serialized = JSON.stringify(skin.tokens).toLowerCase()
    expect(serialized).not.toMatch(/url\s*\(|@import|https?:|data:|font-family|<\/?(?:script|style|img|svg)/)
    expect(Object.values(skin.tokens).every(value => /^(?:#[0-9a-f]{6}|rgba?\([^()]+\))$/i.test(value))).toBe(true)
  })

  it.each(BUILTIN_SKINS)('$id keeps core foreground pairs at readable WCAG contrast', (skin) => {
    const tokens = skin.tokens
    const base = requiredToken(tokens, '--dsw-alias-bg-base')
    const primary = requiredToken(tokens, '--dsw-alias-label-primary')
    const secondary = requiredToken(tokens, '--dsw-alias-label-secondary')
    const brand = requiredToken(tokens, '--dsw-alias-brand-primary')
    const foreground = requiredToken(tokens, '--dsw-alias-label-primary-foreground')
    expect(contrastRatio(primary, base)).toBeGreaterThanOrEqual(7)
    expect(contrastRatio(secondary, base)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(brand, base)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(foreground, brand)).toBeGreaterThanOrEqual(4.5)
  })

  it.each(BUILTIN_SKINS)('$id keeps tertiary copy readable on base and layer-3 surfaces', (skin) => {
    const tokens = skin.tokens
    const tertiary = requiredToken(tokens, '--dsw-alias-label-tertiary')
    const base = requiredToken(tokens, '--dsw-alias-bg-base')
    const layer3 = requiredToken(tokens, '--dsw-alias-bg-layer-3')
    expect(contrastRatio(tertiary, base)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(tertiary, layer3)).toBeGreaterThanOrEqual(4.5)
  })
})
