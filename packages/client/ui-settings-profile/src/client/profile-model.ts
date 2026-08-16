/** Browser-local profile draft model and strict canonicalization. */

export const PROFILE_FIELD_KEYS = [
  'preferredName', 'role', 'organization', 'region', 'industry', 'workFocus', 'topGoal',
  'preferredLanguage', 'timezone', 'responseStyle', 'websiteUrl', 'xHandle', 'linkedinUrl',
  'githubHandle', 'douyinUrl', 'xiaohongshuUrl', 'wechatOfficialAccount',
] as const

/** Stable key for one user-editable public profile field. */
export type ProfileFieldKey = typeof PROFILE_FIELD_KEYS[number]
/** Form section used to group related profile fields. */
export type ProfileGroup = 'identity' | 'work' | 'preferences' | 'social'
/** Closed response-format preference accepted by the Host. */
export type ResponseStyle = 'concise' | 'detailed' | 'action-first'

/** One controlled form value and its independent Agent-visibility consent. */
export interface ProfileFieldValue {
  /** Canonical public value, or an empty string in an unsaved draft. */
  value: string
  /** Whether supported local Agents may receive this field. */
  agentVisible: boolean
}

/** Sparse profile snapshot returned by the Host settings namespace. */
export type ProfileValue = Partial<Record<ProfileFieldKey, ProfileFieldValue>>
/** Complete controlled-form draft containing every profile key. */
export type EditableProfile = Record<ProfileFieldKey, ProfileFieldValue>

/** Presentation and validation metadata for one profile field. */
export interface ProfileFieldDefinition {
  /** Stable field key used by the Host schema. */
  key: ProfileFieldKey
  /** Form section containing the field. */
  group: ProfileGroup
  /** Input control kind. */
  kind: 'text' | 'url' | 'select'
  /** Maximum Unicode code-point count accepted in the draft. */
  maxLength: number
}

/** Profile definitions in stable onboarding and settings-page order. */
export const PROFILE_FIELDS: readonly ProfileFieldDefinition[] = [
  { key: 'preferredName', group: 'identity', kind: 'text', maxLength: 80 },
  { key: 'role', group: 'identity', kind: 'text', maxLength: 100 },
  { key: 'organization', group: 'identity', kind: 'text', maxLength: 120 },
  { key: 'region', group: 'identity', kind: 'text', maxLength: 120 },
  { key: 'industry', group: 'work', kind: 'text', maxLength: 120 },
  { key: 'workFocus', group: 'work', kind: 'text', maxLength: 160 },
  { key: 'topGoal', group: 'work', kind: 'text', maxLength: 200 },
  { key: 'preferredLanguage', group: 'preferences', kind: 'text', maxLength: 80 },
  { key: 'timezone', group: 'preferences', kind: 'text', maxLength: 80 },
  { key: 'responseStyle', group: 'preferences', kind: 'select', maxLength: 12 },
  { key: 'websiteUrl', group: 'social', kind: 'url', maxLength: 300 },
  { key: 'xHandle', group: 'social', kind: 'text', maxLength: 300 },
  { key: 'linkedinUrl', group: 'social', kind: 'url', maxLength: 300 },
  { key: 'githubHandle', group: 'social', kind: 'text', maxLength: 300 },
  { key: 'douyinUrl', group: 'social', kind: 'url', maxLength: 300 },
  { key: 'xiaohongshuUrl', group: 'social', kind: 'url', maxLength: 300 },
  { key: 'wechatOfficialAccount', group: 'social', kind: 'text', maxLength: 20 },
]

/**
 * Produce a complete controlled form draft without mutating the snapshot.
 * @param value - Sparse Host profile snapshot.
 * @returns Complete editable draft with hidden, empty defaults.
 */
export function editableProfile(value: ProfileValue): EditableProfile {
  return Object.fromEntries(PROFILE_FIELD_KEYS.map(key => [
    key,
    { value: value[key]?.value ?? '', agentVisible: value[key]?.agentVisible ?? false },
  ])) as EditableProfile
}

function publicUrl(value: string, hosts: readonly string[], path: RegExp): string | undefined {
  let url: URL
  try { url = new URL(value) } catch { return undefined }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.port !== ''
    || url.search !== '' || url.hash !== '' || !hosts.includes(url.hostname) || !path.test(url.pathname)) return undefined
  return url.toString()
}

function handleFrom(value: string, hosts: readonly string[], pattern: RegExp): string | undefined {
  const direct = value.startsWith('@') ? value.slice(1) : value
  if (pattern.test(direct)) return direct
  const url = publicUrl(value, hosts, /^\/[A-Za-z0-9_-]+\/?$/u)
  if (url === undefined) return undefined
  const handle = new URL(url).pathname.split('/').filter(Boolean)[0]
  return handle !== undefined && pattern.test(handle) ? handle : undefined
}

/**
 * Canonicalize a user draft exactly as the Host expects.
 * @param key - Field whose canonical format is required.
 * @param raw - User-entered draft value.
 * @returns Canonical public value, an empty string for clearing, or `undefined` when invalid.
 */
export function canonicalProfileValue(key: ProfileFieldKey, raw: string): string | undefined {
  const value = raw.trim()
  if (value === '') return ''
  if (/[\u0000-\u001f\u007f-\u009f]/u.test(value)) return undefined
  const definition = PROFILE_FIELDS.find(candidate => candidate.key === key)
  if (definition === undefined || Array.from(value).length > definition.maxLength) return undefined
  if (key === 'xHandle') return handleFrom(value, ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'], /^[A-Za-z0-9_]{1,15}$/u)
  if (key === 'githubHandle') return handleFrom(value, ['github.com', 'www.github.com'], /^(?!-)(?!.*--)[A-Za-z0-9-]{1,39}(?<!-)$/u)
  if (key === 'websiteUrl') {
    let host: string
    try { host = new URL(value).hostname } catch { return undefined }
    return publicUrl(value, [host], /^\/$/u)
  }
  if (key === 'linkedinUrl') return publicUrl(value, ['linkedin.com', 'www.linkedin.com'], /^\/in\/[A-Za-z0-9-]{3,100}\/?$/u)
  if (key === 'douyinUrl') return publicUrl(value, ['www.douyin.com'], /^\/user\/[A-Za-z0-9_-]{6,160}\/?$/u)
  if (key === 'xiaohongshuUrl') return publicUrl(value, ['www.xiaohongshu.com'], /^\/user\/profile\/[A-Za-z0-9_-]{6,160}\/?$/u)
  if (key === 'wechatOfficialAccount') return /^[A-Za-z][A-Za-z0-9_-]{5,19}$/u.test(value) ? value : undefined
  if (key === 'responseStyle') return ['concise', 'detailed', 'action-first'].includes(value) ? value : undefined
  if (key === 'timezone') {
    if (!/^[A-Za-z0-9_+.-]+(?:\/[A-Za-z0-9_+.-]+)+$/u.test(value)) return undefined
    try { new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0) } catch { return undefined }
  }
  return value
}
