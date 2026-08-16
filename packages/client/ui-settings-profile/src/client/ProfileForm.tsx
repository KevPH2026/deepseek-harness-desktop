/** Shared controlled form for onboarding and the Profile Settings page. */

import type { ProfileLocaleKey } from './locales.ts'
import {
  PROFILE_FIELDS, type EditableProfile, type ProfileFieldDefinition, type ProfileGroup,
} from './profile-model.ts'
import css from './ProfileSettings.module.css'

export interface ProfileFormProps {
  draft: EditableProfile
  disabled: boolean
  compactSocial?: boolean
  groups?: readonly ProfileGroup[]
  t: (key: ProfileLocaleKey) => string
  onChange: (draft: EditableProfile) => void
}

const GROUPS: Array<{ group: ProfileGroup; title: ProfileLocaleKey }> = [
  { group: 'identity', title: 'identityGroup' },
  { group: 'work', title: 'workGroup' },
  { group: 'preferences', title: 'preferencesGroup' },
  { group: 'social', title: 'socialGroup' },
]

function interpolate(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce(
    (current, [key, value]) => current.replaceAll(`{${key}}`, value),
    template,
  )
}

function localeKey(field: ProfileFieldDefinition, suffix: 'Label' | 'Placeholder'): ProfileLocaleKey {
  return `${field.key}${suffix}` as ProfileLocaleKey
}

function Fields({ fields, ...props }: ProfileFormProps & { fields: readonly ProfileFieldDefinition[] }) {
  return fields.map((field) => {
    const current = props.draft[field.key]
    const label = props.t(localeKey(field, 'Label'))
    const changeValue = (value: string): void => {
      props.onChange({
        ...props.draft,
        [field.key]: {
          value,
          agentVisible: value.trim() === '' ? false : current.agentVisible,
        },
      })
    }
    const control = field.kind === 'select'
      ? (
        <select
          id={`profile-${field.key}`}
          className={css.input}
          value={current.value}
          disabled={props.disabled}
          onChange={(event) => { changeValue(event.currentTarget.value) }}
        >
          <option value="">{props.t('responseStyleEmpty')}</option>
          <option value="concise">{props.t('responseStyleConcise')}</option>
          <option value="detailed">{props.t('responseStyleDetailed')}</option>
          <option value="action-first">{props.t('responseStyleActionFirst')}</option>
        </select>
      )
      : (
        <input
          id={`profile-${field.key}`}
          className={css.input}
          type={field.kind}
          value={current.value}
          maxLength={field.maxLength}
          placeholder={props.t(localeKey(field, 'Placeholder'))}
          disabled={props.disabled}
          autoComplete="off"
          onChange={(event) => { changeValue(event.currentTarget.value) }}
        />
      )
    return (
      <div className={css.field} key={field.key}>
        <label className={css.label} htmlFor={`profile-${field.key}`}>{label}</label>
        {control}
        <label className={css.consent}>
          <input
            type="checkbox"
            checked={current.agentVisible}
            disabled={props.disabled || current.value.trim() === ''}
            onChange={(event) => {
              props.onChange({
                ...props.draft,
                [field.key]: { ...current, agentVisible: event.currentTarget.checked },
              })
            }}
          />
          <span>{interpolate(props.t('agentVisibleLabel'), { field: label })}</span>
        </label>
      </div>
    )
  })
}

/** Render grouped optional fields with one independent visibility checkbox each. */
export function ProfileForm(props: ProfileFormProps) {
  return (
    <div className={css.formGroups}>
      {GROUPS.filter(({ group }) => props.groups === undefined || props.groups.includes(group)).map(({ group, title }) => {
        const fields = PROFILE_FIELDS.filter(field => field.group === group)
        const body = <div className={css.fieldGrid}><Fields {...props} fields={fields} /></div>
        if (group === 'social' && props.compactSocial === true) {
          return (
            <details className={css.group} key={group}>
              <summary>{props.t('socialSummary')}</summary>
              {body}
            </details>
          )
        }
        return (
          <fieldset className={css.group} key={group}>
            <legend>{props.t(title)}</legend>
            {body}
          </fieldset>
        )
      })}
    </div>
  )
}
