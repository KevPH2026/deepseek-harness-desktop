/** Optional public-profile first-run step. */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { Button, OnboardingSurface } from '@deepseek-ai/dsh-client-ui-primitives'
import type { NS } from './locales.ts'
import { editableProfile, type EditableProfile } from './profile-model.ts'
import type { ProfileSettingsControllerFace } from './profile-store.ts'
import { ProfileForm } from './ProfileForm.tsx'
import css from './ProfileSettings.module.css'

function interpolate(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce(
    (current, [key, value]) => current.replaceAll(`{${key}}`, value),
    template,
  )
}

export interface PublicProfileOnboardingInjected {
  hooks: { publicProfileOnboarding: ProfileSettingsControllerFace['store'] }
  refreshProfile: ProfileSettingsControllerFace['load']
  saveProfile: ProfileSettingsControllerFace['save']
  skipProfile: ProfileSettingsControllerFace['skip']
}

export type PublicProfileOnboardingProps =
  PropsRuntime<'settings.onboarding'> & PropsLocale<typeof NS> & InjectFace<PublicProfileOnboardingInjected>

/** Show once on a blank-session first run, before existing model onboarding. */
export function PublicProfileOnboarding({
  complete, usePublicProfileOnboarding, refreshProfile, saveProfile, skipProfile, t,
}: PublicProfileOnboardingProps) {
  const state = usePublicProfileOnboarding(snapshot => snapshot)
  const [draft, setDraft] = useState<EditableProfile>(() => editableProfile(state.value))
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const finished = useRef(false)
  const finish = useCallback(() => {
    if (finished.current) return
    finished.current = true
    complete()
  }, [complete])
  const failOpenForSession = state.status === 'unavailable'
    || state.status === 'error'
    || (state.status === 'ready' && !state.writable)

  useEffect(() => {
    if (state.status === 'idle') void refreshProfile()
  }, [refreshProfile, state.status])
  useEffect(() => { setDraft(editableProfile(state.value)) }, [state.revision, state.value])
  useEffect(() => {
    // A read-only or unreadable settings document cannot persist either save or
    // skip. Complete only the coordinator's in-memory step instead of mounting
    // an inert takeover that the user has no way to dismiss.
    if (failOpenForSession || state.onboarding !== undefined) finish()
  }, [failOpenForSession, finish, state.onboarding])

  if (state.status === 'idle' || state.status === 'loading' || failOpenForSession
    || state.onboarding !== undefined) return null
  const busy = state.action !== 'idle'
  const stepGroups = step === 1 ? ['identity'] as const
    : step === 2 ? ['work', 'preferences'] as const
      : ['social'] as const
  const stepTitle = step === 1 ? t('onboardingStep1Title')
    : step === 2 ? t('onboardingStep2Title') : t('onboardingStep3Title')
  const stepDescription = step === 1 ? t('onboardingStep1Description')
    : step === 2 ? t('onboardingStep2Description') : t('onboardingStep3Description')
  const save = async (): Promise<void> => { if (await saveProfile(draft, true)) finish() }
  const skip = async (): Promise<void> => { if (await skipProfile()) finish() }
  return (
    <OnboardingSurface>
      <div className={css.onboardingCard} role="dialog" aria-modal="true" aria-label={t('onboardingTitle')}>
        <header className={css.onboardingHeader}>
          <h2>{t('onboardingTitle')}</h2>
          <p>{t('onboardingIntro')}</p>
          <p className={css.scopeNote}>{t('onboardingScope')}</p>
        </header>
        <div className={css.onboardingScroll}>
          <div className={css.stepHeader}>
            <span aria-current="step">{interpolate(t('onboardingProgress'), { current: String(step) })}</span>
            <h3>{stepTitle}</h3>
            <p>{stepDescription}</p>
          </div>
          <div className={css.notice}>
            <strong>{t('privacyTitle')}</strong><p>{t('privacyDescription')}</p>
          </div>
          <p className={css.warning}>{t('secretWarning')}</p>
          <ProfileForm
            draft={draft}
            disabled={busy || !state.writable}
            groups={stepGroups}
            t={t}
            onChange={setDraft}
          />
          {state.error !== null ? <p className={css.error} role="alert">{t('saveError')}</p> : null}
        </div>
        <div className={css.onboardingActions}>
          {step > 1
            ? <Button variant="outline" disabled={busy} onClick={() => { setStep(current => current === 3 ? 2 : 1) }}>{t('onboardingBack')}</Button>
            : <Button variant="outline" disabled={busy} onClick={() => { void skip() }}>{t('onboardingSkip')}</Button>}
          {step === 3
            ? (
              <>
                <Button variant="outline" disabled={busy} onClick={() => { void skip() }}>{t('onboardingSkip')}</Button>
                <Button variant="primary" disabled={busy} onClick={() => { void save() }}>
                  {busy ? t('onboardingSaving') : t('onboardingSave')}
                </Button>
              </>
            )
            : <Button variant="primary" disabled={busy} onClick={() => { setStep(current => current === 1 ? 2 : 3) }}>{t('onboardingNext')}</Button>}
        </div>
      </div>
    </OnboardingSurface>
  )
}
