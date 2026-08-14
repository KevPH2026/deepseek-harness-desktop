import { describe, expect, it } from 'vitest'
import { PLUGIN_MARKETPLACE_RESOURCES } from '../src/resources.ts'
import type { PluginMarketplaceCatalogItem } from '../src/types.ts'
import { validateGithubCatalogItem } from '../src/validation.ts'

const CHECKED_AT = Date.parse('2026-08-14T00:00:00.000Z')
const SHA = '0123456789abcdef0123456789abcdef01234567'

function fetchUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

function item(): PluginMarketplaceCatalogItem {
  return {
    id: 'example/plugin',
    name: 'Plugin',
    category: 'other',
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
    installability: 'unknown',
  }
}

function validatorFetch(manifest: unknown, patchStatus = 200): {
  readonly fetcher: typeof fetch
  readonly calls: Array<{ readonly url: string; readonly method: string }>
} {
  const calls: Array<{ url: string; method: string }> = []
  const fetcher: typeof fetch = async (input, init) => {
    const url = fetchUrl(input)
    const method = init?.method ?? 'GET'
    calls.push({ url, method })
    if (url.includes('/commits/')) {
      return new Response(JSON.stringify({ sha: SHA }), { status: 200 })
    }
    if (url.endsWith('/package.json')) {
      return new Response(JSON.stringify(manifest), { status: 200 })
    }
    return new Response(null, { status: patchStatus })
  }
  return { fetcher, calls }
}

describe('selected-row bundle validation', () => {
  it('pins the default branch, requires a root bundle manifest, and checks exactly one patch', async () => {
    const { fetcher, calls } = validatorFetch({
      name: 'example-plugin',
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    })

    const result = await validateGithubCatalogItem(fetcher, item(), CHECKED_AT)

    expect(result).toMatchObject({
      installability: 'validated',
      validation: {
        source: `https://github.com/example/plugin/tree/${SHA}`,
        commitSha: SHA,
        packageName: 'example-plugin',
        patchPath: './cordis.patch.yml',
        lastVerified: '2026-08-14T00:00:00.000Z',
      },
    })
    expect(calls).toEqual([
      { url: 'https://api.github.com/repos/example/plugin/commits/main', method: 'GET' },
      { url: `https://raw.githubusercontent.com/example/plugin/${SHA}/package.json`, method: 'GET' },
      { url: `https://raw.githubusercontent.com/example/plugin/${SHA}/cordis.patch.yml`, method: 'HEAD' },
    ])
  })

  it('marks a missing dsh.bundle declaration invalid without probing arbitrary files', async () => {
    const { fetcher, calls } = validatorFetch({ name: 'plain-library' })
    await expect(validateGithubCatalogItem(fetcher, item(), CHECKED_AT)).resolves.toMatchObject({
      installability: 'invalid',
      validationFailure: 'bundle-missing',
      validation: { commitSha: SHA, packageName: 'plain-library' },
    })
    expect(calls).toHaveLength(2)
  })

  it('ships a copy-only starter with the same installable manifest and patch shape', async () => {
    const files = new Map(PLUGIN_MARKETPLACE_RESOURCES.template.files.map(file => [file.path, file.content]))
    const manifest = JSON.parse(files.get('package.json') ?? 'null') as {
      main?: unknown
      files?: unknown
      dsh?: { bundle?: { patch?: unknown } }
    }
    expect(manifest).toMatchObject({
      main: 'index.js',
      files: ['index.js', 'cordis.patch.yml'],
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    })
    expect(files.get('index.js')).toContain("export const name = 'my-dsh-plugin'")
    expect(files.get('cordis.patch.yml')).toContain('name: my-dsh-plugin')

    const { fetcher } = validatorFetch(manifest, files.has('cordis.patch.yml') ? 200 : 404)
    await expect(validateGithubCatalogItem(fetcher, item(), CHECKED_AT)).resolves.toMatchObject({
      installability: 'validated',
      validation: { patchPath: './cordis.patch.yml' },
    })
  })

  it('keeps create-plugin documentation on the upstream master branch', () => {
    expect(PLUGIN_MARKETPLACE_RESOURCES.docsUrl)
      .toBe('https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/index.md')
    expect(PLUGIN_MARKETPLACE_RESOURCES.publishGuideUrl)
      .toBe('https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md')
  })
})
