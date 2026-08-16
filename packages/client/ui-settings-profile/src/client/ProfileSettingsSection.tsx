/** Loopback-only public Profile Settings page. */

import { useEffect, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { NS } from './locales.ts'
import { editableProfile, type EditableProfile } from './profile-model.ts'
import type { ProfileSettingsControllerFace } from './profile-store.ts'
import { ProfileForm } from './ProfileForm.tsx'
import css from './ProfileSettings.module.css'

export interface ProfileSettingsInjected {
  hooks: { profileSettings: ProfileSettingsControllerFace['store'] }
  refreshProfile: ProfileSettingsControllerFace['load']
  saveProfile: ProfileSettingsControllerFace['save']
  clearProfile: ProfileSettingsControllerFace['clear']
}

export type ProfileSettingsSectionProps =
  PropsRuntime<'settings.section'> & PropsLocale<typeof NS> & InjectFace<ProfileSettingsInjected>

/** Render the dedicated Profile Settings page. */
export function ProfileSettingsSection({
  useProfileSettings, refreshProfile, saveProfile, clearProfile, t,
}: ProfileSettingsSectionProps) {
  const state = useProfileSettings(snapshot => snapshot)
  const [draft, setDraft] = useState<EditableProfile>(() => editableProfile(state.value))
  const [clearOpen, setClearOpen] = useState(false)

  useEffect(() => { setDraft(editableProfile(state.value)) }, [state.revision, state.value])
  if (state.status === 'idle' || state.status === 'loading') return <p className={css.pageStatus}>{t('loading')}</p>
  if (state.status === 'unavailable') return <p className={css.pageStatus}>{t('unavailable')}</p>
  if (state.status === 'error') {
    return (
      <div className={css.pageStatus} role="alert">
        <p>{t('loadError')}</p>
        <Button size="sm" variant="outline" onClick={() => { void refreshProfile() }}>{t('retry')}</Button>
      </div>
    )
  }
  const busy = state.action !== 'idle'
  const clearNow = async (): Promise<void> => {
    if (await clearProfile()) setClearOpen(false)
  }
  return (
    <section className={css.section}>
      <header className={css.header}>
        <div><h2>{t('title')}</h2><p>{t('intro')}</p></div>
      </header>
      <p className={css.localNotice}>{t('localOnly')}</p>
      <div className={css.notice}>
        <strong>{t('privacyTitle')}</strong>
        <p>{t('privacyDescription')}</p>
      </div>
      <p className={css.warning}>{t('secretWarning')}</p>
      <ProfileForm draft={draft} disabled={busy || !state.writable} t={t} onChange={setDraft} />
      {state.error === 'save' ? <p className={css.error} role="alert">{t('saveError')}</p> : null}
      {state.saved ? <p className={css.success} role="status">{t('saved')}</p> : null}
      <div className={css.actions}>
        <Button variant="outline" disabled={busy || !state.writable} onClick={() => { setClearOpen(true) }}>
          {t('clearAll')}
        </Button>
        <Button variant="primary" disabled={busy || !state.writable} onClick={() => { void saveProfile(draft) }}>
          {busy ? t('saving') : t('save')}
        </Button>
      </div>
      <Modal
        open={clearOpen}
        title={t('clearAllTitle')}
        description={t('clearAllDescription')}
        closeLabel={t('close')}
        onClose={() => { setClearOpen(false) }}
        footer={(
          <>
            <Button variant="outline" onClick={() => { setClearOpen(false) }}>{t('cancel')}</Button>
            <Button variant="primary" disabled={busy} onClick={() => { void clearNow() }}>{t('clearAllConfirm')}</Button>
          </>
        )}
      />
    </section>
  )
}
