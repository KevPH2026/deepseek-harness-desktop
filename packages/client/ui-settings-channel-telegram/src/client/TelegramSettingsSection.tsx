/** Local-desktop Telegram remote-channel settings and pairing flow. */

import { useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  Button, Modal, RiskConfirmation, StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { NS } from './locales.ts'
import type {
  TelegramAccountIdentity, TelegramCredentialState, TelegramRuntimeStatus,
  TelegramSettingsControllerFace, TelegramSettingsError,
} from './settings-store.ts'
import css from './TelegramSettingsSection.module.css'

/** Business face supplied by the local-only Settings registration. */
export interface TelegramSettingsInjected {
  hooks: {
    /** Secret-free joined Settings, credential, and channel snapshot. */
    telegramSettings: TelegramSettingsControllerFace['store']
  }
  /** Refresh the safe status projection. */
  refreshTelegram: TelegramSettingsControllerFace['refresh']
  /** Write a Bot Token; the component remains the only owner of its draft. */
  saveTelegramToken: TelegramSettingsControllerFace['saveToken']
  /** Remove the stored Bot Token. */
  removeTelegramToken: TelegramSettingsControllerFace['removeToken']
  /** Persist or clear the Bot API proxy override. */
  saveTelegramProxy: TelegramSettingsControllerFace['saveProxy']
  /** Enable or disable Telegram ingress. */
  setTelegramEnabled: TelegramSettingsControllerFace['setEnabled']
  /** Generate one short-lived pair link. */
  beginTelegramPairing: TelegramSettingsControllerFace['beginPairing']
  /** Confirm one exact candidate on the desktop. */
  confirmTelegramPairing: TelegramSettingsControllerFace['confirmPairing']
  /** Revoke one exact Host binding. */
  revokeTelegramBinding: TelegramSettingsControllerFace['revokeBinding']
}

/** Props derived from the Settings seat, locale seat, and injected business face. */
export type TelegramSettingsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<typeof NS>
  & InjectFace<TelegramSettingsInjected>

function interpolate(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce(
    (current, [key, value]) => current.replaceAll(`{${key}}`, value),
    template,
  )
}

function displayTime(value: number): string {
  return new Date(value).toLocaleString()
}

function statusLabel(status: TelegramRuntimeStatus, t: TelegramSettingsSectionProps['t']): string {
  if (status === 'disabled') return t('statusDisabled')
  if (status === 'starting') return t('statusStarting')
  if (status === 'online') return t('statusOnline')
  if (status === 'offline') return t('statusOffline')
  if (status === 'backlog-pending') return t('statusBacklogPending')
  return t('statusError')
}

function statusTone(status: TelegramRuntimeStatus): 'done' | 'warning' | 'ongoing' | 'error' {
  if (status === 'online') return 'done'
  if (status === 'starting') return 'ongoing'
  if (status === 'error') return 'error'
  return 'warning'
}

function credentialLabel(
  credential: TelegramCredentialState,
  t: TelegramSettingsSectionProps['t'],
): string {
  if (credential.status === 'idle' || credential.status === 'loading') return t('tokenChecking')
  if (credential.status === 'error') return t('tokenUnavailable')
  return t(credential.configured ? 'tokenConfigured' : 'tokenMissing')
}

function errorLabel(error: TelegramSettingsError, t: TelegramSettingsSectionProps['t']): string {
  if (error === 'load') return t('errorLoad')
  if (error === 'refresh') return t('errorRefresh')
  if (error === 'token-save') return t('errorTokenSave')
  if (error === 'token-remove') return t('errorTokenRemove')
  if (error === 'proxy-save') return t('errorProxySave')
  if (error === 'enable') return t('errorEnable')
  if (error === 'disable') return t('errorDisable')
  if (error === 'pairing') return t('errorPairing')
  if (error === 'backlog-pending') return t('errorBacklogPending')
  if (error === 'confirm') return t('errorConfirm')
  return t('errorRevoke')
}

function IdentityFacts({ identity, t }: {
  identity: TelegramAccountIdentity
  t: TelegramSettingsSectionProps['t']
}) {
  return (
    <dl className={css.identityFacts}>
      {identity.displayName === undefined ? null : (
        <><dt>{t('displayName')}</dt><dd>{identity.displayName}</dd></>
      )}
      {identity.username === undefined ? null : (
        <><dt>{t('username')}</dt><dd>@{identity.username}</dd></>
      )}
      <dt>{t('userId')}</dt><dd><code>{identity.userId}</code></dd>
      <dt>{t('chatId')}</dt><dd><code>{identity.chatId}</code></dd>
    </dl>
  )
}

/** Render the loopback-only Telegram Settings section. */
export function TelegramSettingsSection({
  useTelegramSettings,
  refreshTelegram,
  saveTelegramToken,
  removeTelegramToken,
  saveTelegramProxy,
  setTelegramEnabled,
  beginTelegramPairing,
  confirmTelegramPairing,
  revokeTelegramBinding,
  t,
}: TelegramSettingsSectionProps) {
  const state = useTelegramSettings(snapshot => snapshot)
  const [tokenDraft, setTokenDraft] = useState('')
  const [proxyDraft, setProxyDraft] = useState<string | null>(null)
  const [riskOpen, setRiskOpen] = useState(false)
  const [riskAcknowledged, setRiskAcknowledged] = useState(false)
  const [pairingCopy, setPairingCopy] = useState<'idle' | 'copied' | 'error'>('idle')
  const [candidateTarget, setCandidateTarget] = useState<TelegramAccountIdentity | null>(null)
  const [removeTokenOpen, setRemoveTokenOpen] = useState(false)
  const [revokeTarget, setRevokeTarget] = useState<TelegramAccountIdentity | null>(null)

  if (state.status === 'idle' || state.status === 'loading') {
    return <p className={css.pageStatus}>{t('loading')}</p>
  }
  if (state.status === 'unavailable') {
    return <p className={css.pageStatus}>{t('unavailable')}</p>
  }
  if (state.status === 'error') {
    return (
      <div className={css.pageStatus} role="alert">
        <p>{t('errorLoad')}</p>
        <Button variant="outline" size="sm" onClick={() => { void refreshTelegram() }}>{t('retry')}</Button>
      </div>
    )
  }

  const busy = state.action !== 'idle'
  const credentialReady = state.credential.status === 'ready'
  const credentialWritable = credentialReady && state.credential.writable
  const tokenCanSave = tokenDraft.trim() !== '' && credentialWritable && !busy
  const proxyValue = proxyDraft ?? state.proxyUrl ?? ''
  const proxyDirty = proxyDraft !== null && proxyDraft.trim() !== (state.proxyUrl ?? '')
  const proxyCanSave = state.writable && !busy && proxyDirty
  const pendingUpdateCount = state.pendingUpdateCount ?? 0
  const canEnable = state.writable && state.credential.configured && !busy
  const canPair = state.enabled && state.credential.configured && state.runtime === 'online' && !busy
  const candidate = state.candidate
  const pairing = state.pairing

  const closeRisk = (): void => {
    setRiskOpen(false)
    setRiskAcknowledged(false)
  }
  const confirmRisk = async (): Promise<void> => {
    const enabled = await setTelegramEnabled(true)
    if (enabled) closeRisk()
  }
  const saveToken = async (): Promise<void> => {
    const saved = await saveTelegramToken(tokenDraft)
    if (saved) setTokenDraft('')
  }
  const saveProxy = async (): Promise<void> => {
    const saved = await saveTelegramProxy(proxyValue)
    if (saved) setProxyDraft(null)
  }
  const copyPairingLink = async (url: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(url)
      setPairingCopy('copied')
    } catch {
      setPairingCopy('error')
    }
  }
  const confirmCandidate = async (): Promise<void> => {
    /* v8 ignore next -- the confirm action is mounted only while a captured candidate exists. */
    if (candidateTarget === null) return
    const confirmed = await confirmTelegramPairing(candidateTarget.id)
    if (confirmed) setCandidateTarget(null)
  }
  const confirmRevoke = async (): Promise<void> => {
    /* v8 ignore next -- the revoke action is mounted only while a captured binding exists. */
    if (revokeTarget === null) return
    const revoked = await revokeTelegramBinding(revokeTarget.id)
    if (revoked) setRevokeTarget(null)
  }

  return (
    <section className={css.section} aria-labelledby="telegram-settings-title">
      <header className={css.header}>
        <span className={css.telegramMark} aria-hidden>↗</span>
        <div>
          <h2 id="telegram-settings-title">{t('title')}</h2>
          <p>{t('intro')}</p>
        </div>
      </header>

      <p className={css.localNotice}>{t('localOnly')}</p>
      {!state.writable ? <p className={css.warningNotice}>{t('readOnly')}</p> : null}
      {state.error === null ? null : <p className={css.errorNotice} role="alert">{errorLabel(state.error, t)}</p>}
      {pendingUpdateCount === 0 ? null : (
        <div className={css.backlogNotice} role="alert">
          <strong>{interpolate(t('backlogTitle'), { count: String(pendingUpdateCount) })}</strong>
          <span>{t('backlogDescription')}</span>
          <span>{t('backlogRecovery')}</span>
        </div>
      )}
      {state.success === 'token-saved' ? <p className={css.successNotice} role="status">{t('tokenSaved')}</p> : null}
      {state.success === 'token-removed' ? <p className={css.successNotice} role="status">{t('tokenRemoved')}</p> : null}
      {state.success === 'proxy-saved' ? <p className={css.successNotice} role="status">{t('proxySaved')}</p> : null}

      <article className={css.card}>
        <div className={css.statusRow}>
          <div className={css.statusCopy}>
            <span className={css.eyebrow}>{t('statusTitle')}</span>
            <span className={css.statusValue}>
              <StateDot state={statusTone(state.runtime)} />
              {statusLabel(state.runtime, t)}
            </span>
            <span className={css.hint}>
              {state.botUsername === undefined
                ? t('botUnknown')
                : interpolate(t('botIdentity'), { username: state.botUsername })}
            </span>
            {!state.enabled && state.bindings.length > 0
              ? <span className={css.hint}>{t('bindingPaused')}</span>
              : null}
          </div>
          <div className={css.actionCluster}>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => { void refreshTelegram() }}
            >
              {t(state.action === 'refreshing' ? 'refreshing' : 'refresh')}
            </Button>
            <Button
              variant={state.enabled ? 'outline' : 'primary'}
              size="sm"
              disabled={state.enabled ? !state.writable || busy : !canEnable}
              onClick={() => {
                if (state.enabled) void setTelegramEnabled(false)
                else setRiskOpen(true)
              }}
            >
              {t(state.action === 'enabling'
                ? 'enabling'
                : state.action === 'disabling'
                  ? 'disabling'
                  : state.enabled
                    ? 'disable'
                    : pendingUpdateCount === 0 ? 'enable' : 'recheckEnable')}
            </Button>
          </div>
        </div>
      </article>

      <article className={css.card}>
        <div className={css.cardHeader}>
          <div>
            <h3>{t('tokenTitle')}</h3>
            <p>{t('tokenDescription')}</p>
          </div>
          <a className={css.externalLink} href="https://t.me/BotFather" target="_blank" rel="noreferrer">
            {t('openBotFather')}
          </a>
        </div>
        <p className={css.guide}>{t('botFatherHint')}</p>
        <label className={css.field} htmlFor="telegram-bot-token">
          <span className={css.fieldHead}>
            <span>{t('tokenLabel')}</span>
            <span className={css.credentialBadge} data-configured={state.credential.configured}>
              {credentialLabel(state.credential, t)}
            </span>
          </span>
          <input
            id="telegram-bot-token"
            className={css.input}
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={tokenDraft}
            placeholder={state.credential.configured ? '••••••••••••' : t('tokenPlaceholder')}
            disabled={!credentialWritable || busy}
            onChange={(event) => { setTokenDraft(event.currentTarget.value) }}
          />
          <span className={css.hint}>{credentialWritable ? t('tokenHint') : t('tokenReadOnly')}</span>
        </label>
        <div className={css.cardActions}>
          {state.credential.configured && credentialWritable ? (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => { setRemoveTokenOpen(true) }}>
              {t('removeToken')}
            </Button>
          ) : null}
          <Button variant="primary" size="sm" disabled={!tokenCanSave} onClick={() => { void saveToken() }}>
            {t(state.action === 'saving-token' ? 'savingToken' : 'saveToken')}
          </Button>
        </div>
      </article>

      <article className={css.card}>
        <div className={css.cardHeader}>
          <div>
            <h3>{t('proxyTitle')}</h3>
            <p>{t('proxyDescription')}</p>
          </div>
        </div>
        <label className={css.field} htmlFor="telegram-proxy-url">
          <span className={css.fieldHead}>
            <span>{t('proxyLabel')}</span>
            <span className={css.hint}>
              {state.proxyUrl === undefined
                ? t('proxyDirect')
                : interpolate(t('proxyCurrent'), { url: state.proxyUrl })}
            </span>
          </span>
          <input
            id="telegram-proxy-url"
            className={css.input}
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={proxyValue}
            placeholder={t('proxyPlaceholder')}
            disabled={!state.writable || busy}
            onChange={(event) => { setProxyDraft(event.currentTarget.value) }}
          />
          <span className={css.hint}>{t('proxyHint')}</span>
        </label>
        <div className={css.cardActions}>
          {state.proxyUrl === undefined ? null : (
            <Button
              variant="outline"
              size="sm"
              disabled={!state.writable || busy || proxyDraft !== null}
              onClick={() => { void saveTelegramProxy('') }}
            >
              {t('clearProxy')}
            </Button>
          )}
          <Button variant="primary" size="sm" disabled={!proxyCanSave} onClick={() => { void saveProxy() }}>
            {t(state.action === 'saving-proxy' ? 'savingProxy' : 'saveProxy')}
          </Button>
        </div>
      </article>

      <article className={css.card}>
        <div className={css.cardHeader}>
          <div>
            <h3>{t('pairingTitle')}</h3>
            <p>{t('pairingDescription')}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={!canPair}
            onClick={() => {
              setPairingCopy('idle')
              void beginTelegramPairing()
            }}
          >
            {t(state.action === 'beginning-pairing'
              ? 'generatingPairing'
              : pairing === null ? 'generatePairing' : 'regeneratePairing')}
          </Button>
        </div>
        {pairing === null ? null : (
          <div className={css.pairingLink}>
            <div>
              <strong>{t('pairingLinkReady')}</strong>
              <span>{interpolate(t('pairCode'), { code: pairing.code })}</span>
              {pairing.expiresAt === undefined ? null : (
                <span>{interpolate(t('expiresAt'), { time: displayTime(pairing.expiresAt) })}</span>
              )}
              {pairingCopy === 'copied' ? <span role="status">{t('pairingLinkCopied')}</span> : null}
              {pairingCopy === 'error' ? (
                <label className={css.pairingUrl}>
                  <span role="alert">{t('pairingLinkCopyFailed')}</span>
                  <input
                    className={css.input}
                    aria-label={t('pairingUrlLabel')}
                    readOnly
                    value={pairing.url}
                    onFocus={(event) => { event.currentTarget.select() }}
                  />
                </label>
              ) : null}
            </div>
            <div className={css.pairingActions}>
              <Button
                variant="outline"
                size="sm"
                onClick={() => { void copyPairingLink(pairing.url) }}
              >
                {t('copyPairingLink')}
              </Button>
              <a className={css.primaryLink} href={pairing.url} target="_blank" rel="noreferrer">
                {t('openTelegram')}
              </a>
            </div>
          </div>
        )}
        {candidate === null ? null : (
          <div className={css.candidate}>
            <div>
              <strong>{t('candidateTitle')}</strong>
              <p>{t('candidateDescription')}</p>
              <IdentityFacts identity={candidate} t={t} />
            </div>
            <Button variant="primary" size="sm" disabled={busy} onClick={() => { setCandidateTarget(candidate) }}>
              {t(state.action === 'confirming-pairing' ? 'confirmingCandidate' : 'confirmCandidate')}
            </Button>
          </div>
        )}
      </article>

      <article className={css.card}>
        <div className={css.cardHeader}>
          <div><h3>{t('boundTitle')}</h3></div>
        </div>
        {state.bindings.length === 0 ? <p className={css.empty}>{t('noBoundAccounts')}</p> : (
          <ul className={css.bindingList}>
            {state.bindings.map((binding: TelegramAccountIdentity) => (
              <li key={binding.id} className={css.binding}>
                <div>
                  <IdentityFacts identity={binding} t={t} />
                  {binding.pairedAt === undefined ? null : (
                    <span className={css.hint}>{interpolate(t('pairedAt'), { time: displayTime(binding.pairedAt) })}</span>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => { setRevokeTarget(binding) }}
                >
                  {t(state.action === 'revoking-binding' && revokeTarget?.id === binding.id ? 'revoking' : 'revoke')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </article>

      <aside className={css.safety} aria-labelledby="telegram-safety-title">
        <h3 id="telegram-safety-title">{t('safetyTitle')}</h3>
        <ul>
          <li>{t('safetyPrivate')}</li>
          <li>{t('safetyExactId')}</li>
          <li>{t('safetyOnline')}</li>
          <li>{t('safetyCapabilities')}</li>
          <li>{t('safetyBlocked')}</li>
          <li>{t('safetyPrivacy')}</li>
          <li>{t('safetyQuota')}</li>
          <li>{t('safetyDisabled')}</li>
          <li>{t('safetySecrets')}</li>
        </ul>
      </aside>

      <RiskConfirmation
        open={riskOpen}
        title={t('riskTitle')}
        description={t('riskDescription')}
        acknowledgeLabel={t('riskAcknowledge')}
        cancelLabel={t('riskCancel')}
        confirmLabel={t('riskEnable')}
        acknowledged={riskAcknowledged}
        disabled={state.action === 'enabling'}
        onAcknowledgedChange={setRiskAcknowledged}
        onCancel={closeRisk}
        onConfirm={() => { void confirmRisk() }}
      />

      <Modal
        open={candidateTarget !== null}
        onClose={() => { setCandidateTarget(null) }}
        closeLabel={t('close')}
        title={t('candidateModalTitle')}
        description={t('candidateModalDescription')}
        footer={(
          <>
            <Button variant="outline" onClick={() => { setCandidateTarget(null) }}>{t('candidateCancel')}</Button>
            <Button
              variant="primary"
              disabled={state.action === 'confirming-pairing'}
              onClick={() => { void confirmCandidate() }}
            >
              {t(state.action === 'confirming-pairing' ? 'confirmingCandidate' : 'candidateConfirm')}
            </Button>
          </>
        )}
      >
        {candidateTarget === null ? null : <IdentityFacts identity={candidateTarget} t={t} />}
      </Modal>

      <Modal
        open={removeTokenOpen}
        onClose={() => { setRemoveTokenOpen(false) }}
        closeLabel={t('close')}
        title={t('removeTokenTitle')}
        description={t('removeTokenDescription')}
        footer={(
          <>
            <Button variant="outline" onClick={() => { setRemoveTokenOpen(false) }}>{t('cancel')}</Button>
            <Button
              variant="primary"
              disabled={state.action === 'removing-token'}
              onClick={() => {
                void removeTelegramToken().then((removed: boolean) => { if (removed) setRemoveTokenOpen(false) })
              }}
            >
              {t('removeTokenConfirm')}
            </Button>
          </>
        )}
      />

      <Modal
        open={revokeTarget !== null}
        onClose={() => { setRevokeTarget(null) }}
        closeLabel={t('close')}
        title={t('revokeTitle')}
        description={t('revokeDescription')}
        footer={(
          <>
            <Button variant="outline" onClick={() => { setRevokeTarget(null) }}>{t('cancel')}</Button>
            <Button
              variant="primary"
              disabled={state.action === 'revoking-binding'}
              onClick={() => { void confirmRevoke() }}
            >
              {t(state.action === 'revoking-binding' ? 'revoking' : 'revokeConfirm')}
            </Button>
          </>
        )}
      >
        {revokeTarget === null ? null : <IdentityFacts identity={revokeTarget} t={t} />}
      </Modal>
    </section>
  )
}
