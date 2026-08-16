/** Public data types for the optional user profile. */

/** Closed response-format preference; arbitrary prompt text is not accepted. */
export type ResponseStyle = 'concise' | 'detailed' | 'action-first'

/** One optional profile value and its independent model-visibility consent. */
export interface PublicProfileField<T extends string = string> {
  /** Canonical public value. */
  value: T
  /** Whether supported local agents may receive this field. Defaults false. */
  agentVisible: boolean
}

/** Durable completion marker owned by the public-profile onboarding step. */
export interface PublicProfileOnboarding {
  /** Copy/schema generation understood by the current client. */
  version: 1
  /** Whether the user saved optional fields or deliberately skipped them. */
  state: 'completed' | 'skipped'
}

/** All profile fields are optional and independently clearable. */
export interface UserProfileSettings {
  preferredName?: PublicProfileField
  role?: PublicProfileField
  organization?: PublicProfileField
  region?: PublicProfileField
  industry?: PublicProfileField
  workFocus?: PublicProfileField
  topGoal?: PublicProfileField
  preferredLanguage?: PublicProfileField
  timezone?: PublicProfileField
  responseStyle?: PublicProfileField<ResponseStyle>
  websiteUrl?: PublicProfileField
  xHandle?: PublicProfileField
  linkedinUrl?: PublicProfileField
  githubHandle?: PublicProfileField
  douyinUrl?: PublicProfileField
  xiaohongshuUrl?: PublicProfileField
  wechatOfficialAccount?: PublicProfileField
  onboarding?: PublicProfileOnboarding
}

/** Every user-editable field in stable render and form order. */
export const USER_PROFILE_FIELD_KEYS = [
  'preferredName',
  'role',
  'organization',
  'region',
  'industry',
  'workFocus',
  'topGoal',
  'preferredLanguage',
  'timezone',
  'responseStyle',
  'websiteUrl',
  'xHandle',
  'linkedinUrl',
  'githubHandle',
  'douyinUrl',
  'xiaohongshuUrl',
  'wechatOfficialAccount',
] as const

/** One user-editable profile key. */
export type UserProfileFieldKey = typeof USER_PROFILE_FIELD_KEYS[number]
