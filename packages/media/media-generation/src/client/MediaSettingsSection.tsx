/** Media-generation settings section over one namespace and two credentials. */

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {
  ApprovalPolicy, ImageQuality, ImageSize, MediaGenerationConfig,
  VideoAspectRatio, VideoDuration, VideoResolution,
} from '../types.ts'
import type {
  MediaCredentialKind, MediaCredentialState, MediaSaveFailureStage, MediaSettingsState,
  MediaSettingsStore, MediaSettingsWrite,
} from './settings-store.ts'
import type { NS } from './locales.ts'
import css from './MediaSettingsSection.module.css'

const IMAGE_DEFAULTS: MediaSettingsWrite['image'] = {
  enabled: false,
  baseURL: 'https://api.openai.com/v1',
  model: 'gpt-image-2',
  apiKeyEnv: 'OPENAI_API_KEY',
  defaultSize: 'auto',
  defaultQuality: 'auto',
}

const VIDEO_DEFAULTS: MediaSettingsWrite['video'] = {
  enabled: false,
  baseURL: 'https://generativelanguage.googleapis.com/v1beta',
  model: 'veo-3.1-generate-preview',
  apiKeyEnv: 'GOOGLE_API_KEY',
  defaultAspectRatio: '16:9',
  defaultDuration: '4',
  defaultResolution: '720p',
}

const CREDENTIAL_REF = /^[A-Za-z_][A-Za-z0-9_]*$/

/** Business face bound by the settings-section registration. */
export interface MediaSettingsInjected {
  hooks: {
    /** Joined settings and credential snapshot. */
    mediaSettings: MediaSettingsStore['store']
  }
  /** Write one complete staged form. */
  saveMediaSettings: (write: MediaSettingsWrite) => Promise<boolean>
  /** Remove the stored credential resolved by one provider card. */
  removeMediaCredential: (kind: MediaCredentialKind) => Promise<boolean>
}

/** Props derived from the Settings slot, locale seat, and registration inject face. */
export type MediaSettingsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<typeof NS>
  & InjectFace<MediaSettingsInjected>

function materialize(config: MediaGenerationConfig | undefined): MediaSettingsWrite {
  return {
    approval: config?.approval ?? 'always',
    image: { ...IMAGE_DEFAULTS, ...config?.image },
    video: { ...VIDEO_DEFAULTS, ...config?.video },
    imageApiKey: '',
    videoApiKey: '',
  }
}

function configKey(write: MediaSettingsWrite): string {
  return JSON.stringify({ approval: write.approval, image: write.image, video: write.video })
}

/** Whether an endpoint follows the same transport policy enforced by the Host provider. */
export function validMediaEndpoint(value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') return false
  if (url.protocol === 'https:') return true
  if (url.protocol !== 'http:') return false
  const host = url.hostname.toLowerCase()
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1'
}

function configuredLabel(
  credential: MediaCredentialState,
  t: MediaSettingsSectionProps['t'],
): { text: string; tone: 'good' | 'muted' | 'warn' } {
  if (credential.status === 'loading' || credential.status === 'idle') {
    return { text: t('credentialChecking'), tone: 'muted' }
  }
  if (credential.status === 'error') return { text: t('credentialUnavailable'), tone: 'warn' }
  return credential.configured
    ? { text: t('credentialConfigured'), tone: 'good' }
    : { text: t('credentialMissing'), tone: 'warn' }
}

function saveFailureLabel(stage: MediaSaveFailureStage, t: MediaSettingsSectionProps['t']): string {
  if (stage === 'credentials') return t('credentialSaveFailed')
  if (stage === 'settings') return t('settingsSaveRejected')
  return t('settingsSaveUnknown')
}

function Field({ id, label, hint, error, children }: {
  id: string
  label: string
  hint: string
  error?: string | undefined
  children: ReactNode
}) {
  return (
    <label className={css.field} htmlFor={id}>
      <span className={css.fieldLabel}>{label}</span>
      {children}
      <span className={error === undefined ? css.hint : css.fieldError}>{error ?? hint}</span>
    </label>
  )
}

function Select({ id, value, disabled, onChange, children }: {
  id: string
  value: string
  disabled: boolean
  onChange: (value: string) => void
  children: ReactNode
}) {
  return (
    <span className={css.selectWrap}>
      <select
        id={id}
        className={css.select}
        value={value}
        disabled={disabled}
        onChange={(event) => { onChange(event.target.value) }}
      >
        {children}
      </select>
    </span>
  )
}

function CredentialField({
  id, kind, credential, value, disabled, busy, removing, removed, actionError, t, onChange, onRemove,
}: {
  id: string
  kind: MediaCredentialKind
  credential: MediaCredentialState
  value: string
  disabled: boolean
  busy: boolean
  removing: boolean
  removed: boolean
  actionError: string | undefined
  t: MediaSettingsSectionProps['t']
  onChange: (value: string) => void
  onRemove: () => void
}) {
  const badge = configuredLabel(credential, t)
  const removable = removing
    || (credential.status === 'ready' && credential.configured && credential.writable)
  return (
    <div className={css.credentialField}>
      <div className={css.credentialHead}>
        <label className={css.fieldLabel} htmlFor={id}>{t('apiKey')}</label>
        <span className={css.credentialBadge} data-tone={badge.tone}>{badge.text}</span>
      </div>
      <input
        id={id}
        className={css.input}
        type="password"
        autoComplete="off"
        value={value}
        placeholder={credential.configured ? '••••••••••••' : ''}
        disabled={disabled || !credential.writable}
        onChange={(event) => { onChange(event.target.value) }}
      />
      <div className={css.credentialFooter}>
        <span className={css.hint}>{t(credential.writable ? 'apiKeyHint' : 'apiKeyReadOnlyHint')}</span>
        {removable
          ? (
            <button
              type="button"
              className={css.removeCredentialButton}
              disabled={busy}
              aria-label={t(kind === 'image' ? 'removeImageCredential' : 'removeVideoCredential')}
              onClick={onRemove}
            >
              {t(removing ? 'removingCredential' : 'removeCredential')}
            </button>
          )
          : null}
      </div>
      {actionError === undefined
        ? null
        : <span className={css.credentialActionError} role="alert" title={actionError}>{t('credentialRemoveFailed')}</span>}
      {removed
        ? <span className={css.credentialActionSuccess} role="status" aria-live="polite">{t('credentialRemoved')}</span>
        : null}
    </div>
  )
}

function ProviderHeader({ kind, title, description, enabled, toggleLabel, disabled, onToggle, t }: {
  kind: 'image' | 'video'
  title: string
  description: string
  enabled: boolean
  toggleLabel: string
  disabled: boolean
  onToggle: (value: boolean) => void
  t: MediaSettingsSectionProps['t']
}) {
  return (
    <div className={css.providerHeader}>
      <span className={css.providerGlyph} data-kind={kind} aria-hidden>{kind === 'image' ? '◫' : '▶'}</span>
      <span className={css.providerIdentity}>
        <span className={css.providerTitle}>{title}</span>
        <span className={css.providerDescription}>{description}</span>
      </span>
      <label className={css.toggle}>
        <input
          type="checkbox"
          checked={enabled}
          disabled={disabled}
          aria-label={toggleLabel}
          onChange={(event) => { onToggle(event.target.checked) }}
        />
        <span>{t(enabled ? 'enabled' : 'disabled')}</span>
      </label>
    </div>
  )
}

/** Render the Media settings page. */
export function MediaSettingsSection({
  useMediaSettings, saveMediaSettings, removeMediaCredential, t,
}: MediaSettingsSectionProps) {
  const state = useMediaSettings(snapshot => snapshot)
  if (state.status === 'loading') return <p className={css.status}>{t('loading')}</p>
  if (state.status === 'unavailable' || state.config === undefined) {
    return <p className={css.status}>{t('unavailable')}</p>
  }
  return <MediaSettingsForm state={state} save={saveMediaSettings} remove={removeMediaCredential} t={t} />
}

function MediaSettingsForm({ state, save, remove, t }: {
  state: MediaSettingsState
  save: MediaSettingsInjected['saveMediaSettings']
  remove: MediaSettingsInjected['removeMediaCredential']
  t: MediaSettingsSectionProps['t']
}) {
  const source = useMemo(() => materialize(state.config), [state.config])
  const sourceKey = configKey(source)
  const [draft, setDraft] = useState<MediaSettingsWrite>(source)
  const [baseline, setBaseline] = useState(sourceKey)
  const [seenSave, setSeenSave] = useState(state.savedRevision)
  const dirty = configKey(draft) !== baseline || draft.imageApiKey.trim() !== '' || draft.videoApiKey.trim() !== ''

  useEffect(() => {
    const saved = state.savedRevision !== seenSave
    if (!saved && (state.saving || dirty)) return
    setDraft(source)
    setBaseline(sourceKey)
    setSeenSave(state.savedRevision)
  }, [dirty, seenSave, source, sourceKey, state.savedRevision, state.saving])

  const imageEndpointInvalid = draft.image.enabled && !validMediaEndpoint(draft.image.baseURL)
  const videoEndpointInvalid = draft.video.enabled && !validMediaEndpoint(draft.video.baseURL)
  const imageModelInvalid = draft.image.enabled && draft.image.model.trim() === ''
  const videoModelInvalid = draft.video.enabled && draft.video.model.trim() === ''
  const imageRefInvalid = !CREDENTIAL_REF.test(draft.image.apiKeyEnv)
  const videoRefInvalid = !CREDENTIAL_REF.test(draft.video.apiKeyEnv)
  const invalid = imageEndpointInvalid || videoEndpointInvalid || imageModelInvalid || videoModelInvalid
    || imageRefInvalid || videoRefInvalid
  const busy = state.saving || state.removingCredential !== null
  const disabled = !state.writable || busy

  const updateImage = (patch: Partial<MediaSettingsWrite['image']>): void => {
    setDraft(current => ({ ...current, image: { ...current.image, ...patch } }))
  }
  const updateVideo = (patch: Partial<MediaSettingsWrite['video']>): void => {
    setDraft(current => ({ ...current, video: { ...current.video, ...patch } }))
  }
  const discard = (): void => {
    setDraft(source)
    setBaseline(sourceKey)
  }

  return (
    <section className={css.section} aria-labelledby="media-generation-title">
      <header className={css.pageHeader}>
        <div>
          <h2 id="media-generation-title" className={css.title}>{t('title')}</h2>
          <p className={css.intro}>{t('intro')}</p>
        </div>
        <span className={css.providerCount}>2</span>
      </header>

      {!state.writable ? <p className={css.notice}>{t('readOnly')}</p> : null}
      {state.credentialError === null ? null : <p className={css.notice}>{t('credentialLoadFailed')}</p>}
      {state.saveError === null
        ? null
        : (
          <p className={css.error} role="alert" title={state.saveError.message}>
            {saveFailureLabel(state.saveError.stage, t)}
          </p>
        )}
      {state.savedRevision > 0 && state.saveError === null
        ? <p className={css.saved} role="status" aria-live="polite">{t('saved')}</p>
        : null}

      <div className={css.approvalCard}>
        <div className={css.approvalCopy}>
          <span className={css.providerTitle}>{t('approval')}</span>
          <span className={css.providerDescription}>{t('approvalHint')}</span>
        </div>
        <Select
          id="media-approval"
          value={draft.approval}
          disabled={disabled}
          onChange={(value) => { setDraft(current => ({ ...current, approval: value as ApprovalPolicy })) }}
        >
          <option value="always">{t('approvalAlways')}</option>
          <option value="video-only">{t('approvalVideoOnly')}</option>
          <option value="never">{t('approvalNever')}</option>
        </Select>
        {draft.approval === 'never' ? <p className={css.approvalWarning}>{t('approvalNeverHint')}</p> : null}
      </div>

      <article className={css.providerCard} data-kind="image">
        <ProviderHeader
          kind="image"
          title={t('imageTitle')}
          description={t('imageDescription')}
          enabled={draft.image.enabled}
          toggleLabel={t('enableImage')}
          disabled={disabled}
          onToggle={(enabled) => { updateImage({ enabled }) }}
          t={t}
        />
        <div className={css.fieldGrid}>
          <Field
            id="media-image-endpoint"
            label={t('providerEndpoint')}
            hint={t('providerEndpointHint')}
            error={imageEndpointInvalid ? t('invalidEndpoint') : undefined}
          >
            <input
              id="media-image-endpoint"
              className={imageEndpointInvalid ? css.inputInvalid : css.input}
              type="url"
              value={draft.image.baseURL}
              disabled={disabled}
              aria-invalid={imageEndpointInvalid || undefined}
              onChange={(event) => { updateImage({ baseURL: event.target.value }) }}
            />
          </Field>
          <Field
            id="media-image-model"
            label={t('model')}
            hint={t('modelHint')}
            error={imageModelInvalid ? t('requiredModel') : undefined}
          >
            <input
              id="media-image-model"
              className={imageModelInvalid ? css.inputInvalid : css.input}
              type="text"
              value={draft.image.model}
              disabled={disabled}
              aria-invalid={imageModelInvalid || undefined}
              onChange={(event) => { updateImage({ model: event.target.value }) }}
            />
          </Field>
          <Field
            id="media-image-credential-ref"
            label={t('credentialRef')}
            hint={t('credentialRefHint')}
            error={imageRefInvalid ? t('invalidCredentialRef') : undefined}
          >
            <input
              id="media-image-credential-ref"
              className={imageRefInvalid ? css.inputInvalid : css.input}
              type="text"
              value={draft.image.apiKeyEnv}
              disabled={disabled}
              spellCheck={false}
              aria-invalid={imageRefInvalid || undefined}
              onChange={(event) => { updateImage({ apiKeyEnv: event.target.value }) }}
            />
          </Field>
          <CredentialField
            id="media-image-api-key"
            kind="image"
            credential={state.imageCredential}
            value={draft.imageApiKey}
            disabled={disabled}
            busy={busy}
            removing={state.removingCredential === 'image'}
            removed={state.removedCredential === 'image'}
            actionError={state.credentialActionError?.kind === 'image'
              ? state.credentialActionError.message
              : undefined}
            t={t}
            onChange={(imageApiKey) => { setDraft(current => ({ ...current, imageApiKey })) }}
            onRemove={() => { void remove('image') }}
          />
          <Field id="media-image-size" label={t('imageSize')} hint="">
            <Select
              id="media-image-size"
              value={draft.image.defaultSize}
              disabled={disabled}
              onChange={(value) => { updateImage({ defaultSize: value as ImageSize }) }}
            >
              <option value="auto">{t('sizeAuto')}</option>
              <option value="1024x1024">{t('sizeSquare')}</option>
              <option value="1536x1024">{t('sizeLandscape')}</option>
              <option value="1024x1536">{t('sizePortrait')}</option>
            </Select>
          </Field>
          <Field id="media-image-quality" label={t('imageQuality')} hint="">
            <Select
              id="media-image-quality"
              value={draft.image.defaultQuality}
              disabled={disabled}
              onChange={(value) => { updateImage({ defaultQuality: value as ImageQuality }) }}
            >
              <option value="auto">{t('qualityAuto')}</option>
              <option value="low">{t('qualityLow')}</option>
              <option value="medium">{t('qualityMedium')}</option>
              <option value="high">{t('qualityHigh')}</option>
            </Select>
          </Field>
        </div>
      </article>

      <article className={css.providerCard} data-kind="video">
        <ProviderHeader
          kind="video"
          title={t('videoTitle')}
          description={t('videoDescription')}
          enabled={draft.video.enabled}
          toggleLabel={t('enableVideo')}
          disabled={disabled}
          onToggle={(enabled) => { updateVideo({ enabled }) }}
          t={t}
        />
        <div className={css.fieldGrid}>
          <Field
            id="media-video-endpoint"
            label={t('providerEndpoint')}
            hint={t('providerEndpointHint')}
            error={videoEndpointInvalid ? t('invalidEndpoint') : undefined}
          >
            <input
              id="media-video-endpoint"
              className={videoEndpointInvalid ? css.inputInvalid : css.input}
              type="url"
              value={draft.video.baseURL}
              disabled={disabled}
              aria-invalid={videoEndpointInvalid || undefined}
              onChange={(event) => { updateVideo({ baseURL: event.target.value }) }}
            />
          </Field>
          <Field
            id="media-video-model"
            label={t('model')}
            hint={t('modelHint')}
            error={videoModelInvalid ? t('requiredModel') : undefined}
          >
            <input
              id="media-video-model"
              className={videoModelInvalid ? css.inputInvalid : css.input}
              type="text"
              value={draft.video.model}
              disabled={disabled}
              aria-invalid={videoModelInvalid || undefined}
              onChange={(event) => { updateVideo({ model: event.target.value }) }}
            />
          </Field>
          <Field
            id="media-video-credential-ref"
            label={t('credentialRef')}
            hint={t('credentialRefHint')}
            error={videoRefInvalid ? t('invalidCredentialRef') : undefined}
          >
            <input
              id="media-video-credential-ref"
              className={videoRefInvalid ? css.inputInvalid : css.input}
              type="text"
              value={draft.video.apiKeyEnv}
              disabled={disabled}
              spellCheck={false}
              aria-invalid={videoRefInvalid || undefined}
              onChange={(event) => { updateVideo({ apiKeyEnv: event.target.value }) }}
            />
          </Field>
          <CredentialField
            id="media-video-api-key"
            kind="video"
            credential={state.videoCredential}
            value={draft.videoApiKey}
            disabled={disabled}
            busy={busy}
            removing={state.removingCredential === 'video'}
            removed={state.removedCredential === 'video'}
            actionError={state.credentialActionError?.kind === 'video'
              ? state.credentialActionError.message
              : undefined}
            t={t}
            onChange={(videoApiKey) => { setDraft(current => ({ ...current, videoApiKey })) }}
            onRemove={() => { void remove('video') }}
          />
          <Field id="media-video-aspect" label={t('videoAspect')} hint="">
            <Select
              id="media-video-aspect"
              value={draft.video.defaultAspectRatio}
              disabled={disabled}
              onChange={(value) => { updateVideo({ defaultAspectRatio: value as VideoAspectRatio }) }}
            >
              <option value="16:9">16:9</option>
              <option value="9:16">9:16</option>
            </Select>
          </Field>
          <Field id="media-video-duration" label={t('videoDuration')} hint={t('resolutionDurationHint')}>
            <Select
              id="media-video-duration"
              value={draft.video.defaultDuration}
              disabled={disabled}
              onChange={(value) => { updateVideo({ defaultDuration: value as VideoDuration }) }}
            >
              {(['4', '6', '8'] as const).map(duration => (
                <option
                  key={duration}
                  value={duration}
                  disabled={draft.video.defaultResolution !== '720p' && duration !== '8'}
                >
                  {t('seconds').replace('{value}', duration)}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="media-video-resolution" label={t('videoResolution')} hint={t('resolutionDurationHint')}>
            <Select
              id="media-video-resolution"
              value={draft.video.defaultResolution}
              disabled={disabled}
              onChange={(value) => {
                const resolution = value as VideoResolution
                updateVideo({
                  defaultResolution: resolution,
                  ...resolution === '720p' ? {} : { defaultDuration: '8' },
                })
              }}
            >
              <option value="720p">720p</option>
              <option value="1080p">1080p</option>
              <option value="4k">4K</option>
            </Select>
          </Field>
        </div>
      </article>

      <footer className={css.footer}>
        <button type="button" className={css.discardButton} disabled={!dirty || busy} onClick={discard}>
          {t('discard')}
        </button>
        <button
          type="button"
          className={css.saveButton}
          disabled={!dirty || invalid || disabled}
          onClick={() => { void save(draft) }}
        >
          {t(state.saving ? 'saving' : 'save')}
        </button>
      </footer>
    </section>
  )
}
