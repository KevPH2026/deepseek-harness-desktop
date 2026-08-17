/**
 * Cached third-party plugin discovery and explicit, non-executing import planning.
 * @module @deepseek-ai/dsh-host-plugin-marketplace
 */

import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
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
  PluginMarketplaceConfirmImportErrorCode,
  PluginMarketplaceConfirmImportRequest,
  PluginMarketplaceConfirmImportResult,
  PluginMarketplaceCuratedBundleResult,
  PluginMarketplaceCuratedBundleStatus,
  PluginMarketplaceImportPreview,
  PluginMarketplaceImportReceipt,
  PluginMarketplaceInstallCuratedBundleRequest,
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

/**
 * The curated community bundle the desktop offers as a first-class
 * integration: dsh-web-ui by @linxin666 (Apache-2.0), installed as its
 * aggregate package, with the desktop-excluded members disabled through the
 * profile's own patch layer. Kept: git graph, the right-side panel, the whale
 * pet, skin center with the skin collection, image understanding, the
 * liangshen preset, and the bundle's own settings page. Disabled: SSH ops,
 * the task board, mobile remote, and live token estimation. Curated means a
 * fixed package name and a fixed disable list; every other marketplace
 * installation path stays fail-closed.
 */
export const CURATED_BUNDLE_PACKAGE = '@linxin666/dsh-web-ui-all'
/** Aggregate patch-row ids the desktop edition disables after installing. */
export const CURATED_BUNDLE_DISABLED_IDS: readonly string[] = [
  'ui-task-board',
  'ssh',
  'remote-web-ui',
  'live-stats',
]
/**
 * Standalone member packages from earlier curated installs; removed during
 * install so the aggregate remains the single composition source.
 */
export const CURATED_BUNDLE_LEGACY_MEMBERS: readonly string[] = [
  '@linxin666/dsh-client-ui-git-graph',
  '@linxin666/dsh-client-ui-aionui-panel',
  '@linxin666/dsh-pet',
  '@linxin666/dsh-client-ui-web-ui-settings',
  '@linxin666/dsh-skins',
  '@linxin666/dsh-client-ui-skin-center',
  '@linxin666/dsh-tool-describe-image',
  '@linxin666/dsh-liangshen',
]
/** Marker comments bracketing the managed disable section in the profile patch. */
export const CURATED_DISABLE_BEGIN = '# BEGIN dsh-desktop curated pack disables'
export const CURATED_DISABLE_END = '# END dsh-desktop curated pack disables'
/** Native packages whose install scripts the curated aggregate may need. */
export const CURATED_BUNDLE_ALLOW_BUILDS: readonly string[] = ['cloudflared', 'cpu-features', 'ssh2']

/**
 * Insert (idempotently) the managed disable section into a profile patch.
 * @param source - Current `cordis.patch.yml` text.
 * @returns Text containing exactly one managed section disabling the curated ids.
 */
export function withCuratedDisableSection(source: string): string {
  const stripped = withoutCuratedDisableSection(source)
  const lines = [
    CURATED_DISABLE_BEGIN,
    ...CURATED_BUNDLE_DISABLED_IDS.map(id => `- id: ${id}\n  disabled: true`),
    CURATED_DISABLE_END,
  ]
  const joined = stripped.trimEnd()
  // The profile patch loader parses each `---`-separated YAML document as its
  // own list. Always start the managed section with `---` so the loader
  // sees it as a separate document even when the user-authored portion is
  // already a complete list, otherwise the parser throws "end of the
  // stream or a document separator is expected" and the runtime fails to
  // start.
  const separator = joined === '' ? '---' : '\n\n---\n\n'
  return `${joined}${separator}${lines.join('\n')}\n`
}

/**
 * Remove the managed disable section from a profile patch, leaving any
 * user-authored content untouched.
 * @param source - Current `cordis.patch.yml` text.
 * @returns Text without the managed section.
 */
export function withoutCuratedDisableSection(source: string): string {
  const begin = source.indexOf(CURATED_DISABLE_BEGIN)
  if (begin < 0) return source
  const end = source.indexOf(CURATED_DISABLE_END)
  if (end < 0) return source.slice(0, begin)
  return source.slice(0, begin) + source.slice(end + CURATED_DISABLE_END.length)
}
/** Bounded characters of CLI output retained for the local error UI. */
const CURATED_DETAIL_LIMIT = 600

/**
 * Idempotently rewrite a profile `pnpm-workspace.yaml` so every curated native
 * package is build-approved (`pkg: true`). Handles the CLI's own placeholder
 * hint (`set this to true or false`) and a missing `allowBuilds` block.
 * @param source - Current workspace file text.
 * @param packages - Native packages to approve.
 * @returns The rewritten text, or the original when nothing needed changing.
 */
export function allowBuildsRewritten(source: string, packages: readonly string[]): string {
  const lines = source.split('\n')
  let blockStart = -1
  let blockEnd = -1
  for (let index = 0; index < lines.length; index += 1) {
    const header = lines[index]
    if (header === undefined || !/^allowBuilds:\s*$/u.test(header)) continue
    blockStart = index
    blockEnd = index
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const line = lines[cursor]
      if (line === undefined) break
      if (/^\S/u.test(line)) break
      if (line.trim() !== '') blockEnd = cursor
    }
    break
  }
  const missing = new Set(packages)
  if (blockStart >= 0) {
    for (let cursor = blockStart; cursor <= blockEnd; cursor += 1) {
      const line = lines[cursor]
      if (line === undefined) continue
      const match = /^\s+([^:#]+):\s*(.*)$/u.exec(line)
      if (match === null || match[1] === undefined) continue
      const name = match[1].trim()
      if (!missing.has(name)) continue
      missing.delete(name)
      if (match[2] !== 'true') {
        lines[cursor] = line.replace(/:\s*.*$/u, ': true')
      }
    }
  }
  if (missing.size === 0) return lines.join('\n') === source ? source : lines.join('\n')
  const additions = [...missing].map(name => `  ${name}: true`)
  if (blockStart < 0) {
    const joined = lines.join('\n')
    const separator = joined.endsWith('\n') ? '' : '\n'
    return `${joined}${separator}allowBuilds:\n${additions.join('\n')}\n`
  }
  lines.splice(blockEnd + 1, 0, ...additions)
  return lines.join('\n')
}

/** Resolve the Harness home the same way the CLI does: $DSH_HOME or ~/.dsh, with `~` expansion. */
export function resolveHarnessHome(): string {
  const fromEnv = process.env.DSH_HOME
  const selected = fromEnv !== undefined && fromEnv.trim().length > 0
    ? fromEnv
    : join(homedir(), '.dsh')
  const expanded = selected === '~' || selected.startsWith('~/')
    ? join(homedir(), selected.slice(1))
    : selected
  return resolve(expanded)
}

/** Strip ANSI escapes and control bytes, then keep the bounded tail. */
export function sanitizeCliOutput(output: string): string {
  const plain = output
    .replace(/\u001B\[[0-9;?]*[A-Za-z]/gu, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/gu, '')
  return plain.slice(-CURATED_DETAIL_LIMIT).trim()
}

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
  /** Maximum milliseconds allowed for one curated bundle install or uninstall. */
  readonly curatedInstallTimeoutMs: number
}

/** Test-only seams; production uses native fetch, time, and UUID generation. */
interface Dependencies {
  readonly fetcher?: typeof fetch
  readonly now?: () => number
  readonly randomId?: () => string
  /** Curated-bundle seam: profile directory resolver, overridable in tests. */
  readonly curatedProfileDir?: () => string
  /** Curated-bundle seam: CLI runner, overridable in tests. */
  readonly runCuratedCli?: (args: readonly string[]) => Promise<{ readonly code: number; readonly tail: string }>
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
    curatedInstallTimeoutMs: s.number().step(1).min(30_000).default(10 * 60_000),
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
  private curatedOperation: Promise<PluginMarketplaceCuratedBundleResult> | undefined
  private readonly curatedProfileDir: () => string
  private readonly runCuratedCli: (args: readonly string[]) => Promise<{ readonly code: number; readonly tail: string }>

  constructor(
    ctx: Context,
    private readonly config: Config,
    dependencies: Dependencies = {},
  ) {
    super(ctx, 'pluginMarketplace')
    this.fetcher = dependencies.fetcher ?? globalThis.fetch
    this.clock = dependencies.now ?? Date.now
    this.randomId = dependencies.randomId ?? randomUUID
    this.curatedProfileDir = dependencies.curatedProfileDir
      ?? (() => join(resolveHarnessHome(), 'profiles', PROFILE))
    this.runCuratedCli = dependencies.runCuratedCli
      ?? ((args: readonly string[]) => this.spawnCuratedCli(args))
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
  async confirmImport(request: PluginMarketplaceConfirmImportRequest): Promise<PluginMarketplaceConfirmImportResult> {
    if ((this as unknown as { stopping: boolean }).stopping) return this.confirmFailure('command-unavailable', 'Plugin marketplace is stopping')
    const confirmation = this.confirmations.get(request.confirmationId)
    if (confirmation === undefined) return this.confirmFailure('confirmation-not-found', 'No matching prepared import')
    this.confirmations.delete(request.confirmationId)
    const source = confirmation.source
    if (source.sourceRef.trim() === '' || source.sourceRef.startsWith('-')) {
      return this.confirmFailure('install-failed', `Refused source ref "${ '${source.sourceRef}' }"`)
    }
    const outcome = await this.spawnImportCli(['plugin', '--profile', PROFILE, 'add', source.sourceRef])
    const receipt: PluginMarketplaceImportReceipt = Object.freeze({
      status: 'installed',
      profile: PROFILE,
      sourceRef: source.sourceRef,
      restartRequired: true,
      stdoutTail: outcome.tail,
      stderrTail: outcome.tail,
    })
    if (outcome.code !== 0) {
      return this.confirmFailure(
        'install-failed',
        `dsh plugin add exited with code ${String(outcome.code)}`,
        outcome.code,
        outcome.tail,
      )
    }
    return Object.freeze({ ok: true, value: receipt })
  }

  /** Invoke the running binary for a one-off marketplace import invocation. */
  private async spawnImportCli(args: readonly string[]): Promise<{ readonly code: number; readonly tail: string }> {
    const entry = process.argv[1]
    if (entry === undefined || !/bin\.(js|mjs|cjs|ts)$/u.test(entry)) {
      return { code: -1, tail: 'dsh CLI entry not found' }
    }
    return await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [entry, ...args], {
        cwd: resolveHarnessHome(),
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let output = ''
      child.stdout.on('data', (chunk: Buffer) => { output = (output + chunk.toString('utf8')).slice(-4_000) })
      child.stderr.on('data', (chunk: Buffer) => { output = (output + chunk.toString('utf8')).slice(-4_000) })
      child.once('error', (error: Error) => reject(error))
      child.once('close', (code: number | null) => resolve({ code: code ?? -1, tail: sanitizeCliOutput(output) }))
    })
  }

  private confirmFailure(
    code: Exclude<PluginMarketplaceConfirmImportErrorCode, 'installation-disabled'>,
    message: string,
    exitCode: number | null = null,
    stdoutTail: string = '',
  ): PluginMarketplaceConfirmImportResult {
    return Object.freeze({ ok: false, error: Object.freeze({ code, message, exitCode, stdoutTail }) })
  }

  /**
   * Return copy-only starter content and official documentation links.
   * @returns immutable links and starter-template files with no write side effect.
   */
  @Remote('resources')
  resources(): PluginMarketplaceResources {
    return PLUGIN_MARKETPLACE_RESOURCES
  }

  /**
   * Report whether the curated community bundle is present in the web profile.
   * @returns Package name, installed flag, and installed version when present.
   */
  @Remote('curatedBundleStatus')
  async curatedBundleStatus(): Promise<PluginMarketplaceCuratedBundleStatus> {
    return await this.readCuratedStatus()
  }

  /**
   * Install the curated community bundle after an explicit risk acknowledgement.
   * Approves only the bundle's known native build scripts, then runs the same
   * `dsh plugin add` flow a power user would type, bounded by a timeout.
   * @param request - Must carry `acknowledgedRisk: true` from the UI control.
   * @returns Result with `requiresRestart` on success; stable error code otherwise.
   */
  @Remote('installCuratedBundle')
  installCuratedBundle(
    request: PluginMarketplaceInstallCuratedBundleRequest,
  ): Promise<PluginMarketplaceCuratedBundleResult> {
    if (!request.acknowledgedRisk) {
      return Promise.resolve(this.curatedFailure(false, 'acknowledgement-required', undefined))
    }
    return this.serializeCurated(async () => {
      const dir = this.curatedProfileDir()
      try {
        await this.ensureCuratedAllowBuilds(dir)
      } catch {
        return this.curatedFailure(false, 'install-failed', 'could not update pnpm-workspace.yaml')
      }
      // Migrate earlier standalone-member installs away so the aggregate is
      // the single composition source. Only members actually present in the
      // manifest are removed: `plugin remove` of an absent package fails, and
      // skipping absent ones keeps the common path to one fast `add`.
      const legacyPresent = await this.readLegacyMembersPresent()
      for (const packageName of legacyPresent) {
        await this.runCuratedCli(['plugin', '--profile', PROFILE, 'remove', packageName])
      }
      const outcome = await this.runCuratedCli(['plugin', '--profile', PROFILE, 'add', CURATED_BUNDLE_PACKAGE])
      if (outcome.code !== 0) {
        const failed = await this.readCuratedStatus()
        return this.curatedFailure(failed.installed, 'install-failed', outcome.tail)
      }
      try {
        await this.writeProfilePatch(current => withCuratedDisableSection(current))
      } catch {
        const partial = await this.readCuratedStatus()
        return this.curatedFailure(partial.installed, 'install-failed', 'could not update cordis.patch.yml')
      }
      return {
        ok: true,
        installed: true,
        requiresRestart: true,
        errorCode: undefined,
        detail: undefined,
      }
    })
  }

  /**
   * Remove the curated community bundle from the web profile.
   * @returns Result with `requiresRestart` on success; stable error code otherwise.
   */
  @Remote('uninstallCuratedBundle')
  uninstallCuratedBundle(): Promise<PluginMarketplaceCuratedBundleResult> {
    return this.serializeCurated(async () => {
      const outcome = await this.runCuratedCli(['plugin', '--profile', PROFILE, 'remove', CURATED_BUNDLE_PACKAGE])
      try {
        await this.writeProfilePatch(current => withoutCuratedDisableSection(current))
      } catch {
        // The aggregate is already gone; a stale managed section is cosmetic.
      }
      const status = await this.readCuratedStatus()
      if (outcome.code !== 0 || status.installed) {
        return this.curatedFailure(status.installed, 'uninstall-failed', outcome.tail)
      }
      return {
        ok: true,
        installed: false,
        requiresRestart: true,
        errorCode: undefined,
        detail: undefined,
      }
    })
  }

  /** Serialize curated operations so concurrent clicks share one CLI run. */
  private serializeCurated(
    operation: () => Promise<PluginMarketplaceCuratedBundleResult>,
  ): Promise<PluginMarketplaceCuratedBundleResult> {
    if (this.curatedOperation !== undefined) return this.curatedOperation
    const run = operation().finally(() => {
      if (this.curatedOperation === run) this.curatedOperation = undefined
    })
    this.curatedOperation = run
    return run
  }

  private curatedFailure(
    installed: boolean,
    errorCode: NonNullable<PluginMarketplaceCuratedBundleResult['errorCode']>,
    detail: string | undefined,
  ): PluginMarketplaceCuratedBundleResult {
    return { ok: false, installed, requiresRestart: false, errorCode, detail: detail ?? undefined }
  }

  private async readCuratedStatus(): Promise<PluginMarketplaceCuratedBundleStatus> {
    let dependency = false
    try {
      const manifest = JSON.parse(await readFile(join(this.curatedProfileDir(), 'package.json'), 'utf8')) as {
        dependencies?: Record<string, unknown>
      }
      const range = manifest.dependencies?.[CURATED_BUNDLE_PACKAGE]
      dependency = typeof range === 'string' && range !== ''
    } catch {
      dependency = false
    }
    let disabled = false
    try {
      const patch = await readFile(join(this.curatedProfileDir(), 'cordis.patch.yml'), 'utf8')
      disabled = patch.includes(CURATED_DISABLE_BEGIN) && patch.includes(CURATED_DISABLE_END)
    } catch {
      disabled = false
    }
    const installed = dependency && disabled
    let version: string | undefined
    if (dependency) {
      try {
        const versioned = JSON.parse(await readFile(
          join(this.curatedProfileDir(), 'node_modules', CURATED_BUNDLE_PACKAGE, 'package.json'),
          'utf8',
        )) as { version?: unknown }
        version = typeof versioned.version === 'string' ? versioned.version : undefined
      } catch {
        version = undefined
      }
    }
    return { package: CURATED_BUNDLE_PACKAGE, installed, version }
  }

  /** List legacy standalone members that are still direct profile dependencies. */
  private async readLegacyMembersPresent(): Promise<readonly string[]> {
    try {
      const manifest = JSON.parse(await readFile(join(this.curatedProfileDir(), 'package.json'), 'utf8')) as {
        dependencies?: Record<string, unknown>
      }
      const dependencies = manifest.dependencies ?? {}
      return CURATED_BUNDLE_LEGACY_MEMBERS.filter(name => typeof dependencies[name] === 'string')
    } catch {
      return []
    }
  }

  /** Rewrite the profile patch through one read-modify-write under the serialized curated operation. */
  private async writeProfilePatch(rewrite: (current: string) => string): Promise<void> {
    const patchPath = join(this.curatedProfileDir(), 'cordis.patch.yml')
    let current = ''
    try {
      current = await readFile(patchPath, 'utf8')
    } catch {
      current = ''
    }
    const next = rewrite(current)
    if (next !== current) await writeFile(patchPath, next)
  }

  private async ensureCuratedAllowBuilds(profileDir: string): Promise<void> {
    const workspacePath = join(profileDir, 'pnpm-workspace.yaml')
    let source = ''
    try {
      source = await readFile(workspacePath, 'utf8')
    } catch {
      source = 'packages:\n  - .\n'
    }
    const rewritten = allowBuildsRewritten(source, CURATED_BUNDLE_ALLOW_BUILDS)
    if (rewritten !== source) await writeFile(workspacePath, rewritten)
  }

  /** Locate this runtime's own CLI entry (argv[1] is the running bin.js) and run it as a child. */
  private async spawnCuratedCli(args: readonly string[]): Promise<{ readonly code: number; readonly tail: string }> {
    const entry = process.argv[1]
    if (entry === undefined || !/bin\.(js|mjs|cjs|ts)$/u.test(entry)) {
      throw new Error('curated bundle: dsh CLI entry not found')
    }
    return await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [entry, ...args], {
        cwd: this.curatedProfileDir(),
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let output = ''
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
      }, this.config.curatedInstallTimeoutMs)
      child.stdout.on('data', (chunk: Buffer) => {
        output = (output + chunk.toString('utf8')).slice(-4_000)
      })
      child.stderr.on('data', (chunk: Buffer) => {
        output = (output + chunk.toString('utf8')).slice(-4_000)
      })
      child.once('error', (error: Error) => {
        clearTimeout(timer)
        reject(error)
      })
      child.once('close', (code: number | null) => {
        clearTimeout(timer)
        resolve({ code: code ?? -1, tail: sanitizeCliOutput(output) })
      })
    })
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
