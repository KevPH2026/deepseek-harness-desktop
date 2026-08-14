/** Strict source normalization for the non-executing import preview. */

import { access, readFile, realpath, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import type {
  PluginMarketplaceCatalogItem,
  PluginMarketplaceImportRisk,
  PluginMarketplaceImportSource,
  PluginMarketplacePrepareImportErrorCode,
} from './types.ts'

const GITHUB_REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const GITHUB_REF = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/
const PINNED_GITHUB_REF = /^[a-fA-F0-9]{40}$/
const NPM_SPEC = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(?:@[a-zA-Z0-9][a-zA-Z0-9._~^*+<>=|-]*)?$/
const MAX_LOCAL_MANIFEST_BYTES = 256 * 1024

/** Source parse failure kept in the preview business-result vocabulary. */
export class ImportSourceError extends Error {
  constructor(readonly code: PluginMarketplacePrepareImportErrorCode, message: string) {
    super(message)
    this.name = 'ImportSourceError'
  }
}

/** Fully normalized input ready to display in a risk preview. */
export interface NormalizedPluginImport {
  readonly sourceKind: 'github' | 'npm' | 'local'
  readonly sourceRef: string
  readonly verification: 'catalog-verified' | 'topic-only' | 'custom'
  readonly risks: readonly PluginMarketplaceImportRisk[]
}

/** Strip the only accepted GitHub URL shape into `owner/repository`. */
function githubRepository(value: string): string | undefined {
  const trimmed = value.trim()
  const prefixed = trimmed.startsWith('github:') ? trimmed.slice('github:'.length) : trimmed
  if (GITHUB_REPOSITORY.test(prefixed)) return prefixed
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return undefined
  }
  if (url.protocol !== 'https:' || url.hostname.toLocaleLowerCase() !== 'github.com'
    || url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') return undefined
  const parts = url.pathname.replace(/^\/+|\/+$/g, '').split('/')
  if (parts.length !== 2) return undefined
  const repository = `${parts[0] ?? ''}/${(parts[1] ?? '').replace(/\.git$/, '')}`
  return GITHUB_REPOSITORY.test(repository) ? repository : undefined
}

/** Reject ambiguous or option-shaped Git refs. */
function normalizeGithubRef(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const ref = value.trim()
  if (!GITHUB_REF.test(ref) || ref.includes('..') || ref.includes('@{') || ref.endsWith('.') || ref.endsWith('/')) {
    throw new ImportSourceError('invalid-source', 'GitHub ref is not a safe branch, tag, or commit id')
  }
  return ref
}

/** Verify a loopback-supplied local package directory without executing it. */
async function normalizeLocal(path: string): Promise<string> {
  if (!isAbsolute(path)) {
    throw new ImportSourceError('invalid-source', 'Local plugin path must be absolute')
  }
  let resolved: string
  try {
    resolved = await realpath(path)
    const info = await stat(resolved)
    if (!info.isDirectory()) throw new Error('not a directory')
    await access(resolved, constants.R_OK)
  } catch {
    throw new ImportSourceError('local-path-unreadable', 'Local plugin directory is not readable')
  }
  const manifestPath = join(resolved, 'package.json')
  try {
    const info = await stat(manifestPath)
    if (!info.isFile() || info.size > MAX_LOCAL_MANIFEST_BYTES) throw new Error('invalid manifest size')
    const parsed = JSON.parse(await readFile(manifestPath, 'utf8')) as unknown
    if (typeof parsed !== 'object' || parsed === null
      || typeof (parsed as { name?: unknown }).name !== 'string'
      || (parsed as { name: string }).name.trim() === '') throw new Error('missing package name')
  } catch {
    throw new ImportSourceError('local-manifest-missing', 'Local plugin must contain a readable package.json with a package name')
  }
  return resolved
}

/** Shared risks for a package-manager installation. */
function packageRisks(unverified: boolean, unpinned: boolean): PluginMarketplaceImportRisk[] {
  return [
    'third-party-code',
    'install-scripts',
    'network-access',
    ...(unpinned ? ['unpinned-source' as const] : []),
    ...(unverified ? ['unverified-source' as const] : []),
    'profile-restart-required',
  ]
}

/**
 * Normalize one catalog or custom source without installing it.
 * @param source - explicit catalog, GitHub, npm, or absolute local source.
 * @param catalog - current cached rows used to resolve and require validated catalog input.
 * @returns normalized command input and the risks that a confirmation must display.
 * @throws {ImportSourceError} when the source is malformed, unavailable, or unvalidated.
 */
export async function normalizeImportSource(
  source: PluginMarketplaceImportSource,
  catalog: readonly PluginMarketplaceCatalogItem[],
): Promise<NormalizedPluginImport> {
  switch (source.kind) {
    case 'catalog': {
      const item = catalog.find(candidate => candidate.id === source.itemId.toLocaleLowerCase())
      if (item === undefined) {
        throw new ImportSourceError('catalog-item-not-found', 'Catalog item is unavailable; refresh and try again')
      }
      if (item.installability === 'invalid') {
        throw new ImportSourceError('catalog-item-invalid', 'Catalog item failed its pinned bundle validation')
      }
      if (item.installability !== 'validated') {
        throw new ImportSourceError('catalog-item-unvalidated', 'Catalog item must pass pinned bundle validation before import')
      }
      const commitSha = item.validation?.commitSha
      if (commitSha === undefined || !PINNED_GITHUB_REF.test(commitSha)) {
        throw new ImportSourceError('catalog-item-unvalidated', 'Catalog item has no pinned validation commit')
      }
      return {
        sourceKind: 'github',
        sourceRef: `${item.sourceRef}#${commitSha}`,
        verification: item.verifiedSource === undefined ? 'topic-only' : 'catalog-verified',
        risks: Object.freeze(packageRisks(item.verifiedSource === undefined, false)),
      }
    }
    case 'github': {
      const repository = githubRepository(source.repository)
      if (repository === undefined) {
        throw new ImportSourceError('invalid-source', 'GitHub source must be owner/repository or an https://github.com/owner/repository URL')
      }
      const ref = normalizeGithubRef(source.ref)
      return {
        sourceKind: 'github',
        sourceRef: `github:${repository}${ref === undefined ? '' : `#${ref}`}`,
        verification: 'custom',
        risks: Object.freeze(packageRisks(true, ref === undefined || !PINNED_GITHUB_REF.test(ref))),
      }
    }
    case 'npm': {
      const spec = source.spec.trim()
      if (!NPM_SPEC.test(spec) || spec.startsWith('-')) {
        throw new ImportSourceError('invalid-source', 'npm source must be one registry package with an optional tag or version')
      }
      return {
        sourceKind: 'npm',
        sourceRef: spec,
        verification: 'custom',
        risks: Object.freeze(packageRisks(true, false)),
      }
    }
    case 'local': {
      const path = await normalizeLocal(source.path)
      return {
        sourceKind: 'local',
        sourceRef: path,
        verification: 'custom',
        risks: Object.freeze([
          'third-party-code',
          'install-scripts',
          'network-access',
          'unverified-source',
          'local-filesystem-access',
          'profile-restart-required',
        ]),
      }
    }
    default:
      source satisfies never
      throw new ImportSourceError('invalid-source', 'Unsupported plugin source')
  }
}
