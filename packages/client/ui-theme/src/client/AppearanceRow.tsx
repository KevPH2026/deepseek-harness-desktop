/**
 * Appearance preference row registered into the General section item slot:
 * base display modes plus a product-owned skin gallery. Registered by this
 * package — the theme feature owns its own settings surface. Selection follows
 * the persisted preference, never the resolved active theme.
 */
import type { CSSProperties } from 'react'
import clsx from 'clsx'
import {
  IconDarkOutline16, IconFollowsystemOutline16, IconLightOutline16, IconRefreshOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { getBuiltinSkin } from '../builtin-themes.ts'
import {
  BUILTIN_SKIN_PREFERENCES, type BuiltinSkinPreference, type DisplayThemePreference,
  type ThemePreference,
} from '../theme-settings.ts'
import type { ThemeKey } from './locales.ts'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { createAppearanceRowStore } from './settings-store.ts'
import css from './AppearanceRow.module.css'

/** Injected business face: the preference write (t rides the standard locale seat). */
export interface AppearanceRowInjected {
  /** Switch the theme preference. */
  setTheme: (id: ThemePreference) => void
}

/** Full component props: runtime share + store share + locale seat + injected face. */
export type AppearanceRowComponentProps =
  PropsRuntime<'settings.general.item'> & PropsStore<ReturnType<typeof createAppearanceRowStore>>
  & PropsLocale<'settings.theme'> & AppearanceRowInjected

/** Display-mode order and icons. */
const MODES: readonly { id: DisplayThemePreference; labelKey: ThemeKey; Icon: typeof IconLightOutline16 }[] = [
  { id: 'light', labelKey: 'appearance.light', Icon: IconLightOutline16 },
  { id: 'dark', labelKey: 'appearance.dark', Icon: IconDarkOutline16 },
  { id: 'system', labelKey: 'appearance.system', Icon: IconFollowsystemOutline16 },
]

const SKIN_COPY: Record<BuiltinSkinPreference, { labelKey: ThemeKey; schemeKey: ThemeKey }> = {
  'deep-sea': { labelKey: 'appearance.deepSea', schemeKey: 'appearance.darkSkin' },
  'aurora-night': { labelKey: 'appearance.auroraNight', schemeKey: 'appearance.darkSkin' },
  'warm-paper': { labelKey: 'appearance.warmPaper', schemeKey: 'appearance.lightSkin' },
}

interface SkinPreviewStyle extends CSSProperties {
  '--skin-preview-bg': string
  '--skin-preview-surface': string
  '--skin-preview-accent': string
  '--skin-preview-text': string
}

function skinToken(tokens: Readonly<Record<string, string>>, name: string): string {
  const value = tokens[name]
  /* v8 ignore next -- built-in completeness is sealed by builtin-skins.client.spec.ts */
  if (value === undefined) throw new Error(`built-in skin lost token "${name}"`)
  return value
}

function skinPreviewStyle(id: BuiltinSkinPreference): SkinPreviewStyle {
  const { tokens } = getBuiltinSkin(id)
  return {
    '--skin-preview-bg': skinToken(tokens, '--dsw-alias-bg-base'),
    '--skin-preview-surface': skinToken(tokens, '--dsw-alias-bg-layer-2'),
    '--skin-preview-accent': skinToken(tokens, '--dsw-alias-brand-primary'),
    '--skin-preview-text': skinToken(tokens, '--dsw-alias-label-primary'),
  }
}

/**
 * Render the Appearance row.
 * @param props - composed slot props.
 * @returns the row element tree.
 */
export function AppearanceRow({ t, setTheme, useStore }: AppearanceRowComponentProps) {
  const preference = useStore(s => s.preference)
  return (
    <div className={css.group}>
      <div className={css.header}>
        <div className={css.title}>{t('appearance.title')}</div>
        <button
          type="button"
          className={css.restoreButton}
          disabled={preference === 'system'}
          onClick={() => { setTheme('system') }}
        >
          <span aria-hidden="true"><IconRefreshOutline16 /></span>
          {t('appearance.restoreDefault')}
        </button>
      </div>

      <div className={css.section}>
        <div className={css.sectionTitle}>{t('appearance.modeTitle')}</div>
        <div className={css.modeRow} role="group" aria-label={t('appearance.modeTitle')}>
          {MODES.map(({ id, labelKey, Icon }) => (
            <button
              key={id}
              type="button"
              className={clsx(css.modeButton, preference === id && css.selected)}
              aria-pressed={preference === id}
              onClick={() => { setTheme(id) }}
            >
              <Icon />
              {t(labelKey)}
            </button>
          ))}
        </div>
      </div>

      <div className={css.section}>
        <div className={css.sectionTitle}>{t('appearance.skinTitle')}</div>
        <div className={css.skinGrid} role="group" aria-label={t('appearance.skinTitle')}>
          {BUILTIN_SKIN_PREFERENCES.map((id) => {
            const copy = SKIN_COPY[id]
            return (
              <button
                key={id}
                type="button"
                className={clsx(css.skinCard, preference === id && css.selected)}
                aria-pressed={preference === id}
                onClick={() => { setTheme(id) }}
              >
                <span className={css.palettePreview} style={skinPreviewStyle(id)} aria-hidden="true">
                  <span className={css.paletteSwatchBase} />
                  <span className={css.paletteSwatchSurface} />
                  <span className={css.paletteSwatchAccent} />
                  <span className={css.paletteSwatchText} />
                </span>
                <span className={css.skinCopy}>
                  <span className={css.skinName}>{t(copy.labelKey)}</span>
                  <span className={css.skinScheme}>{t(copy.schemeKey)}</span>
                </span>
                <span className={css.paletteLabel}>{t('appearance.palette')}</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
