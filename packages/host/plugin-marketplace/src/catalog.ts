/** GitHub topic discovery, deterministic classification, and curated overlay. */

import type {
  PluginMarketplaceCatalogItem,
  PluginMarketplaceCategory,
  PluginMarketplaceCatalogWarning,
} from './types.ts'
import {
  VERIFIED_PLUGIN_CATALOG,
  type VerifiedPluginCatalogEntry,
} from './verified-catalog.ts'

/** Public GitHub topic page used as the human-verifiable discovery source. */
export const GITHUB_TOPIC_URL = 'https://github.com/topics/dsh-plugin'
/** Fixed GitHub repository-search endpoint used for bounded topic discovery. */
export const GITHUB_SEARCH_URL = 'https://api.github.com/search/repositories'

interface GithubLicense {
  readonly spdx_id?: unknown
}

interface GithubRepository {
  readonly full_name?: unknown
  readonly name?: unknown
  readonly html_url?: unknown
  readonly description?: unknown
  readonly stargazers_count?: unknown
  readonly updated_at?: unknown
  readonly default_branch?: unknown
  readonly topics?: unknown
  readonly license?: GithubLicense | null
  readonly archived?: unknown
  readonly disabled?: unknown
}

interface GithubSearchResponse {
  readonly items?: unknown
}

/** A successful parsed response plus cache-relevant headers. */
export interface GithubCatalogResponse {
  readonly kind: 'updated' | 'not-modified'
  readonly items?: readonly PluginMarketplaceCatalogItem[]
  readonly etag?: string
  readonly rateLimitRemaining?: number
  readonly rateLimitResetAt?: number
}

/** One categorized keyword family, in precedence order. */
const CATEGORY_TERMS: ReadonlyArray<readonly [PluginMarketplaceCategory, readonly string[]]> = [
  ['model-provider', ['model-provider', 'llm-provider', 'model provider', 'llm provider', 'ai provider']],
  ['gateway', ['gateway', 'api-gateway', 'api gateway', 'proxy', 'router']],
  ['design', ['design', 'ui', 'ux', 'frontend', 'figma']],
  ['writing', ['writing', 'writer', 'content', 'markdown', 'documentation']],
  ['coding', ['coding', 'code', 'developer-tools', 'developer tools', 'devtools', 'programming']],
]

/**
 * Assign a deterministic best-effort category from public repository metadata.
 * @param name - repository name included in the text match.
 * @param description - optional repository description included in the text match.
 * @param topics - public GitHub topics checked before free-text terms.
 * @returns the first matching category in precedence order, or `other`.
 */
export function classifyPlugin(
  name: string,
  description: string | undefined,
  topics: readonly string[],
): PluginMarketplaceCategory {
  const topicSet = new Set(topics.map(topic => topic.toLocaleLowerCase()))
  const prose = `${name} ${description ?? ''}`.toLocaleLowerCase()
  for (const [category, terms] of CATEGORY_TERMS) {
    if (terms.some(term => topicSet.has(term) || prose.includes(term))) return category
  }
  return 'other'
}

/** Whether a string is a valid absolute HTTPS URL suitable for a user-facing source. */
function validHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

/** Require review metadata to remain independently inspectable. */
function assertVerifiedEntry(entry: VerifiedPluginCatalogEntry): void {
  if (entry.repository !== entry.repository.toLocaleLowerCase()) {
    throw new TypeError(`plugin-marketplace: verified repository must be lower-case: ${entry.repository}`)
  }
  const evidence = [entry.verifiedSource, entry.quickConfig, ...entry.partnerOffers]
    .filter(value => value !== undefined)
  for (const item of evidence) {
    if (!validHttpsUrl(item.source) || Number.isNaN(Date.parse(item.lastVerified))) {
      throw new TypeError(`plugin-marketplace: unverifiable catalog metadata for ${entry.repository}`)
    }
  }
  for (const offer of entry.partnerOffers) {
    if (!validHttpsUrl(offer.url) || offer.terms.trim() === '' || offer.eligibility.trim() === '') {
      throw new TypeError(`plugin-marketplace: incomplete partner offer for ${entry.repository}`)
    }
  }
}

/**
 * Apply only reviewed, source-backed metadata to a topic discovery row.
 * @param item - untrusted topic-discovery row to augment.
 * @param catalog - reviewed entries eligible to override category metadata.
 * @returns the original row when unmatched, otherwise a frozen reviewed overlay.
 */
export function applyVerifiedCatalog(
  item: PluginMarketplaceCatalogItem,
  catalog: readonly VerifiedPluginCatalogEntry[] = VERIFIED_PLUGIN_CATALOG,
): PluginMarketplaceCatalogItem {
  const entry = catalog.find(candidate => candidate.repository === item.id)
  if (entry === undefined) return item
  assertVerifiedEntry(entry)
  return Object.freeze({
    ...item,
    category: entry.category,
    categorySource: 'verified-catalog' as const,
    verifiedSource: entry.verifiedSource,
    ...(entry.quickConfig === undefined ? {} : { quickConfig: entry.quickConfig }),
    partnerOffers: Object.freeze([...entry.partnerOffers]),
  })
}

/** Parse a GitHub ISO timestamp without accepting malformed response data. */
function githubTimestamp(value: unknown): string | undefined {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return undefined
  return value
}

/** Parse one repository row, ignoring disabled/archived and malformed entries. */
function githubItem(raw: unknown, checkedAt: number): PluginMarketplaceCatalogItem | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const repo = raw as GithubRepository
  if (repo.archived === true || repo.disabled === true) return undefined
  if (typeof repo.full_name !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo.full_name)) return undefined
  if (typeof repo.name !== 'string' || repo.name.length === 0) return undefined
  if (typeof repo.html_url !== 'string' || !validHttpsUrl(repo.html_url)) return undefined
  if (typeof repo.default_branch !== 'string' || repo.default_branch.length === 0 || repo.default_branch.length > 255) return undefined
  if (typeof repo.stargazers_count !== 'number' || !Number.isSafeInteger(repo.stargazers_count) || repo.stargazers_count < 0) return undefined
  const updatedAt = githubTimestamp(repo.updated_at)
  if (updatedAt === undefined) return undefined
  const topics = Array.isArray(repo.topics)
    ? repo.topics.filter((topic): topic is string => typeof topic === 'string')
    : []
  const description = typeof repo.description === 'string' && repo.description.trim() !== ''
    ? repo.description.trim()
    : undefined
  const id = repo.full_name.toLocaleLowerCase()
  const license = typeof repo.license?.spdx_id === 'string' && repo.license.spdx_id !== 'NOASSERTION'
    ? repo.license.spdx_id
    : undefined
  const discovered: PluginMarketplaceCatalogItem = {
    id,
    name: repo.name,
    ...(description === undefined ? {} : { description }),
    category: classifyPlugin(repo.name, description, topics),
    categorySource: 'topic-heuristic',
    sourceKind: 'github',
    sourceRef: `github:${repo.full_name}`,
    sourceUrl: repo.html_url,
    defaultBranch: repo.default_branch,
    updatedAt,
    stars: repo.stargazers_count,
    ...(license === undefined ? {} : { license }),
    discoveredFrom: {
      kind: 'github-topic',
      source: GITHUB_TOPIC_URL,
      lastVerified: new Date(checkedAt).toISOString(),
    },
    partnerOffers: Object.freeze([]),
    installability: 'unknown',
  }
  return applyVerifiedCatalog(Object.freeze(discovered))
}

/** Parse non-negative integer response headers. */
function numericHeader(headers: Headers, name: string): number | undefined {
  const raw = headers.get(name)
  if (raw === null || !/^\d+$/.test(raw)) return undefined
  const value = Number(raw)
  return Number.isSafeInteger(value) ? value : undefined
}

/**
 * Fetch one bounded GitHub topic page without retrying.
 * @param fetcher - Host-owned fetch implementation used for the network request.
 * @param options - result bound, observation time, conditional ETag, and cancellation signal.
 * @returns parsed discovery rows plus cache and rate-limit response metadata.
 * @throws {GithubCatalogError} when GitHub rate-limits, rejects, or returns malformed data.
 */
export async function fetchGithubCatalog(
  fetcher: typeof fetch,
  options: {
    readonly maxResults: number
    readonly checkedAt: number
    readonly etag?: string
    readonly signal?: AbortSignal
  },
): Promise<GithubCatalogResponse> {
  const url = new URL(GITHUB_SEARCH_URL)
  url.searchParams.set('q', 'topic:dsh-plugin')
  url.searchParams.set('sort', 'stars')
  url.searchParams.set('order', 'desc')
  url.searchParams.set('per_page', String(options.maxResults))
  const response = await fetcher(url, {
    headers: {
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'deepseek-harness-plugin-marketplace',
      ...(options.etag === undefined ? {} : { 'if-none-match': options.etag }),
    },
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
  const remaining = numericHeader(response.headers, 'x-ratelimit-remaining')
  const resetSeconds = numericHeader(response.headers, 'x-ratelimit-reset')
  const rateLimitResetAt = resetSeconds === undefined ? undefined : resetSeconds * 1000
  const etag = response.headers.get('etag')
  const headers = {
    ...(etag === null ? {} : { etag }),
    ...(remaining === undefined ? {} : { rateLimitRemaining: remaining }),
    ...(rateLimitResetAt === undefined ? {} : { rateLimitResetAt }),
  }
  if (response.status === 304) return { kind: 'not-modified', ...headers }
  if (response.status === 403 || response.status === 429) {
    throw new GithubCatalogError('rate-limited', `GitHub catalog request returned ${String(response.status)}`, rateLimitResetAt)
  }
  if (!response.ok) {
    throw new GithubCatalogError('offline-cache', `GitHub catalog request returned ${String(response.status)}`)
  }
  let body: GithubSearchResponse
  try {
    body = await response.json() as GithubSearchResponse
  } catch (cause) {
    throw new GithubCatalogError('github-response-invalid', 'GitHub catalog response was not JSON', undefined, { cause })
  }
  if (!Array.isArray(body.items)) {
    throw new GithubCatalogError('github-response-invalid', 'GitHub catalog response had no items array')
  }
  const items = body.items
    .map(item => githubItem(item, options.checkedAt))
    .filter((item): item is PluginMarketplaceCatalogItem => item !== undefined)
  return { kind: 'updated', items: Object.freeze(items), ...headers }
}

/** Classified discovery failure; message stays Host-local except for diagnostics. */
export class GithubCatalogError extends Error {
  constructor(
    readonly warning: PluginMarketplaceCatalogWarning,
    message: string,
    readonly retryAt?: number,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'GithubCatalogError'
  }
}
