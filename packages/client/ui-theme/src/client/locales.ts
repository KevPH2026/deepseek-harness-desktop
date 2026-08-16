/** `settings.theme` namespace dictionaries (the Appearance row's copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'appearance.title': '外观',
  'appearance.modeTitle': '显示模式',
  'appearance.light': '浅色',
  'appearance.dark': '深色',
  'appearance.system': '跟随系统',
  'appearance.skinTitle': '内置皮肤',
  'appearance.deepSea': '深海蓝',
  'appearance.auroraNight': '极光夜',
  'appearance.warmPaper': '暖纸',
  'appearance.darkSkin': '深色',
  'appearance.lightSkin': '浅色',
  'appearance.palette': '调色板',
  'appearance.restoreDefault': '恢复默认',
} satisfies Record<string, string>

/** The settings.theme namespace key union. */
export type ThemeKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
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
} satisfies Record<ThemeKey, string>
