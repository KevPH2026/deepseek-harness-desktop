/**
 * Cached third-party plugin discovery and explicit, non-executing import planning.
 * @module @deepseek-ai/dsh-host-plugin-marketplace
 */

import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import { fetchGithubCatalog, GithubCatalogError } from './catalog.ts'
import {
  ImportSourceError,
  normalizeImportSource,
  type NormalizedPluginImport,
} from './import-source.ts'
import {
  PLUGIN_MARKETPLACE_PUBLIC_OFFERS,
  PLUGIN_MARKETPLACE_RESOURCES,
} from './resources.ts'
import {
  pluginMarketplaceDomainSpec,
  type PluginMarketplaceCacheRow,
} from './spec.ts'
import { CatalogValidationError, validateGithubCatalogItem } from './validation.ts'
import type {
  PluginMarketplaceCatalogItem,
  PluginMarketplaceCatalogRequest,
  PluginMarketplaceCatalogSnapshot,
  PluginMarketplaceCatalogWarning,
  PluginMarketplaceConfirmationId,
  PluginMarketplaceConfirmImportRequest,
  PluginMarketplaceConfirmImportResult,
  PluginMarketplaceImportPreview,
  PluginMarketplacePrepareImportRequest,
  PluginMarketplacePrepareImportResult,
  PluginMarketplaceResources,
  PluginMarketplaceValidateCatalogItemRequest,
  PluginMarketplaceValidateCatalogItemResult,
} from './types.ts'

export type * from './types.ts'
export {
  GITHUB_SEARCH_URL,
  GITHUB_TOPIC_URL,
  applyVerifiedCatalog,
  classifyPlugin,
  fetchGithubCatalog,
  GithubCatalogError,
} from './catalog.ts'
export { ImportSourceError, normalizeImportSource } from './import-source.ts'
export { PLUGIN_MARKETPLACE_PUBLIC_OFFERS, PLUGIN_MARKETPLACE_RESOURCES } from './resources.ts'
export { pluginMarketplaceDomainSpec } from './spec.ts'
export { CatalogValidationError, validateGithubCatalogItem } from './validation.ts'
export { VERIFIED_PLUGIN_CATALOG } from './verified-catalog.ts'

const CACHE_KEY = 'github-topic'
const PROFILE = 'web' as const

/** Deployment policy; all limits are Host-owned and never sent by the browser. */
export interface Config {
  /** Milliseconds that a successful GitHub check remains fresh. */
  readonly cacheTtlMs: number
  /** Minimum milliseconds between admitted catalog refresh attempts. */
  readonly minRefreshIntervalMs: number
  /** Maximum milliseconds allowed for one catalog request. */
  readonly requestTimeoutMs: number
  /** Maximum repositories requested and retained from GitHub search. */
  readonly maxResults: number
  /** Milliseconds that a prepared import confirmation remains usable. */
  readonly confirmationTtlMs: number
  /** Maximum unexpired import confirmations retained in memory. */
  readonly maxConfirmations: number
  /** Milliseconds that a pinned repository validation verdict remains reusable. */
  readonly validationTtlMs: number
  /** Minimum milliseconds between newly admitted repository validations. */
  readonly minValidationIntervalMs: number
  /** Maximum milliseconds allowed for one complete pinned validation. */
  readonly validationTimeoutMs: number
}

/** Test-only seams; production uses native fetch, time, and UUID generation. */
interface Dependencies {
  readonly fetcher?: typeof fetch
  readonly now?: () => number
  readonly randomId?: () => string
}

interface Confirmation {
  readonly source: NormalizedPluginImport
  readonly expiresAt: number
}

interface RefreshResult {
  readonly row?: PluginMarketplaceCacheRow
  readonly warning?: PluginMarketplaceCatalogWarning
  readonly networkUpdated: boolean
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    pluginMarketplace: PluginMarketplaceGateway
  }
}

/** Host Remote plus durable cache and preview-token authority. */
export class PluginMarketplaceGateway extends TypertRemoteService {
  static inject = ['storageDomain']

  static Config: s<Config> = s.object({
    cacheTtlMs: s.number().step(1).min(60_000).default(60 * 60_000),
    minRefreshIntervalMs: s.number().step(1).min(1_000).default(60_000),
    requestTimeoutMs: s.number().step(1).min(1_000).default(10_000),
    maxResults: s.number().step(1).min(1).max(100).default(100),
    confirmationTtlMs: s.number().step(1).min(10_000).default(5 * 60_000),
    maxConfirmations: s.number().step(1).min(1).max(100).default(20),
    validationTtlMs: s.number().step(1).min(60_000).default(24 * 60 * 60_000),
    minValidationIntervalMs: s.number().step(1).min(1_000).default(5_000),
    validationTimeoutMs: s.number().step(1).min(1_000).default(15_000),
  })

  private readonly fetcher: typeof fetch
  private readonly clock: () => number
  private readonly randomId: () => string
  private readonly confirmations = new Map<PluginMarketplaceConfirmationId, Confirmation>()
  private readonly lifecycleAbort = new AbortController()
  private table?: KvTable<string, PluginMarketplaceCacheRow>
  private refreshInFlight: Promise<RefreshResult> | undefined
  private lastRefreshAttemptAt = 0
  private validationInFlight: {
    readonly itemId: string
    readonly operation: Promise<PluginMarketplaceValidateCatalogItemResult>
  } | undefined
  private lastValidationAttemptAt = 0

  constructor(
    ctx: Context,
    private readonly config: Config,
    dependencies: Dependencies = {},
  ) {
    super(ctx, 'pluginMarketplace')
    this.fetcher = dependencies.fetcher ?? globalThis.fetch
    this.clock = dependencies.now ?? Date.now
    this.randomId = dependencies.randomId ?? randomUUID
  }

  /** Open and own the persistent topic cache. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(pluginMarketplaceDomainSpec)
    this.table = domain.table('catalog')
    this.ctx.effect(() => async () => {
      this.lifecycleAbort.abort(new Error('plugin marketplace disposed'))
      await Promise.allSettled([
        ...(this.refreshInFlight === undefined ? [] : [this.refreshInFlight]),
        ...(this.validationInFlight === undefined ? [] : [this.validationInFlight.operation]),
      ])
      await domain.close()
    }, 'plugin-marketplace.domainClose')
  }

  /**
   * Read and filter the cache, refreshing once when stale and policy permits.
   * @param request - optional server-side query, category, and refresh request.
   * @returns the bounded catalog view with freshness, cache, and warning metadata.
   */
  @Remote('catalog')
  async catalog(request: PluginMarketplaceCatalogRequest): Promise<PluginMarketplaceCatalogSnapshot> {
    const now = this.clock()
    let row = this.requireTable().get(CACHE_KEY)
    let warning: PluginMarketplaceCatalogWarning | undefined
    let networkUpdated = false
    const stale = row === undefined || now - row.checkedAt >= this.config.cacheTtlMs
    const rateLimitResetAt = row?.rateLimitResetAt ?? 0
    const admittedAt = Math.max(this.lastRefreshAttemptAt + this.config.minRefreshIntervalMs, rateLimitResetAt)
    if ((stale || request.refresh === true) && now >= admittedAt) {
      const refreshed = await this.refresh(row)
      row = refreshed.row
      warning = refreshed.warning
      networkUpdated = refreshed.networkUpdated
    } else if (request.refresh === true && now < admittedAt) {
      warning = 'rate-limited'
    }
    const items = this.filterItems(row?.items ?? [], request)
    const checkedAt = row?.checkedAt
    const isFresh = checkedAt !== undefined && this.clock() - checkedAt < this.config.cacheTtlMs
    const status = row === undefined || row.items.length === 0 ? 'empty' : isFresh ? 'fresh' : 'stale'
    const nextRefreshAt = Math.max(
      this.lastRefreshAttemptAt + this.config.minRefreshIntervalMs,
      row?.rateLimitResetAt ?? 0,
    )
    return Object.freeze({
      status,
      items: Object.freeze(items),
      publicOffers: PLUGIN_MARKETPLACE_PUBLIC_OFFERS,
      ...(row === undefined ? {} : { fetchedAt: row.fetchedAt, checkedAt: row.checkedAt }),
      fromCache: !networkUpdated,
      nextRefreshAt,
      ...(warning === undefined ? {} : { warning }),
    })
  }

  /**
   * Lazily validate one selected row at its default branch's current commit.
   * @param request - stable catalog item id selected by the user.
   * @returns the cached or newly persisted verdict, or an explicit admission failure.
   */
  @Remote('validateCatalogItem')
  validateCatalogItem(
    request: PluginMarketplaceValidateCatalogItemRequest,
  ): Promise<PluginMarketplaceValidateCatalogItemResult> {
    const itemId = request.itemId.trim().toLocaleLowerCase()
    const row = this.requireTable().get(CACHE_KEY)
    const item = row?.items.find(candidate => candidate.id === itemId)
    if (row === undefined || item === undefined) {
      return Promise.resolve({
        ok: false,
        error: { code: 'catalog-item-not-found', message: 'Catalog item is unavailable; refresh and try again' },
      })
    }
    const lastVerified = item.validation?.lastVerified
    if (lastVerified !== undefined
      && this.clock() - Date.parse(lastVerified) < this.config.validationTtlMs) {
      return Promise.resolve({ ok: true, value: item })
    }
    if (this.validationInFlight !== undefined) {
      if (this.validationInFlight.itemId === itemId) return this.validationInFlight.operation
      return Promise.resolve({
        ok: false,
        error: { code: 'validation-busy', message: 'Another selected plugin is being validated' },
      })
    }
    const now = this.clock()
    if (now < this.lastValidationAttemptAt + this.config.minValidationIntervalMs) {
      return Promise.resolve({
        ok: false,
        error: { code: 'validation-rate-limited', message: 'Plugin validation is rate-limited; retry shortly' },
      })
    }
    this.lastValidationAttemptAt = now
    const operation = this.performValidation(item).finally(() => {
      if (this.validationInFlight?.operation === operation) this.validationInFlight = undefined
    })
    this.validationInFlight = { itemId, operation }
    return operation
  }

  /**
   * Parse and risk-plan an import, minting one short-lived confirmation.
   * @param request - explicit source whose risks and command will be previewed.
   * @returns a non-executing preview or a source/admission error.
   */
  @Remote('prepareImport')
  async prepareImport(request: PluginMarketplacePrepareImportRequest): Promise<PluginMarketplacePrepareImportResult> {
    this.pruneConfirmations()
    if (this.confirmations.size >= this.config.maxConfirmations) {
      return {
        ok: false,
        error: { code: 'confirmation-capacity', message: 'Too many pending confirmations; wait for one to expire' },
      }
    }
    if (request.source.kind === 'catalog') {
      const validation = await this.validateCatalogItem({ itemId: request.source.itemId })
      if (!validation.ok) {
        return {
          ok: false,
          error: { code: 'catalog-item-unvalidated', message: validation.error.message },
        }
      }
      if (validation.value.installability === 'invalid') {
        return {
          ok: false,
          error: { code: 'catalog-item-invalid', message: 'Catalog item failed its pinned bundle validation' },
        }
      }
    }
    let source: NormalizedPluginImport
    try {
      source = await normalizeImportSource(
        request.source,
        this.requireTable().get(CACHE_KEY)?.items ?? [],
      )
    } catch (error) {
      if (error instanceof ImportSourceError) {
        return { ok: false, error: { code: error.code, message: error.message } }
      }
      throw error
    }
    const confirmationId = this.randomId() as PluginMarketplaceConfirmationId
    const expiresAt = this.clock() + this.config.confirmationTtlMs
    this.confirmations.set(confirmationId, { source, expiresAt })
    const value: PluginMarketplaceImportPreview = Object.freeze({
      confirmationId,
      expiresAt,
      profile: PROFILE,
      sourceKind: source.sourceKind,
      sourceRef: source.sourceRef,
      verification: source.verification,
      command: Object.freeze({
        program: 'dsh',
        args: Object.freeze(['plugin', '--profile', PROFILE, 'add', source.sourceRef]),
      }),
      risks: source.risks,
    })
    return { ok: true, value }
  }

  /**
   * Fail closed: this build intentionally contains no subprocess/install
   * implementation. A future change needs separate explicit authorization.
   * @param _request - acknowledged confirmation request that remains non-executable.
   * @returns the stable `installation-disabled` business result.
   */
  @Remote('confirmImport')
  confirmImport(_request: PluginMarketplaceConfirmImportRequest): PluginMarketplaceConfirmImportResult {
    return {
      ok: false,
      error: {
        code: 'installation-disabled',
        message: 'Plugin installation is disabled until third-party install-script risk is explicitly authorized',
      },
    }
  }

  /**
   * Return copy-only starter content and official documentation links.
   * @returns immutable links and starter-template files with no write side effect.
   */
  @Remote('resources')
  resources(): PluginMarketplaceResources {
    return PLUGIN_MARKETPLACE_RESOURCES
  }

  /** One serialized, conditional GitHub refresh shared by concurrent callers. */
  private refresh(previous: PluginMarketplaceCacheRow | undefined): Promise<RefreshResult> {
    if (this.refreshInFlight !== undefined) return this.refreshInFlight
    const operation = this.performRefresh(previous).finally(() => {
      if (this.refreshInFlight === operation) this.refreshInFlight = undefined
    })
    this.refreshInFlight = operation
    return operation
  }

  private async performRefresh(previous: PluginMarketplaceCacheRow | undefined): Promise<RefreshResult> {
    const attemptedAt = this.clock()
    this.lastRefreshAttemptAt = attemptedAt
    const timeout = AbortSignal.timeout(this.config.requestTimeoutMs)
    const signal = AbortSignal.any([timeout, this.lifecycleAbort.signal])
    try {
      const response = await fetchGithubCatalog(this.fetcher, {
        maxResults: this.config.maxResults,
        checkedAt: attemptedAt,
        ...(previous?.etag === undefined ? {} : { etag: previous.etag }),
        signal,
      })
      if (response.kind === 'not-modified') {
        if (previous === undefined) {
          return { warning: 'github-response-invalid', networkUpdated: false }
        }
        const items = previous.items.map((item: PluginMarketplaceCatalogItem) => Object.freeze({
          ...item,
          discoveredFrom: Object.freeze({
            ...item.discoveredFrom,
            lastVerified: new Date(attemptedAt).toISOString(),
          }),
        }))
        const row: PluginMarketplaceCacheRow = {
          ...previous,
          items,
          checkedAt: attemptedAt,
          ...(response.etag === undefined ? {} : { etag: response.etag }),
          ...(response.rateLimitResetAt === undefined
            ? previous.rateLimitResetAt === undefined ? {} : { rateLimitResetAt: previous.rateLimitResetAt }
            : { rateLimitResetAt: response.rateLimitResetAt }),
        }
        await this.requireTable().put(CACHE_KEY, row)
        return { row, networkUpdated: true }
      }
      const row: PluginMarketplaceCacheRow = {
        items: [...(response.items ?? [])],
        fetchedAt: attemptedAt,
        checkedAt: attemptedAt,
        ...(response.etag === undefined ? {} : { etag: response.etag }),
        ...(response.rateLimitRemaining === 0 && response.rateLimitResetAt !== undefined
          ? { rateLimitResetAt: response.rateLimitResetAt }
          : {}),
      }
      await this.requireTable().put(CACHE_KEY, row)
      return { row, networkUpdated: true }
    } catch (error) {
      if (error instanceof GithubCatalogError) {
        const warning = previous === undefined && error.warning === 'offline-cache'
          ? 'offline-no-cache'
          : error.warning
        const row = previous === undefined || error.retryAt === undefined
          ? previous
          : { ...previous, rateLimitResetAt: error.retryAt }
        if (row !== undefined && row !== previous) await this.requireTable().put(CACHE_KEY, row)
        return { ...(row === undefined ? {} : { row }), warning, networkUpdated: false }
      }
      const warning: PluginMarketplaceCatalogWarning = previous === undefined
        ? 'offline-no-cache'
        : 'offline-cache'
      return { ...(previous === undefined ? {} : { row: previous }), warning, networkUpdated: false }
    }
  }

  /** Resolve a commit and verify the root manifest/patch without executing it. */
  private async performValidation(
    item: PluginMarketplaceCatalogItem,
  ): Promise<PluginMarketplaceValidateCatalogItemResult> {
    const timeout = AbortSignal.timeout(this.config.validationTimeoutMs)
    const signal = AbortSignal.any([timeout, this.lifecycleAbort.signal])
    try {
      const verdict = await validateGithubCatalogItem(this.fetcher, item, this.clock(), signal)
      const row = this.requireTable().get(CACHE_KEY)
      if (row === undefined) {
        return {
          ok: false,
          error: { code: 'catalog-item-not-found', message: 'Catalog changed during validation' },
        }
      }
      const index = row.items.findIndex(candidate => candidate.id === item.id)
      const current = row.items[index]
      if (index < 0 || current === undefined) {
        return {
          ok: false,
          error: { code: 'catalog-item-not-found', message: 'Catalog item changed during validation' },
        }
      }
      const {
        installability: _installability,
        validation: _validation,
        validationFailure: _validationFailure,
        ...base
      } = current
      const merged: PluginMarketplaceCatalogItem = Object.freeze({
        ...base,
        installability: verdict.installability,
        ...(verdict.validation === undefined ? {} : { validation: verdict.validation }),
        ...(verdict.validationFailure === undefined ? {} : { validationFailure: verdict.validationFailure }),
      })
      const items = [...row.items]
      items[index] = merged
      await this.requireTable().put(CACHE_KEY, { ...row, items })
      return { ok: true, value: merged }
    } catch (error) {
      if (error instanceof CatalogValidationError) {
        return { ok: false, error: { code: error.code, message: error.message } }
      }
      return {
        ok: false,
        error: { code: 'validation-unavailable', message: 'Pinned plugin validation is temporarily unavailable' },
      }
    }
  }

  /** Server-side search/category filter over a bounded cache. */
  private filterItems(
    items: readonly PluginMarketplaceCatalogItem[],
    request: PluginMarketplaceCatalogRequest,
  ): PluginMarketplaceCatalogItem[] {
    const query = request.query?.trim().toLocaleLowerCase().slice(0, 200) ?? ''
    return items.filter((item) => {
      if (request.category !== undefined && item.category !== request.category) return false
      if (query === '') return true
      return [item.name, item.id, item.description ?? '', item.category]
        .some(value => value.toLocaleLowerCase().includes(query))
    })
  }

  private pruneConfirmations(): void {
    const now = this.clock()
    for (const [id, confirmation] of this.confirmations) {
      if (confirmation.expiresAt <= now) this.confirmations.delete(id)
    }
  }

  private requireTable(): KvTable<string, PluginMarketplaceCacheRow> {
    if (this.table === undefined) throw new Error('plugin-marketplace: cache domain is not initialized')
    return this.table
  }
}

export default PluginMarketplaceGateway
