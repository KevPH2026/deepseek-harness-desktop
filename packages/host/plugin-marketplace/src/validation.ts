/** Bounded, lazy validation of one selected GitHub topic repository. */

import { posix } from 'node:path'
import type {
  PluginMarketplaceCatalogItem,
  PluginMarketplaceValidateCatalogItemErrorCode,
  PluginMarketplaceValidationFailure,
} from './types.ts'

const MAX_JSON_BYTES = 256 * 1024
const COMMIT_SHA = /^[a-f0-9]{40}$/
const SAFE_PATCH_PATH = /^\.\/[A-Za-z0-9._/-]+$/

/** Network/rate failure that must not be misreported as an invalid plugin. */
export class CatalogValidationError extends Error {
  constructor(
    readonly code: Exclude<PluginMarketplaceValidateCatalogItemErrorCode, 'catalog-item-not-found' | 'validation-busy'>,
    message: string,
  ) {
    super(message)
    this.name = 'CatalogValidationError'
  }
}

/** Read a response body without allowing a selected repository to exhaust memory. */
async function readBoundedText(response: Response, maxBytes = MAX_JSON_BYTES): Promise<string> {
  const declared = response.headers.get('content-length')
  if (declared !== null && /^\d+$/.test(declared) && Number(declared) > maxBytes) {
    throw new CatalogValidationError('validation-unavailable', 'GitHub response exceeded the validation size limit')
  }
  if (response.body === null) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      bytes += next.value.byteLength
      if (bytes > maxBytes) {
        await reader.cancel('validation body too large')
        throw new CatalogValidationError('validation-unavailable', 'GitHub response exceeded the validation size limit')
      }
      chunks.push(next.value)
    }
  } finally {
    reader.releaseLock()
  }
  const joined = new Uint8Array(bytes)
  let offset = 0
  for (const chunk of chunks) {
    joined.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(joined)
}

/** Fixed GitHub headers shared by validation calls. */
function githubHeaders(): HeadersInit {
  return {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'deepseek-harness-plugin-marketplace',
  }
}

/** A GitHub API refusal is transient; a pinned raw-file 404 is repository shape. */
function requireGithubApi(response: Response, label: string): void {
  if (response.status === 403 || response.status === 429) {
    throw new CatalogValidationError('validation-rate-limited', `GitHub rate-limited ${label}`)
  }
  if (!response.ok) {
    throw new CatalogValidationError('validation-unavailable', `GitHub could not verify ${label}`)
  }
}

/** Remove stale validation fields before publishing a new verdict. */
function validationBase(item: PluginMarketplaceCatalogItem): Omit<
  PluginMarketplaceCatalogItem,
  'installability' | 'validation' | 'validationFailure'
> {
  const { installability: _installability, validation: _validation, validationFailure: _failure, ...base } = item
  return base
}

/** Publish an invalid verdict with pinned source/commit evidence. */
function invalid(
  item: PluginMarketplaceCatalogItem,
  commitSha: string,
  checkedAt: number,
  failure: PluginMarketplaceValidationFailure,
  extras: { readonly packageName?: string; readonly patchPath?: string } = {},
): PluginMarketplaceCatalogItem {
  return Object.freeze({
    ...validationBase(item),
    installability: 'invalid' as const,
    validation: Object.freeze({
      source: `https://github.com/${item.id}/tree/${commitSha}`,
      commitSha,
      lastVerified: new Date(checkedAt).toISOString(),
      ...extras,
    }),
    validationFailure: failure,
  })
}

/**
 * Validate exactly one selected row at its resolved default-branch commit.
 * @param fetcher - Host-owned fetch implementation used for GitHub and pinned raw files.
 * @param item - selected discovery row whose default branch will be resolved once.
 * @param checkedAt - Host timestamp recorded in the resulting evidence.
 * @param signal - optional cancellation for the bounded validation operation.
 * @returns an immutable validated or invalid row with pinned commit evidence.
 * @throws {CatalogValidationError} when GitHub cannot produce a trustworthy verdict.
 */
export async function validateGithubCatalogItem(
  fetcher: typeof fetch,
  item: PluginMarketplaceCatalogItem,
  checkedAt: number,
  signal?: AbortSignal,
): Promise<PluginMarketplaceCatalogItem> {
  const [owner, repository] = item.id.split('/')
  if (owner === undefined || repository === undefined) {
    throw new CatalogValidationError('validation-unavailable', 'Catalog repository identity is malformed')
  }
  const commitUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/commits/${encodeURIComponent(item.defaultBranch)}`
  const commitResponse = await fetcher(commitUrl, {
    headers: githubHeaders(),
    ...(signal === undefined ? {} : { signal }),
  })
  requireGithubApi(commitResponse, 'the default branch commit')
  let commit: unknown
  try {
    commit = JSON.parse(await readBoundedText(commitResponse)) as unknown
  } catch (error) {
    if (error instanceof CatalogValidationError) throw error
    throw new CatalogValidationError('validation-unavailable', 'GitHub commit response was invalid')
  }
  const commitSha = typeof commit === 'object' && commit !== null
    ? (commit as { sha?: unknown }).sha
    : undefined
  if (typeof commitSha !== 'string' || !COMMIT_SHA.test(commitSha)) {
    throw new CatalogValidationError('validation-unavailable', 'GitHub commit response had no valid SHA')
  }

  const rawRoot = `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/${commitSha}`
  const manifestResponse = await fetcher(`${rawRoot}/package.json`, {
    headers: { 'user-agent': 'deepseek-harness-plugin-marketplace' },
    ...(signal === undefined ? {} : { signal }),
  })
  if (manifestResponse.status === 404) return invalid(item, commitSha, checkedAt, 'manifest-missing')
  if (manifestResponse.status === 403 || manifestResponse.status === 429) {
    throw new CatalogValidationError('validation-rate-limited', 'GitHub rate-limited package validation')
  }
  if (!manifestResponse.ok) {
    throw new CatalogValidationError('validation-unavailable', 'GitHub could not read the pinned package manifest')
  }
  let manifest: unknown
  try {
    manifest = JSON.parse(await readBoundedText(manifestResponse)) as unknown
  } catch (error) {
    if (error instanceof CatalogValidationError) throw error
    return invalid(item, commitSha, checkedAt, 'manifest-invalid')
  }
  if (typeof manifest !== 'object' || manifest === null) {
    return invalid(item, commitSha, checkedAt, 'manifest-invalid')
  }
  const packageName = (manifest as { name?: unknown }).name
  if (typeof packageName !== 'string' || packageName.trim() === '') {
    return invalid(item, commitSha, checkedAt, 'manifest-invalid')
  }
  const dsh = (manifest as { dsh?: unknown }).dsh
  const bundle = typeof dsh === 'object' && dsh !== null
    ? (dsh as { bundle?: unknown }).bundle
    : undefined
  const patch = typeof bundle === 'object' && bundle !== null
    ? (bundle as { patch?: unknown }).patch
    : undefined
  if (typeof patch !== 'string') {
    return invalid(item, commitSha, checkedAt, 'bundle-missing', { packageName })
  }
  const relativePatch = patch.startsWith('./') ? patch.slice(2) : ''
  const normalizedPatch = posix.normalize(relativePatch)
  if (!SAFE_PATCH_PATH.test(patch) || relativePatch === '' || normalizedPatch !== relativePatch) {
    return invalid(item, commitSha, checkedAt, 'patch-path-invalid', { packageName })
  }
  const patchPath = relativePatch
  const patchUrl = `${rawRoot}/${patchPath.split('/').map(encodeURIComponent).join('/')}`
  const patchResponse = await fetcher(patchUrl, {
    method: 'HEAD',
    headers: { 'user-agent': 'deepseek-harness-plugin-marketplace' },
    ...(signal === undefined ? {} : { signal }),
  })
  if (patchResponse.status === 404) {
    return invalid(item, commitSha, checkedAt, 'patch-missing', { packageName, patchPath: patch })
  }
  if (patchResponse.status === 403 || patchResponse.status === 429) {
    throw new CatalogValidationError('validation-rate-limited', 'GitHub rate-limited bundle patch validation')
  }
  if (!patchResponse.ok) {
    throw new CatalogValidationError('validation-unavailable', 'GitHub could not verify the pinned bundle patch')
  }
  return Object.freeze({
    ...validationBase(item),
    installability: 'validated' as const,
    validation: Object.freeze({
      source: `https://github.com/${item.id}/tree/${commitSha}`,
      commitSha,
      packageName,
      patchPath: patch,
      lastVerified: new Date(checkedAt).toISOString(),
    }),
  })
}
