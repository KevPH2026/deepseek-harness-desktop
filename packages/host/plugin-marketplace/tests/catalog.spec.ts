import { describe, expect, it, vi } from 'vitest'
import {
  GITHUB_SEARCH_URL,
  GITHUB_TOPIC_URL,
  fetchGithubCatalog,
} from '../src/catalog.ts'

const CHECKED_AT = Date.parse('2026-08-14T00:00:00.000Z')

describe('GitHub topic catalog', () => {
  it('fetches one bounded topic page and keeps every discovery unvalidated', async () => {
    const request = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      items: [{
        full_name: 'Example/Design-Plugin',
        name: 'Design Plugin',
        html_url: 'https://github.com/Example/Design-Plugin',
        description: 'Figma and UI helpers',
        stargazers_count: 12,
        updated_at: '2026-08-13T00:00:00.000Z',
        default_branch: 'main',
        topics: ['dsh-plugin', 'design'],
        license: { spdx_id: 'MIT' },
      }, {
        full_name: 'Example/Archived',
        name: 'Archived',
        html_url: 'https://github.com/Example/Archived',
        stargazers_count: 99,
        updated_at: '2026-08-13T00:00:00.000Z',
        default_branch: 'main',
        archived: true,
      }],
    }), {
      status: 200,
      headers: {
        etag: '"catalog-v1"',
        'x-ratelimit-remaining': '9',
        'x-ratelimit-reset': '1786665600',
      },
    }))
    const fetcher = request as unknown as typeof fetch

    const result = await fetchGithubCatalog(fetcher, {
      maxResults: 25,
      checkedAt: CHECKED_AT,
    })

    expect(result.kind).toBe('updated')
    expect(result.items).toEqual([expect.objectContaining({
      id: 'example/design-plugin',
      category: 'design',
      categorySource: 'topic-heuristic',
      sourceRef: 'github:Example/Design-Plugin',
      defaultBranch: 'main',
      installability: 'unknown',
      partnerOffers: [],
      discoveredFrom: {
        kind: 'github-topic',
        source: GITHUB_TOPIC_URL,
        lastVerified: '2026-08-14T00:00:00.000Z',
      },
    })])
    const [input, init] = request.mock.calls[0] ?? []
    if (input === undefined) throw new Error('fetch input missing')
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    expect(url.origin + url.pathname).toBe(GITHUB_SEARCH_URL)
    expect(url.searchParams.get('q')).toBe('topic:dsh-plugin')
    expect(url.searchParams.get('per_page')).toBe('25')
    expect(new Headers(init?.headers).get('user-agent')).toBe('deepseek-harness-plugin-marketplace')
    expect(result).toMatchObject({
      etag: '"catalog-v1"',
      rateLimitRemaining: 9,
      rateLimitResetAt: 1_786_665_600_000,
    })
  })

  it('preserves a conditional 304 without parsing a response body', async () => {
    const request = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(null, { status: 304 }))
    const fetcher = request as unknown as typeof fetch
    await expect(fetchGithubCatalog(fetcher, {
      maxResults: 1,
      checkedAt: CHECKED_AT,
      etag: '"known"',
    })).resolves.toEqual({ kind: 'not-modified' })
    const [, init] = request.mock.calls[0] ?? []
    expect(new Headers(init?.headers).get('if-none-match')).toBe('"known"')
  })

  it('classifies malformed GitHub JSON as an explicit catalog warning', async () => {
    const fetcher = vi.fn(async () => new Response('{', { status: 200 })) as unknown as typeof fetch
    await expect(fetchGithubCatalog(fetcher, {
      maxResults: 1,
      checkedAt: CHECKED_AT,
    })).rejects.toMatchObject({
      name: 'GithubCatalogError',
      warning: 'github-response-invalid',
    })
  })
})
