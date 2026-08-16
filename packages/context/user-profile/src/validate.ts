/** Strict validation for public profile settings. */

import type {
  PublicProfileField, ResponseStyle, UserProfileFieldKey, UserProfileSettings,
} from './types.ts'

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/u
const SECRET_ASSIGNMENT = /(?:password|passwd|access[ _-]?token|secret|cookie|api[ _-]?key)\s*[:=]\s*(?:bearer\s+)?[^\s,;]{8,}/iu
const PROVIDER_TOKEN = /(?:sk-[a-z0-9_-]{12,}|gh[opsu]_[a-z0-9_]{12,}|github_pat_[a-z0-9_]{12,}|xox[abprs]-[a-z0-9-]{12,})/iu
const LONG_OPAQUE = /(?:^|\s)(?=[A-Za-z0-9+/_=-]{40,}(?:\s|$))(?=[^\s]*[A-Za-z])(?=[^\s]*\d)[A-Za-z0-9+/_=-]{40,}(?=\s|$)/u
const X_HANDLE = /^[A-Za-z0-9_]{1,15}$/u
const GITHUB_HANDLE = /^(?!-)(?!.*--)[A-Za-z0-9-]{1,39}(?<!-)$/u
const WECHAT_ID = /^[A-Za-z][A-Za-z0-9_-]{5,19}$/u
const RESPONSE_STYLES = new Set<ResponseStyle>(['concise', 'detailed', 'action-first'])

const TEXT_LIMITS: Partial<Record<UserProfileFieldKey, number>> = {
  preferredName: 80,
  role: 100,
  organization: 120,
  region: 120,
  industry: 120,
  workFocus: 160,
  topGoal: 200,
  preferredLanguage: 80,
}

/** Reject empty, noncanonical, multiline, control-bearing, or credential-shaped text. */
function validateText(field: string, value: string, maxLength: number): void {
  if (value.length === 0 || value !== value.trim()) {
    throw new TypeError(`user-profile: ${field} must be non-empty and trimmed`)
  }
  if (Array.from(value).length > maxLength) {
    throw new TypeError(`user-profile: ${field} exceeds ${String(maxLength)} characters`)
  }
  if (CONTROL.test(value)) {
    throw new TypeError(`user-profile: ${field} must be a single control-free line`)
  }
  if (SECRET_ASSIGNMENT.test(value) || PROVIDER_TOKEN.test(value) || LONG_OPAQUE.test(value)) {
    throw new TypeError(`user-profile: ${field} looks like a credential, not public profile data`)
  }
}

function parsePublicHttps(field: string, value: string): URL {
  validateText(field, value, 300)
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new TypeError(`user-profile: ${field} must be a valid HTTPS URL`)
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== ''
    || url.port !== '' || url.search !== '' || url.hash !== '') {
    throw new TypeError(`user-profile: ${field} must be a public HTTPS URL without credentials, port, query, or fragment`)
  }
  return url
}

function validateWebsite(value: string): void {
  const url = parsePublicHttps('websiteUrl', value)
  if (url.pathname !== '/') {
    throw new TypeError('user-profile: websiteUrl must be an HTTPS site origin')
  }
}

function validateLinkedIn(value: string): void {
  const url = parsePublicHttps('linkedinUrl', value)
  if (!/^(?:www\.)?linkedin\.com$/iu.test(url.hostname)
    || !/^\/in\/[A-Za-z0-9-]{3,100}\/?$/u.test(url.pathname)) {
    throw new TypeError('user-profile: linkedinUrl must be a public LinkedIn /in/ profile URL')
  }
}

function validateDouyin(value: string): void {
  const url = parsePublicHttps('douyinUrl', value)
  if (url.hostname !== 'www.douyin.com' || !/^\/user\/[A-Za-z0-9_-]{6,160}\/?$/u.test(url.pathname)) {
    throw new TypeError('user-profile: douyinUrl must be a public douyin.com/user profile URL')
  }
}

function validateXiaohongshu(value: string): void {
  const url = parsePublicHttps('xiaohongshuUrl', value)
  if (url.hostname !== 'www.xiaohongshu.com'
    || !/^\/user\/profile\/[A-Za-z0-9_-]{6,160}\/?$/u.test(url.pathname)) {
    throw new TypeError('user-profile: xiaohongshuUrl must be a public xiaohongshu.com/user/profile URL')
  }
}

function validateTimezone(value: string): void {
  validateText('timezone', value, 80)
  if (!/^[A-Za-z0-9_+.-]+(?:\/[A-Za-z0-9_+.-]+)+$/u.test(value)) {
    throw new TypeError('user-profile: timezone must be an IANA area/location name')
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0)
  } catch {
    throw new TypeError('user-profile: timezone must be a valid IANA time zone')
  }
}

function valueOf(settings: UserProfileSettings, key: UserProfileFieldKey): string | undefined {
  return settings[key]?.value
}

/**
 * Validate the schema-resolved profile before it can be persisted or exposed.
 * @param settings - Schema-resolved profile settings proposed for persistence.
 */
export function validateUserProfileSettings(settings: UserProfileSettings): void {
  for (const [key, max] of Object.entries(TEXT_LIMITS) as Array<[UserProfileFieldKey, number]>) {
    const value = valueOf(settings, key)
    if (value !== undefined) validateText(key, value, max)
  }
  const timezone = valueOf(settings, 'timezone')
  if (timezone !== undefined) validateTimezone(timezone)
  const responseStyle = valueOf(settings, 'responseStyle')
  if (responseStyle !== undefined && !RESPONSE_STYLES.has(responseStyle as ResponseStyle)) {
    throw new TypeError('user-profile: responseStyle is not supported')
  }
  const website = valueOf(settings, 'websiteUrl')
  if (website !== undefined) validateWebsite(website)
  const x = valueOf(settings, 'xHandle')
  if (x !== undefined && !X_HANDLE.test(x)) {
    throw new TypeError('user-profile: xHandle must be a canonical public X handle without @')
  }
  const linkedIn = valueOf(settings, 'linkedinUrl')
  if (linkedIn !== undefined) validateLinkedIn(linkedIn)
  const github = valueOf(settings, 'githubHandle')
  if (github !== undefined && !GITHUB_HANDLE.test(github)) {
    throw new TypeError('user-profile: githubHandle must be a canonical public GitHub handle')
  }
  const douyin = valueOf(settings, 'douyinUrl')
  if (douyin !== undefined) validateDouyin(douyin)
  const xiaohongshu = valueOf(settings, 'xiaohongshuUrl')
  if (xiaohongshu !== undefined) validateXiaohongshu(xiaohongshu)
  const wechat = valueOf(settings, 'wechatOfficialAccount')
  if (wechat !== undefined && !WECHAT_ID.test(wechat)) {
    throw new TypeError('user-profile: wechatOfficialAccount must be a public WeChat official account ID')
  }
}

/**
 * Read a field only when the user explicitly made it visible to supported Agents.
 * @param field - Optional profile field and its independent consent flag.
 * @returns Public value when consented, otherwise `undefined`.
 */
export function visibleValue(field: PublicProfileField | undefined): string | undefined {
  return field?.agentVisible === true ? field.value : undefined
}
