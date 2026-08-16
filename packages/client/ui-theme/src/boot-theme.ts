/**
 * Host-rendered theme bootstrap for the browser's pre-plugin interval. Each
 * index response embeds the current durable built-in preference; the browser
 * resolves only `system`, then writes the same DOM fields ui-layout's
 * ThemePresenter owns after the client plugin tree activates.
 */

import { getBuiltinSkin } from './builtin-themes.ts'
import {
  DEFAULT_PREFERENCE, isBuiltinSkinPreference, THEME_BOOTSTRAP_ATTRIBUTE, type ThemePreference,
} from './theme-settings.ts'

/** Build the inline script for one schema-validated built-in preference. */
function bootThemeScript(preference: ThemePreference): string {
  const skin = isBuiltinSkinPreference(preference) ? getBuiltinSkin(preference) : undefined
  return `<script>(() => {
  const preference = ${JSON.stringify(preference)}
  const skin = ${JSON.stringify(skin)}
  const systemDark = preference === 'system'
    && typeof matchMedia !== 'undefined'
    && matchMedia('(prefers-color-scheme: dark)').matches
  const dark = skin?.colorScheme === 'dark' || preference === 'dark' || systemDark
  document.documentElement.setAttribute(${JSON.stringify(THEME_BOOTSTRAP_ATTRIBUTE)}, preference)
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  document.body.toggleAttribute('data-ds-dark-theme', dark)
  for (const [name, value] of Object.entries(skin?.tokens ?? {})) {
    document.body.style.setProperty(name, value)
  }
})()</script>`
}

/**
 * Insert the theme bootstrap immediately after the opening body tag, before
 * the shell mount and module script. Body-less fragments receive it at the
 * end, where the HTML parser has already synthesized a body.
 * @param html - Raw application index HTML.
 * @param preference - Current Host-backed built-in preference.
 * @returns HTML containing the theme bootstrap.
 */
export function injectBootTheme(
  html: string,
  preference: ThemePreference = DEFAULT_PREFERENCE,
): string {
  const script = bootThemeScript(preference)
  const body = /<body(?:\s[^>]*)?>/i.exec(html)
  if (body === null) return `${html}${script}`
  const at = body.index + body[0].length
  return `${html.slice(0, at)}${script}${html.slice(at)}`
}
