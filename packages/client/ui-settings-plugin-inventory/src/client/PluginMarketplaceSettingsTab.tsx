import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type {
  PluginMarketplaceCatalogSnapshot,
  PluginMarketplaceConfirmationId,
  PluginMarketplaceCategory,
  PluginMarketplaceCuratedBundleResult,
  PluginMarketplaceCuratedBundleStatus,
  PluginMarketplaceConfirmImportResult,
  PluginMarketplacePrepareImportResult,
  PluginMarketplaceResources,
  PluginMarketplaceValidateCatalogItemResult,
} from '@deepseek-ai/dsh-api-remotes/client'
import {
  Button,
  Modal,
  IconCheckOutline16,
  IconCodeOutline16,
  IconCopyOutline16,
  IconDownloadOutline16,
  IconFolderOpenOutline16,
  IconLinkOutline16,
  IconPlusOutline16,
  IconSearchOutline16,
  IconWarningOutline16,
  writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PluginInventoryLocaleKey } from './locales.ts'
import css from './PluginMarketplaceSettingsTab.module.css'

/** Read-only Remote face used by the marketplace tab while installation remains fail-closed. */
export interface PluginMarketplaceSettingsTabInjected {
  catalog: (request: {
    query?: string
    category?: PluginMarketplaceCategory
    refresh?: boolean
  }) => Promise<PluginMarketplaceCatalogSnapshot>
  resources: () => Promise<PluginMarketplaceResources>
  validateCatalogItem: (itemId: string) => Promise<PluginMarketplaceValidateCatalogItemResult>
  curatedBundleStatus: () => Promise<PluginMarketplaceCuratedBundleStatus>
  installCuratedBundle: (acknowledgedRisk: boolean) => Promise<PluginMarketplaceCuratedBundleResult>
  uninstallCuratedBundle: () => Promise<PluginMarketplaceCuratedBundleResult>
  prepareImport: (itemId: string) => Promise<unknown>
  confirmImport: (confirmationId: PluginMarketplaceConfirmationId) => Promise<unknown>
  featuredPlugins: () => Promise<unknown>
}

/** Full props assembled by the Settings slot renderer. */
export type PluginMarketplaceSettingsTabProps =
  PropsRuntime<'settings.plugins.tab'>
  & PropsLocale<'settings.pluginInventory'>
  & InjectFace<PluginMarketplaceSettingsTabInjected>

type CatalogItem = PluginMarketplaceCatalogSnapshot['items'][number]
type CustomSourceKind = 'github' | 'npm' | 'local'

type CatalogState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly snapshot: PluginMarketplaceCatalogSnapshot }

const CATEGORIES = [
  'design',
  'coding',
  'writing',
  'model-provider',
  'gateway',
  'other',
] as const satisfies readonly PluginMarketplaceCategory[]

const CATEGORY_KEYS = {
  design: 'marketCategoryDesign',
  coding: 'marketCategoryCoding',
  writing: 'marketCategoryWriting',
  'model-provider': 'marketCategoryModelProvider',
  gateway: 'marketCategoryGateway',
  other: 'marketCategoryOther',
} satisfies Record<PluginMarketplaceCategory, PluginInventoryLocaleKey>

const CUSTOM_SOURCE_KEYS = {
  github: 'marketCustomGithub',
  npm: 'marketCustomNpm',
  local: 'marketCustomLocal',
} satisfies Record<CustomSourceKind, PluginInventoryLocaleKey>

const PLACEHOLDER_KEYS = {
  github: 'marketGithubPlaceholder',
  npm: 'marketNpmPlaceholder',
  local: 'marketLocalPlaceholder',
} satisfies Record<CustomSourceKind, PluginInventoryLocaleKey>

const VALIDATION_FAILURE_KEYS = {
  'manifest-missing': 'marketValidationManifestMissing',
  'manifest-invalid': 'marketValidationManifestInvalid',
  'bundle-missing': 'marketValidationBundleMissing',
  'patch-path-invalid': 'marketValidationPatchPathInvalid',
  'patch-missing': 'marketValidationPatchMissing',
} satisfies Record<NonNullable<CatalogItem['validationFailure']>, PluginInventoryLocaleKey>

/** Partner claims fail closed: an offer is usable only on a verified model/gateway item. */
export function verifiedPartnerOffers(item: CatalogItem): CatalogItem['partnerOffers'] {
  if (item.category !== 'model-provider' && item.category !== 'gateway') return []
  if (item.verifiedSource === undefined) return []
  return item.partnerOffers
}

function compactStars(value: number): string {
  return new Intl.NumberFormat(undefined, {
    notation: value >= 1000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(value)
}

function formatDate(value: string): string {
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) return value
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(parsed))
}

function formatFeaturedTime(value: string): string {
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) return value
  const date = new Date(parsed)
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function warningKey(warning: PluginMarketplaceCatalogSnapshot['warning']): PluginInventoryLocaleKey | undefined {
  switch (warning) {
    case 'offline-cache': return 'marketWarningOfflineCache'
    case 'offline-no-cache': return 'marketWarningOfflineNoCache'
    case 'rate-limited': return 'marketWarningRateLimited'
    case 'github-response-invalid': return 'marketWarningInvalidResponse'
    case undefined: return undefined
  }
}

/** Render catalog discovery, trust facts, verified offers, and a non-executing import draft. */
export function PluginMarketplaceSettingsTab({
  catalog,
  resources,
  validateCatalogItem,
  curatedBundleStatus,
  installCuratedBundle,
  uninstallCuratedBundle,
  prepareImport,
  confirmImport,
  featuredPlugins,
  t,
}: PluginMarketplaceSettingsTabProps): ReactNode {
  const [curated, setCurated] = useState<
    | { readonly phase: 'loading' }
    | { readonly phase: 'ready'; readonly status: PluginMarketplaceCuratedBundleStatus }
    | { readonly phase: 'busy' }
    | {
      readonly phase: 'done'
      readonly ok: boolean
      readonly installed: boolean
      readonly detail?: string
    }
  >({ phase: 'loading' })
  const [curatedAcknowledged, setCuratedAcknowledged] = useState(false)
  const [importPreview, setImportPreview] = useState<
    | { readonly kind: 'idle' }
    | { readonly kind: 'preparing' }
    | { readonly kind: 'preview'; readonly preview: Extract<PluginMarketplacePrepareImportResult, { ok: true }>['value'] }
    | { readonly kind: 'installing'; readonly confirmationId: string; readonly sourceRef: string }
    | { readonly kind: 'done'; readonly ok: boolean; readonly sourceRef: string; readonly tail: string }
  >({ kind: 'idle' })
  const [importAcknowledged, setImportAcknowledged] = useState(false)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<PluginMarketplaceCategory>('design')
  const [refresh, setRefresh] = useState(0)
  const usedRefresh = useRef(0)
  const [state, setState] = useState<CatalogState>({ status: 'loading' })
  const [links, setLinks] = useState<PluginMarketplaceResources>()
  const [customKind, setCustomKind] = useState<CustomSourceKind>('github')
  const [featured, setFeatured] = useState<
    | { readonly status: 'loading' }
    | { readonly status: 'error' }
    | { readonly status: 'ready'; readonly items: ReadonlyArray<{
        readonly package: string
        readonly displayName: string
        readonly whyIncluded: string
        readonly category: string
      }>; readonly source: 'fetched' | 'bundled-default'; readonly refreshedAt: string }
  >({ status: 'loading' })
  const [featuredConfirming, setFeaturedConfirming] = useState<{
    readonly package: string
    readonly displayName: string
    readonly whyIncluded: string
  } | null>(null)
  const [featuredAcknowledging, setFeaturedAcknowledging] = useState(false)
  const [customSource, setCustomSource] = useState('')
  const [validatingId, setValidatingId] = useState<string>()
  const [validationError, setValidationError] = useState<string>()
  const [templateCopy, setTemplateCopy] = useState<{
    readonly path: string
    readonly status: 'copied' | 'error'
  }>()

  useEffect(() => {
    let current = true
    void curatedBundleStatus().then(
      (status) => { if (current) setCurated({ phase: 'ready', status }) },
      () => { if (current) setCurated({ phase: 'ready', status: { package: '', installed: false, version: undefined } }) },
    )
    return () => { current = false }
  }, [curatedBundleStatus])

  const runCurated = (operation: 'install' | 'uninstall'): void => {
    if (curated.phase === 'busy') return
    setCurated({ phase: 'busy' })
    const request = operation === 'install'
      ? installCuratedBundle(curatedAcknowledged)
      : uninstallCuratedBundle()
    void request.then(
      (result) => {
        setCuratedAcknowledged(false)
        setCurated({
          phase: 'done',
          ok: result.ok,
          installed: result.installed,
          ...(result.detail === undefined ? {} : { detail: result.detail }),
        })
      },
      () => {
        setCurated({ phase: 'done', ok: false, installed: curated.phase === 'ready' ? curated.status.installed : false })
      },
    )
  }

  useEffect(() => {
    let current = true
    const trimmed = query.trim()
    const manualRefresh = refresh > usedRefresh.current
    usedRefresh.current = refresh
    setState({ status: 'loading' })
    void Promise.resolve().then(() => catalog({
      category,
      ...(trimmed.length === 0 ? {} : { query: trimmed }),
      ...(manualRefresh ? { refresh: true } : {}),
    })).then(
      (snapshot) => { if (current) setState({ status: 'ready', snapshot }) },
      () => { if (current) setState({ status: 'error' }) },
    )
    return () => { current = false }
  }, [catalog, category, query, refresh])

  useEffect(() => {
    let current = true
    void featuredPlugins().then(
      (raw) => {
        if (!current) return
        const snapshot = raw as {
          items: ReadonlyArray<{
            package: string
            displayName: string
            whyIncluded: string
            category: string
          }>
          source: 'fetched' | 'bundled-default'
          refreshedAt: string
        }
        setFeatured({
          status: 'ready',
          items: snapshot.items.map(item => ({
            package: item.package,
            displayName: item.displayName,
            whyIncluded: item.whyIncluded,
            category: item.category,
          })),
          source: snapshot.source,
          refreshedAt: snapshot.refreshedAt,
        })
      },
      () => { if (current) setFeatured({ status: 'error' }) },
    )
    return () => { current = false }
  }, [featuredPlugins])

  const installFeaturedNow = (packageName: string): void => {
    // The modal does the same prepareImport + confirmImport flow as the
    // explicit GitHub Topics path. We only track status in the modal's
    // confirm CTA; HTTP surface state is intentionally separate from the
    // self-contained featured-list state.
    void prepareImport(packageName).then(
      (raw) => {
        const result = raw as
          | { ok: true; value: { confirmationId: PluginMarketplaceConfirmationId } }
          | { ok: false; error: { code: string; message: string } }
        if (!result.ok) return
        void confirmImport(result.value.confirmationId).then(
          () => { setFeaturedConfirming(null) },
          () => {},
        )
      },
      () => {},
    )
  }

  useEffect(() => {
    let current = true
    void Promise.resolve().then(() => resources()).then(
      (value) => { if (current) setLinks(value) },
      () => {},
    )
    return () => { current = false }
  }, [resources])

  const items = state.status === 'ready' ? state.snapshot.items : []
  const partnerships = useMemo(
    () => items.flatMap(item => verifiedPartnerOffers(item).map(offer => ({ item, offer }))),
    [items],
  )
  const publicOffers = state.status === 'ready' ? state.snapshot.publicOffers : []
  const showOffers = category === 'model-provider' || category === 'gateway'
  const warning = state.status === 'ready' ? warningKey(state.snapshot.warning) : undefined

  const validate = (item: CatalogItem): void => {
    if (validatingId !== undefined || item.installability !== 'unknown') return
    setValidatingId(item.id)
    setValidationError(undefined)
    void validateCatalogItem(item.id).then(
      (result) => {
        setValidatingId(undefined)
        if (!result.ok) {
          setValidationError(result.error.message)
          return
        }
        setState(current => current.status !== 'ready' ? current : {
          status: 'ready',
          snapshot: {
            ...current.snapshot,
            items: current.snapshot.items.map(candidate => candidate.id === result.value.id ? result.value : candidate),
          },
        })
      },
      () => {
        setValidatingId(undefined)
        setValidationError(t('marketValidationError'))
      },
    )
  }

  const startImport = (item: CatalogItem): void => {
    setImportAcknowledged(false)
    setImportPreview({ kind: 'preparing' })
    void prepareImport(item.id).then(
      (raw: unknown) => {
        const result = raw as PluginMarketplacePrepareImportResult
        if (!result.ok) {
          setImportPreview({ kind: 'idle' })
          return
        }
        setImportPreview({ kind: 'preview', preview: result.value })
      },
      () => { setImportPreview({ kind: 'idle' }) },
    )
  }

  const runConfirmImport = (): void => {
    if (importPreview.kind !== 'preview') return
    const { confirmationId, sourceRef } = importPreview.preview
    setImportPreview({ kind: 'installing', confirmationId, sourceRef })
    void confirmImport(confirmationId).then(
      (raw: unknown) => {
        const result = raw as PluginMarketplaceConfirmImportResult
        if (result.ok) {
          setImportPreview({
            kind: 'done',
            ok: true,
            sourceRef: result.value.sourceRef,
            tail: result.value.stdoutTail,
          })
        } else {
          setImportPreview({
            kind: 'done',
            ok: false,
            sourceRef,
            tail: result.error.message,
          })
        }
      },
      () => {
        setImportPreview({ kind: 'done', ok: false, sourceRef, tail: '' })
      },
    )
  }

  const cancelImport = (): void => {
    setImportPreview({ kind: 'idle' })
    setImportAcknowledged(false)
  }

  const copyTemplateFile = (
    file: PluginMarketplaceResources['template']['files'][number],
  ): void => {
    setTemplateCopy(undefined)
    void writeClipboard(file.content).then((copied) => {
      setTemplateCopy({ path: file.path, status: copied ? 'copied' : 'error' })
    })
  }

  return (
    <div className={css.section} aria-busy={state.status === 'loading'}>
      <div className={css.hero}>
        <div>
          <h3>{t('marketTitle')}</h3>
          <p>{t('marketIntro')}</p>
        </div>
        {links !== undefined ? (
          <a className={css.createLink} href={links.publishGuideUrl} target="_blank" rel="noopener noreferrer">
            <IconCodeOutline16 aria-hidden="true" />
            {t('marketCreatePlugin')}
          </a>
        ) : null}
      </div>

      <section className={css.featured} aria-labelledby="featured-picks-title">
        <div className={css.sectionHeading}>
          <h4 id="featured-picks-title">{t('featuredTitle')}</h4>
          <p>{t('featuredDescription')}</p>
        </div>
        {featured.status === 'loading' ? (
          <p className={css.status}>{t('featuredLoading')}</p>
        ) : featured.status === 'error' ? (
          <p className={css.failure} role="alert">{t('featuredError')}</p>
        ) : (
          <>
            <div className={css.featuredMeta}>
              {featured.status === 'ready' && featured.source === 'fetched'
                ? t('featuredSourceFetched', { when: formatFeaturedTime(featured.refreshedAt) })
                : t('featuredSourceBundled')}
            </div>
            <div className={css.featuredGrid}>
              {(featured.status === 'ready' ? featured.items : []).map((item, i) => (
                <article key={`${item.package}-${i}`} className={css.featuredCard} data-category={item.category}>
                  <header className={css.featuredCardHead}>
                    <strong className={css.featuredName}>{item.displayName}</strong>
                    <span className={css.featuredPackage}><code>{item.package}</code></span>
                  </header>
                  <p className={css.featuredReason}>{item.whyIncluded}</p>
                  <Button
                    type="button"
                    size="sm"
                    disabled={curated.phase === 'busy'}
                    onClick={() => {
                      setFeaturedConfirming({
                        package: item.package,
                        displayName: item.displayName,
                        whyIncluded: item.whyIncluded,
                      })
                    }}
                  >
                    {t('marketFeaturedInstall')}
                  </Button>
                </article>
              ))}
            </div>
          </>
        )}
      </section>

      <Modal
        open={featuredConfirming !== null}
        onClose={() => { setFeaturedConfirming(null) }}
        closeLabel={t('close')}
        title={featuredConfirming === null ? '' : t('marketFeaturedConfirmTitle', { name: featuredConfirming.displayName })}
        description={t('marketFeaturedConfirmIntro')}
        footer={featuredConfirming === null ? null : (
          <>
            <Button variant="outline" onClick={() => { setFeaturedConfirming(null) }}>{t('marketImportCancel')}</Button>
            <Button
              variant="primary"
              disabled={featuredAcknowledging !== true}
              onClick={() => { installFeaturedNow(featuredConfirming.package) }}
            >
              {t('marketImportConfirmAction')}
            </Button>
          </>
        )}
      >
        {featuredConfirming === null ? null : (
          <div className={css.featuredConfirm}>
            <p><code>{featuredConfirming.package}</code></p>
            <p>{featuredConfirming.whyIncluded}</p>
            <label className={css.featuredConfirmRow}>
              <input
                type="checkbox"
                checked={featuredAcknowledging}
                onChange={(event) => { setFeaturedAcknowledging(event.currentTarget.checked) }}
              />
              <span>{t('curatedAcknowledge')}</span>
            </label>
          </div>
        )}
      </Modal>

      <section className={css.custom} aria-labelledby="curated-bundle-title">
        <div className={css.sectionHeading}>
          <h4 id="curated-bundle-title">{t('curatedTitle')}</h4>
          <p>{t('curatedDescription')}</p>
        </div>
        {curated.phase === 'loading' ? <p className={css.status}>{t('curatedChecking')}</p> : (
          <>
            <p className={css.quickConfig}>
              {curated.phase === 'ready'
                ? (curated.status.installed
                  ? (curated.status.version === undefined
                    ? t('curatedInstalled')
                    : `${t('curatedInstalled')} · v${curated.status.version}`)
                  : t('curatedNotInstalled'))
                : curated.phase === 'busy'
                  ? t('curatedBusy')
                  : curated.installed
                    ? t('curatedInstalled')
                    : t('curatedNotInstalled')}
            </p>
            {curated.phase === 'done' && curated.ok ? (
              <p className={css.status} role="status">{t('curatedRestartRequired')}</p>
            ) : null}
            {curated.phase === 'done' && !curated.ok ? (
              <p className={css.validationError} role="alert">
                {t('curatedFailed')}
                {curated.detail === undefined ? '' : `: ${curated.detail}`}
              </p>
            ) : null}
            {curated.phase !== 'ready' || !curated.status.installed ? (
              <label className={css.customForm}>
                <input
                  type="checkbox"
                  checked={curatedAcknowledged}
                  disabled={curated.phase === 'busy'}
                  onChange={(event) => { setCuratedAcknowledged(event.currentTarget.checked) }}
                />
                <span>{t('curatedAcknowledge')}</span>
              </label>
            ) : null}
            <div className={css.cardHead}>
              {curated.phase === 'ready' && curated.status.installed ? (
                <button
                  type="button"
                  disabled={false}
                  onClick={() => { runCurated('uninstall') }}
                >
                  {t('curatedUninstall')}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={curated.phase !== 'ready' || !curatedAcknowledged}
                  onClick={() => { runCurated('install') }}
                >
                  {curated.phase === 'busy' ? t('curatedBusyAction') : t('curatedInstall')}
                </button>
              )}
              <a
                className={css.sourceLink}
                href="https://github.com/zhu1090093659/dsh-web-ui"
                target="_blank"
                rel="noopener noreferrer"
              >
                {t('curatedSource')}
              </a>
            </div>
          </>
        )}
      </section>

      {warning !== undefined ? <p className={css.catalogWarning} role="status">{t(warning)}</p> : null}
      {validationError !== undefined ? <p className={css.validationError} role="alert">{validationError}</p> : null}
      {state.status === 'error' ? (
        <div className={css.failure}>
          <p role="alert">{t('marketError')}</p>
          <button type="button" onClick={() => { setRefresh(value => value + 1) }}>{t('retry')}</button>
        </div>
      ) : null}

      <label className={css.search}>
        <IconSearchOutline16 aria-hidden="true" />
        <span className={css.visuallyHidden}>{t('marketSearch')}</span>
        <input
          type="search"
          value={query}
          placeholder={t('marketSearch')}
          aria-label={t('marketSearch')}
          onChange={(event) => { setQuery(event.currentTarget.value) }}
        />
      </label>

      <div className={css.categoryTabs} role="tablist" aria-label={t('marketCategories')}>
        {CATEGORIES.map(value => (
          <button
            type="button"
            role="tab"
            key={value}
            aria-selected={category === value}
            data-selected={category === value ? 'true' : undefined}
            onClick={() => { setCategory(value) }}
          >
            {t(CATEGORY_KEYS[value])}
          </button>
        ))}
      </div>

      {state.status === 'loading' ? <p className={css.status}>{t('marketLoading')}</p> : null}
      {state.status === 'ready' && items.length === 0 ? (
        <p className={css.status}>{query.trim().length > 0 ? t('marketEmptySearch') : t('marketEmptyCategory')}</p>
      ) : null}
      {state.status === 'ready' && items.length > 0 ? (
        <ul className={css.cards}>
          {items.map(item => (
            <li className={css.card} key={item.id} data-market-entry={item.id}>
              <div className={css.cardHead}>
                <div>
                  <strong>{item.name}</strong>
                  <span>{t(CATEGORY_KEYS[item.category])}</span>
                </div>
                {item.installability === 'unknown' ? (
                  <button
                    className={css.validateButton}
                    type="button"
                    disabled={validatingId !== undefined}
                    onClick={() => { validate(item) }}
                  >
                    {validatingId === item.id ? t('marketValidating') : t('marketValidate')}
                  </button>
                ) : (
                  <button
                    className={css.importButton}
                    type="button"
                    disabled={item.installability !== 'validated'}
                    onClick={() => { startImport(item) }}
                    title={item.installability !== 'validated' ? t('marketImportInvalid') : t('marketImportReady')}
                  >
                    <IconDownloadOutline16 aria-hidden="true" />
                    {item.installability === 'validated' ? t('marketImportReady') : t('marketImportInvalid')}
                  </button>
                )}
              </div>
              {item.description !== undefined ? <p className={css.description}>{item.description}</p> : null}
              <dl className={css.metadata}>
                <div><dt>{t('marketSource')}</dt><dd>{item.sourceRef}</dd></div>
                <div><dt>{t('marketUpdated')}</dt><dd>{formatDate(item.updatedAt)}</dd></div>
                <div><dt>{t('marketStars')}</dt><dd>{compactStars(item.stars)}</dd></div>
                <div><dt>{t('marketLicense')}</dt><dd>{item.license ?? t('marketUnknown')}</dd></div>
              </dl>
              <a className={css.sourceLink} href={item.sourceUrl} target="_blank" rel="noopener noreferrer">
                <IconLinkOutline16 aria-hidden="true" />
                {t('marketOpenSource')}
              </a>
              <div className={css.verification} data-verified={item.verifiedSource === undefined ? 'false' : 'true'}>
                <strong>{item.verifiedSource === undefined ? t('marketUnverifiedSource') : t('marketVerifiedSource')}</strong>
                <span>{item.verifiedSource?.source ?? item.discoveredFrom.source}</span>
              </div>
              <div className={css.compatibility} data-status={item.installability}>
                <strong>{t(item.installability === 'validated'
                  ? 'marketCompatibilityValidated'
                  : item.installability === 'invalid'
                    ? 'marketCompatibilityInvalid'
                    : 'marketCompatibilityUnknown')}</strong>
                {item.validation !== undefined ? (
                  <span>
                    {item.validation.packageName ?? item.name} · {item.validation.commitSha.slice(0, 8)}
                    {item.validation.patchPath === undefined ? '' : ` · ${item.validation.patchPath}`}
                  </span>
                ) : item.validationFailure === undefined ? null : <span>{t(VALIDATION_FAILURE_KEYS[item.validationFailure])}</span>}
              </div>
              {item.quickConfig !== undefined && item.verifiedSource !== undefined ? (
                <p className={css.quickConfig}>
                  {t('marketQuickConfigAvailable')}: <code>{item.quickConfig.settingsNamespace}</code>
                </p>
              ) : null}
              <div className={css.riskNote}>
                <IconWarningOutline16 aria-hidden="true" />
                <span>{t('marketRiskPreview')}</span>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <Modal
        open={importPreview.kind === 'preview' || importPreview.kind === 'installing'}
        onClose={cancelImport}
        closeLabel={t('close')}
        title={t('marketImportConfirmTitle')}
        description={t('marketImportConfirmIntro')}
        footer={importPreview.kind === 'preview' ? (
          <>
            <Button variant="outline" onClick={cancelImport}>{t('marketImportCancel')}</Button>
            <Button
              variant="primary"
              disabled={!importAcknowledged}
              onClick={() => { runConfirmImport() }}
            >
              {t('marketImportConfirmAction')}
            </Button>
          </>
        ) : (
          <Button variant="outline" onClick={cancelImport} disabled>{t('marketImportRunning')}</Button>
        )}
      >
        {importPreview.kind === 'preview' ? (
          <div className={css.importPreview}>
            <pre><code>{importPreview.preview.command.args.join(' ')}</code></pre>
            <p className={css.importSource}>
              {t('marketImportConfirmSource')}: <code>{importPreview.preview.sourceRef}</code>
            </p>
            <a
              className={css.importSourceLink}
              href={`https://github.com/search?q=${encodeURIComponent(importPreview.preview.sourceRef)}&type=repositories`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t('marketImportConfirmSearch')}
            </a>
            <ul className={css.importRisks}>
              {importPreview.preview.risks.map((risk, i) => (<li key={i}>{risk}</li>))}
            </ul>
            <label className={css.importConfirmRow}>
              <input
                type="checkbox"
                checked={importAcknowledged}
                onChange={(event) => { setImportAcknowledged(event.currentTarget.checked) }}
              />
              <span>{t('marketImportAcknowledge')}</span>
            </label>
          </div>
        ) : null}
        {importPreview.kind === 'installing' ? (
          <p className={css.importStatus}>{t('marketImportRunningBody', { ref: importPreview.sourceRef })}</p>
        ) : null}
      </Modal>

      <Modal
        open={importPreview.kind === 'done'}
        onClose={cancelImport}
        closeLabel={t('close')}
        title={importPreview.kind === 'done' && importPreview.ok ? t('marketImportSuccessTitle') : t('marketImportFailureTitle')}
        description={importPreview.kind === 'done' && importPreview.ok
          ? t('marketImportSuccessBody', { ref: importPreview.sourceRef })
          : importPreview.kind === 'done'
            ? t('marketImportFailureBody', { ref: importPreview.sourceRef })
            : ''}
        footer={(
          <Button variant="primary" onClick={cancelImport}>{t('close')}</Button>
        )}
      >
        {importPreview.kind === 'done' && importPreview.tail !== '' ? (
          <pre className={css.importTail}><code>{importPreview.tail}</code></pre>
        ) : null}
      </Modal>

      {showOffers ? (
        <>
          <section className={css.offers} aria-labelledby="official-offers-title">
            <div className={css.sectionHeading}>
              <h4 id="official-offers-title">{t('marketPublicOffers')}</h4>
              <p>{t('marketPublicOffersIntro')}</p>
            </div>
            {publicOffers.length === 0 ? <p className={css.partnerEmpty}>{t('marketPublicOffersEmpty')}</p> : (
              <ul className={css.offerCards}>
                {publicOffers.map(offer => (
                  <li key={offer.id}>
                    <div><strong>{offer.provider}</strong><span>{formatDate(offer.lastVerified)}</span></div>
                    <h5>{offer.title}</h5>
                    <p>{offer.summary}</p>
                    <dl>
                      <div>
                        <dt>{t('marketEvidence')}</dt>
                        <dd><a href={offer.source} target="_blank" rel="noopener noreferrer">{t('marketVerifiedSource')}</a></dd>
                      </div>
                      <div><dt>{t('marketEligibility')}</dt><dd>{offer.eligibility}</dd></div>
                      <div><dt>{t('marketTerms')}</dt><dd>{offer.terms}</dd></div>
                    </dl>
                    <a href={offer.applyUrl} target="_blank" rel="noopener noreferrer">{t('marketViewOfficialOffer')}</a>
                    <small>{t('marketPublicOfferDisclaimer')}</small>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={css.offers} aria-labelledby="verified-partners-title">
            <div className={css.sectionHeading}>
              <h4 id="verified-partners-title">{t('marketPartners')}</h4>
              <p>{t('marketPartnersIntro')}</p>
            </div>
            {partnerships.length === 0 ? <p className={css.partnerEmpty}>{t('marketPartnersEmpty')}</p> : (
              <ul className={css.offerCards}>
                {partnerships.map(({ item, offer }) => (
                  <li key={`${item.id}:${offer.kind}:${offer.url}`}>
                    <div><strong>{item.name}</strong><span>{formatDate(offer.lastVerified)}</span></div>
                    <h5>{offer.label}</h5>
                    <p>{offer.eligibility}</p>
                    <p>{offer.terms}</p>
                    <a href={offer.source} target="_blank" rel="noopener noreferrer">{t('marketEvidence')}</a>
                    <a href={offer.url} target="_blank" rel="noopener noreferrer">{t('marketApplyQuota')}</a>
                    <small>{t('marketQuotaDisclaimer')}</small>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}

      <section className={css.custom} aria-labelledby="custom-import-title">
        <div className={css.sectionHeading}>
          <h4 id="custom-import-title">{t('marketCustomTitle')}</h4>
          <p>{t('marketCustomIntro')}</p>
        </div>
        <div className={css.customKinds} role="group" aria-label={t('marketCustomSource')}>
          {(['github', 'npm', 'local'] as const).map(kind => (
            <button
              key={kind}
              type="button"
              data-selected={customKind === kind ? 'true' : undefined}
              aria-pressed={customKind === kind}
              onClick={() => { setCustomKind(kind); setCustomSource('') }}
            >
              {kind === 'local'
                ? <IconFolderOpenOutline16 aria-hidden="true" />
                : kind === 'github'
                  ? <IconLinkOutline16 aria-hidden="true" />
                  : <IconPlusOutline16 aria-hidden="true" />}
              {t(CUSTOM_SOURCE_KEYS[kind])}
            </button>
          ))}
        </div>
        <div className={css.customForm}>
          <label>
            <span>{t(CUSTOM_SOURCE_KEYS[customKind])}</span>
            <input
              value={customSource}
              placeholder={t(PLACEHOLDER_KEYS[customKind])}
              onChange={(event) => { setCustomSource(event.currentTarget.value) }}
            />
          </label>
          <button type="button" disabled title={t('marketInstallDisabled')}>
            {t('marketReviewImport')}
          </button>
        </div>
        <div className={css.importGate}>
          <IconWarningOutline16 aria-hidden="true" />
          <div>
            <strong>{t('marketInstallDisabledTitle')}</strong>
            <p>{t('marketInstallDisabled')}</p>
            <ul>
              <li>{t('marketRiskThirdPartyCode')}</li>
              <li>{t('marketRiskInstallScripts')}</li>
              <li>{t('marketRiskNetworkAccess')}</li>
              <li>{t(customKind === 'local' ? 'marketRiskLocalFilesystem' : 'marketRiskUnverifiedSource')}</li>
              <li>{t('marketRiskRestart')}</li>
            </ul>
          </div>
        </div>
      </section>

      {links !== undefined && links.template.files.length > 0 ? (
        <section className={css.starter} aria-labelledby="plugin-starter-title">
          <div className={css.sectionHeading}>
            <h4 id="plugin-starter-title">{t('marketStarterTitle')}</h4>
            <p>{t('marketStarterIntro')}</p>
          </div>
          <div className={css.templateFiles}>
            {links.template.files.map((file) => {
              const copied = templateCopy?.path === file.path && templateCopy.status === 'copied'
              return (
                <article className={css.templateFile} key={file.path} data-template-file={file.path}>
                  <div>
                    <code>{file.path}</code>
                    <button
                      type="button"
                      aria-label={`${copied ? t('marketStarterCopied') : t('marketStarterCopy')} ${file.path}`}
                      onClick={() => { copyTemplateFile(file) }}
                    >
                      {copied
                        ? <IconCheckOutline16 aria-hidden="true" />
                        : <IconCopyOutline16 aria-hidden="true" />}
                      {copied ? t('marketStarterCopied') : t('marketStarterCopy')}
                    </button>
                  </div>
                  <pre><code>{file.content}</code></pre>
                </article>
              )
            })}
          </div>
          <p className={css.copyStatus} aria-live="polite">
            {templateCopy?.status === 'copied'
              ? `${templateCopy.path}: ${t('marketStarterCopied')}`
              : ''}
          </p>
          {templateCopy?.status === 'error' ? (
            <p className={css.templateError} role="alert">{t('marketStarterCopyError')}</p>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}
