import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { normalizeImportSource } from '../src/import-source.ts'
import type { PluginMarketplaceCatalogItem } from '../src/types.ts'

const SHA = '0123456789abcdef0123456789abcdef01234567'
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

function catalogItem(installability: PluginMarketplaceCatalogItem['installability']): PluginMarketplaceCatalogItem {
  return {
    id: 'example/plugin',
    name: 'Plugin',
    category: 'coding',
    categorySource: 'topic-heuristic',
    sourceKind: 'github',
    sourceRef: 'github:example/plugin',
    sourceUrl: 'https://github.com/example/plugin',
    defaultBranch: 'main',
    updatedAt: '2026-08-13T00:00:00.000Z',
    stars: 1,
    discoveredFrom: {
      kind: 'github-topic',
      source: 'https://github.com/topics/dsh-plugin',
      lastVerified: '2026-08-14T00:00:00.000Z',
    },
    partnerOffers: [],
    installability,
    ...(installability === 'unknown' ? {} : {
      validation: {
        source: `https://github.com/example/plugin/tree/${SHA}`,
        commitSha: SHA,
        lastVerified: '2026-08-14T00:00:00.000Z',
      },
    }),
    ...(installability === 'invalid' ? { validationFailure: 'bundle-missing' as const } : {}),
  }
}

describe('read-only import normalization', () => {
  it('refuses an unvalidated topic row', async () => {
    await expect(normalizeImportSource(
      { kind: 'catalog', itemId: 'example/plugin' },
      [catalogItem('unknown')],
    )).rejects.toMatchObject({ code: 'catalog-item-unvalidated' })
  })

  it('uses the validator commit instead of an unpinned catalog branch', async () => {
    await expect(normalizeImportSource(
      { kind: 'catalog', itemId: 'EXAMPLE/PLUGIN' },
      [catalogItem('validated')],
    )).resolves.toEqual({
      sourceKind: 'github',
      sourceRef: `github:example/plugin#${SHA}`,
      verification: 'topic-only',
      risks: [
        'third-party-code',
        'install-scripts',
        'network-access',
        'unverified-source',
        'profile-restart-required',
      ],
    })
  })

  it('normalizes custom GitHub and npm sources without accepting option-shaped input', async () => {
    const github = await normalizeImportSource({
      kind: 'github',
      repository: 'https://github.com/Example/Plugin.git',
      ref: SHA,
    }, [])
    expect(github.sourceRef).toBe(`github:Example/Plugin#${SHA}`)
    expect(github.risks).not.toContain('unpinned-source')
    await expect(normalizeImportSource({ kind: 'npm', spec: '@example/plugin@next' }, []))
      .resolves.toMatchObject({ sourceKind: 'npm', sourceRef: '@example/plugin@next' })
    await expect(normalizeImportSource({ kind: 'npm', spec: '--ignore-scripts' }, []))
      .rejects.toMatchObject({ code: 'invalid-source' })
  })

  it('accepts only an absolute readable local package directory and never executes it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-plugin-marketplace-'))
    temporaryDirectories.push(directory)
    await writeFile(join(directory, 'package.json'), JSON.stringify({ name: 'local-plugin' }))
    const canonicalDirectory = await realpath(directory)

    const local = await normalizeImportSource({ kind: 'local', path: directory }, [])
    expect(local.sourceKind).toBe('local')
    expect(local.sourceRef).toBe(canonicalDirectory)
    expect(local.risks).toContain('local-filesystem-access')
    expect(local.risks).toContain('install-scripts')
    await expect(normalizeImportSource({ kind: 'local', path: 'relative/plugin' }, []))
      .rejects.toMatchObject({ code: 'invalid-source' })
  })
})
