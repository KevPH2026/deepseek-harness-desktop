/** Product-owned, code-only theme definitions shared by Host bootstrap and Client runtime. */

import type { BuiltinSkinPreference, ThemePreference } from './theme-settings.ts'

type ConcreteThemePreference = Exclude<ThemePreference, 'system'>
type ColorScheme = 'light' | 'dark'

interface BuiltinThemeDefinition {
  readonly id: ConcreteThemePreference
  readonly colorScheme: ColorScheme
  readonly tokens: Readonly<Record<string, string>>
}

interface SkinPalette {
  readonly base: string
  readonly layer1: string
  readonly layer2: string
  readonly layer3: string
  readonly overlay: string
  readonly module: string
  readonly border1: string
  readonly border2: string
  readonly border3: string
  readonly border4: string
  readonly brand: string
  readonly brandHover: string
  readonly foreground: string
  readonly textPrimary: string
  readonly textSecondary: string
  readonly textTertiary: string
  readonly textDimmed: string
  readonly interactiveHover: string
  readonly interactiveActive: string
  readonly interactiveSolid: string
  readonly code: string
  readonly codeStrong: string
  readonly bubble: string
  readonly bubbleAccent: string
  readonly sidebar: string
  readonly sidebarHover: string
  readonly sidebarActive: string
  readonly scrollbar: string
  readonly scrollbarHover: string
}

/** Semantic variables every product-owned skin supplies as one complete surface set. */
export const BUILTIN_SKIN_TOKEN_NAMES = Object.freeze([
  '--dsw-alias-bg-base',
  '--dsw-alias-bg-layer-1',
  '--dsw-alias-bg-layer-2',
  '--dsw-alias-bg-layer-3',
  '--dsw-alias-bg-module-platform',
  '--dsw-alias-bg-multi-select',
  '--dsw-alias-bg-overlay',
  '--dsw-alias-border-l1',
  '--dsw-alias-border-l2-darkmode-thin',
  '--dsw-alias-border-l2',
  '--dsw-alias-border-l3',
  '--dsw-alias-border-l4',
  '--dsw-alias-brand-primary-invert',
  '--dsw-alias-brand-primary-new-colorprimary-new-color',
  '--dsw-alias-brand-primary',
  '--dsw-alias-brand-text',
  '--dsw-alias-button-elevated-fill',
  '--dsw-alias-button-floating-fill',
  '--dsw-alias-button-floating-hover',
  '--dsw-alias-button-info-fill',
  '--dsw-alias-button-info-hover',
  '--dsw-alias-button-primary-dimmed',
  '--dsw-alias-button-primary-hover',
  '--dsw-alias-interactive-bg-active',
  '--dsw-alias-interactive-bg-hover-accent',
  '--dsw-alias-interactive-bg-hover-solid',
  '--dsw-alias-interactive-bg-hover',
  '--dsw-alias-label-caption',
  '--dsw-alias-label-dimmed',
  '--dsw-alias-label-primary-bluish',
  '--dsw-alias-label-primary-dimmed',
  '--dsw-alias-label-primary-foreground',
  '--dsw-alias-label-primary-inverted',
  '--dsw-alias-label-primary',
  '--dsw-alias-label-secondary',
  '--dsw-alias-label-tertiary',
  '--dsw-alias-markdown-citation',
  '--dsw-alias-markdown-code-block-banner',
  '--dsw-alias-markdown-code-block',
  '--dsw-alias-markdown-code-segment-selected',
  '--dsw-alias-markdown-code-segment-unselected',
  '--dsw-alias-markdown-inline-code',
  '--dsw-alias-markdown-placeholder',
  '--dsw-alias-markdown-tag',
  '--dsw-alias-scrollbar-bg-l1',
  '--dsw-alias-scrollbar-bg-l2',
  '--dsw-alias-scrollbar-hover-l1',
  '--dsw-alias-scrollbar-hover-l2',
  '--dsw-alias-state-business-primary',
  '--dsw-alias-state-business-tertiary',
  '--dsw-alias-toast-bg',
  '--dsw-alias-tooltip-bg',
  '--dsw-specific-bubble-highlight',
  '--dsw-specific-bubble',
  '--dsw-specific-input-major',
  '--dsw-specific-login-input',
  '--dsw-specific-menu',
  '--dsw-specific-selector',
  '--dsw-specific-sidebar-fill',
  '--dsw-specific-sidebar-nav-item-active-accent',
  '--dsw-specific-sidebar-nav-item-active',
  '--dsw-specific-sidebar-nav-item-hover',
  '--dsw-specific-tip',
] as const)

type BuiltinSkinTokenName = typeof BUILTIN_SKIN_TOKEN_NAMES[number]

function makeSkinTokens(palette: SkinPalette): Readonly<Record<BuiltinSkinTokenName, string>> {
  return Object.freeze({
    '--dsw-alias-bg-base': palette.base,
    '--dsw-alias-bg-layer-1': palette.layer1,
    '--dsw-alias-bg-layer-2': palette.layer2,
    '--dsw-alias-bg-layer-3': palette.layer3,
    '--dsw-alias-bg-module-platform': palette.module,
    '--dsw-alias-bg-multi-select': palette.module,
    '--dsw-alias-bg-overlay': palette.overlay,
    '--dsw-alias-border-l1': palette.border1,
    '--dsw-alias-border-l2-darkmode-thin': palette.border1,
    '--dsw-alias-border-l2': palette.border2,
    '--dsw-alias-border-l3': palette.border3,
    '--dsw-alias-border-l4': palette.border4,
    '--dsw-alias-brand-primary-invert': palette.base,
    '--dsw-alias-brand-primary-new-colorprimary-new-color': palette.brand,
    '--dsw-alias-brand-primary': palette.brand,
    '--dsw-alias-brand-text': palette.brand,
    '--dsw-alias-button-elevated-fill': palette.layer2,
    '--dsw-alias-button-floating-fill': palette.layer3,
    '--dsw-alias-button-floating-hover': palette.interactiveSolid,
    '--dsw-alias-button-info-fill': palette.brand,
    '--dsw-alias-button-info-hover': palette.brandHover,
    '--dsw-alias-button-primary-dimmed': palette.module,
    '--dsw-alias-button-primary-hover': palette.brandHover,
    '--dsw-alias-interactive-bg-active': palette.interactiveActive,
    '--dsw-alias-interactive-bg-hover-accent': palette.interactiveActive,
    '--dsw-alias-interactive-bg-hover-solid': palette.interactiveSolid,
    '--dsw-alias-interactive-bg-hover': palette.interactiveHover,
    '--dsw-alias-label-caption': palette.textTertiary,
    '--dsw-alias-label-dimmed': palette.textDimmed,
    '--dsw-alias-label-primary-bluish': palette.brand,
    '--dsw-alias-label-primary-dimmed': palette.textSecondary,
    '--dsw-alias-label-primary-foreground': palette.foreground,
    '--dsw-alias-label-primary-inverted': palette.foreground,
    '--dsw-alias-label-primary': palette.textPrimary,
    '--dsw-alias-label-secondary': palette.textSecondary,
    '--dsw-alias-label-tertiary': palette.textTertiary,
    '--dsw-alias-markdown-citation': palette.module,
    '--dsw-alias-markdown-code-block-banner': palette.codeStrong,
    '--dsw-alias-markdown-code-block': palette.code,
    '--dsw-alias-markdown-code-segment-selected': palette.layer2,
    '--dsw-alias-markdown-code-segment-unselected': palette.codeStrong,
    '--dsw-alias-markdown-inline-code': palette.codeStrong,
    '--dsw-alias-markdown-placeholder': palette.module,
    '--dsw-alias-markdown-tag': palette.module,
    '--dsw-alias-scrollbar-bg-l1': palette.scrollbar,
    '--dsw-alias-scrollbar-bg-l2': palette.scrollbar,
    '--dsw-alias-scrollbar-hover-l1': palette.scrollbarHover,
    '--dsw-alias-scrollbar-hover-l2': palette.scrollbarHover,
    '--dsw-alias-state-business-primary': palette.brand,
    '--dsw-alias-state-business-tertiary': palette.bubbleAccent,
    '--dsw-alias-toast-bg': palette.layer3,
    '--dsw-alias-tooltip-bg': palette.layer3,
    '--dsw-specific-bubble-highlight': palette.bubbleAccent,
    '--dsw-specific-bubble': palette.bubble,
    '--dsw-specific-input-major': palette.layer2,
    '--dsw-specific-login-input': palette.layer1,
    '--dsw-specific-menu': palette.layer3,
    '--dsw-specific-selector': palette.module,
    '--dsw-specific-sidebar-fill': palette.sidebar,
    '--dsw-specific-sidebar-nav-item-active-accent': palette.bubbleAccent,
    '--dsw-specific-sidebar-nav-item-active': palette.sidebarActive,
    '--dsw-specific-sidebar-nav-item-hover': palette.sidebarHover,
    '--dsw-specific-tip': palette.module,
  })
}

const BASE_THEMES: readonly BuiltinThemeDefinition[] = Object.freeze([
  Object.freeze({ id: 'light', colorScheme: 'light' as const, tokens: Object.freeze({}) }),
  Object.freeze({ id: 'dark', colorScheme: 'dark' as const, tokens: Object.freeze({}) }),
])

/** Original product skins. They contain CSS token values only: no executable or remote assets. */
export const BUILTIN_SKINS: readonly BuiltinThemeDefinition[] = Object.freeze([
  Object.freeze({
    id: 'deep-sea',
    colorScheme: 'dark' as const,
    tokens: makeSkinTokens({
      base: '#071923', layer1: '#0D2530', layer2: '#12313D', layer3: '#193B48',
      overlay: '#214653', module: '#173744', border1: '#1C3E4B', border2: '#2B5361',
      border3: '#3B6674', border4: '#4D7A88', brand: '#55C7EE', brandHover: '#83D8F4',
      foreground: '#06202B', textPrimary: '#F1FAFD', textSecondary: '#BDD6DF',
      textTertiary: '#8EB0BC', textDimmed: '#6D929F', interactiveHover: 'rgba(141, 219, 243, 0.10)',
      interactiveActive: 'rgba(141, 219, 243, 0.18)', interactiveSolid: '#1C4654',
      code: '#091F2A', codeStrong: '#102E3A', bubble: '#102F3B', bubbleAccent: '#1D5262',
      sidebar: '#0A202B', sidebarHover: '#12323E', sidebarActive: '#183F4C',
      scrollbar: '#315866', scrollbarHover: '#477484',
    }),
  }),
  Object.freeze({
    id: 'aurora-night',
    colorScheme: 'dark' as const,
    tokens: makeSkinTokens({
      base: '#101624', layer1: '#171F31', layer2: '#1D2940', layer3: '#263650',
      overlay: '#2C3E5B', module: '#223149', border1: '#293A54', border2: '#3A506F',
      border3: '#4B6383', border4: '#607898', brand: '#70E1B8', brandHover: '#9CEBCF',
      foreground: '#0C241D', textPrimary: '#F4F7FF', textSecondary: '#C8D2E5',
      textTertiary: '#98A8C2', textDimmed: '#74859F', interactiveHover: 'rgba(127, 226, 190, 0.10)',
      interactiveActive: 'rgba(127, 226, 190, 0.18)', interactiveSolid: '#2B4058',
      code: '#121C2D', codeStrong: '#1A2840', bubble: '#18322F', bubbleAccent: '#28584E',
      sidebar: '#131C2D', sidebarHover: '#1D2A40', sidebarActive: '#263851',
      scrollbar: '#3A506D', scrollbarHover: '#526B8A',
    }),
  }),
  Object.freeze({
    id: 'warm-paper',
    colorScheme: 'light' as const,
    tokens: makeSkinTokens({
      base: '#F8F1E4', layer1: '#FFF9EE', layer2: '#F4E8D6', layer3: '#EEDFCB',
      overlay: '#FFFDF8', module: '#EFE2D0', border1: '#E4D5C1', border2: '#D4BFA3',
      border3: '#C2A98A', border4: '#AC8D6A', brand: '#A84F32', brandHover: '#873C25',
      foreground: '#FFF8EC', textPrimary: '#342920', textSecondary: '#675548',
      textTertiary: '#725E4E', textDimmed: '#9A8674', interactiveHover: 'rgba(116, 75, 43, 0.08)',
      interactiveActive: 'rgba(116, 75, 43, 0.14)', interactiveSolid: '#E9D8C1',
      code: '#F2E5D3', codeStrong: '#EAD8BF', bubble: '#F0DDC7', bubbleAccent: '#E0BFA1',
      sidebar: '#F1E3CF', sidebarHover: '#EAD8C0', sidebarActive: '#DFC5A7',
      scrollbar: '#C6AE91', scrollbarHover: '#A88C6A',
    }),
  }),
])

/** Base themes followed by product skins in stable settings-gallery order. */
export const BUILTIN_THEME_DEFINITIONS: readonly BuiltinThemeDefinition[] = Object.freeze([
  ...BASE_THEMES,
  ...BUILTIN_SKINS,
])

/**
 * Resolve one product skin without widening an untrusted string into a definition.
 * @param id - schema-validated product skin preference.
 * @returns the matching immutable product skin.
 */
export function getBuiltinSkin(id: BuiltinSkinPreference): BuiltinThemeDefinition {
  const skin = BUILTIN_SKINS.find(candidate => candidate.id === id)
  /* v8 ignore next -- the schema union and the frozen registry are declared together above */
  if (skin === undefined) throw new Error(`built-in skin registry lost "${id}"`)
  return skin
}
