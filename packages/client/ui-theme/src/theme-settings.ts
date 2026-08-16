/** Theme preferences stored in the Host user-settings document. */

import z from '@deepseek-ai/schemastery'

/** Base display modes shown separately from the product skin gallery. */
export const DISPLAY_THEME_PREFERENCES = ['light', 'dark', 'system'] as const

/** Product-owned skin ids accepted at the registry and settings boundaries. */
export const BUILTIN_SKIN_PREFERENCES = ['deep-sea', 'aurora-night', 'warm-paper'] as const

/** Built-in preferences accepted at the registry and settings boundaries. */
export const THEME_PREFERENCES = [
  ...DISPLAY_THEME_PREFERENCES,
  ...BUILTIN_SKIN_PREFERENCES,
] as const

/** Settings namespace owned by the theme plugin. */
export const THEME_SETTINGS_NAMESPACE = 'ui-theme'

/** Field carrying the selected built-in theme preference. */
export const THEME_PREFERENCE_FIELD = 'preference'

/** DOM handoff carrying the Host-rendered preference until Client settings hydrate. */
export const THEME_BOOTSTRAP_ATTRIBUTE = 'data-ds-theme-preference'

/** Theme preference persisted by the product Appearance row. */
export type ThemePreference = typeof THEME_PREFERENCES[number]

/** Base display-mode preference selected without a product skin. */
export type DisplayThemePreference = typeof DISPLAY_THEME_PREFERENCES[number]

/** Product-owned skin preference with a fixed light or dark color scheme. */
export type BuiltinSkinPreference = typeof BUILTIN_SKIN_PREFERENCES[number]

/** Default preference when the user-settings document has no override. */
export const DEFAULT_PREFERENCE: ThemePreference = 'system'

/** Durable theme section shared by the Host schema and the browser scope. */
export interface ThemeSettings {
  /** Selected built-in preference. */
  preference: ThemePreference
}

/** Durable theme schema; also the wire envelope the browser scope validates against. */
export const ThemeSettingsSchema: z<ThemeSettings> = z.object({
  [THEME_PREFERENCE_FIELD]: z.union([...THEME_PREFERENCES]).default(DEFAULT_PREFERENCE),
})

/**
 * Narrow one wire or registry value to a persistable preference.
 * @param value - value crossing the settings or registry boundary.
 * @returns whether the value is a built-in preference.
 */
export function isThemePreference(value: unknown): value is ThemePreference {
  return THEME_PREFERENCES.some(preference => preference === value)
}

/**
 * Narrow one built-in preference to a product skin id.
 * @param value - value already accepted or still crossing a wire boundary.
 * @returns whether the value selects a product-owned skin.
 */
export function isBuiltinSkinPreference(value: unknown): value is BuiltinSkinPreference {
  return BUILTIN_SKIN_PREFERENCES.some(preference => preference === value)
}
