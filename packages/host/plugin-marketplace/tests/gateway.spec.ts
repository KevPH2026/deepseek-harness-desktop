import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import PluginMarketplaceGateway, { type Config } from '../src/index.ts'
import type { PluginMarketplaceCacheRow } from '../src/spec.ts'
import type { PluginMarketplaceConfirmationId } from '../src/types.ts'

const contexts: Context[] = []

afterEach(async () => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

const CONFIG: Config = {
  cacheTtlMs: 60_000,
  minRefreshIntervalMs: 1_000,
  requestTimeoutMs: 10_000,
  maxResults: 10,
  confirmationTtlMs: 60_000,
  maxConfirmations: 5,
  validationTtlMs: 60_000,
  minValidationIntervalMs: 1_000,
  validationTimeoutMs: 10_000,
  curatedInstallTimeoutMs: 60_000,
}

/** Minimal durable-domain fake; the Gateway still owns open/close lifecycle. */
function storageDomain(): {
  readonly service: object
  readonly rows: Map<string, PluginMarketplaceCacheRow>
  readonly close: ReturnType<typeof vi.fn>
} {
  const rows = new Map<string, PluginMarketplaceCacheRow>()
  const close = vi.fn(async () => {})
  const table = {
    get: (key: string) => rows.get(key),
    entries: () => new Map(rows).entries(),
    keys: () => new Map(rows).keys(),
    get size() { return rows.size },
    put: async (key: string, value: PluginMarketplaceCacheRow) => { rows.set(key, value) },
    delete: async (key: string) => rows.delete(key),
    update: async (key: string, update: (value: PluginMarketplaceCacheRow) => PluginMarketplaceCacheRow) => {
      const current = rows.get(key)
      if (current === undefined) throw new Error('missing key')
      const next = update(current)
      rows.set(key, next)
      return next
    },
  }
  return {
    rows,
    close,
    service: {
      open: async () => ({ table: () => table, close }),
    },
  }
}

async function harness(fetcher: typeof fetch): Promise<{
  readonly ctx: Context
  readonly gateway: PluginMarketplaceGateway
  readonly rows: Map<string, PluginMarketplaceCacheRow>
  readonly close: ReturnType<typeof vi.fn>
}> {
  const ctx = new Context()
  contexts.push(ctx)
  const domain = storageDomain()
  ctx.provide('storageDomain', domain.service as never)
  vi.stubGlobal('fetch', fetcher)
  await ctx.plugin(PluginMarketplaceGateway, CONFIG)
  const gateway = ctx.get('pluginMarketplace') as PluginMarketplaceGateway
  return { ctx, gateway, rows: domain.rows, close: domain.close }
}

function githubResponse(): Response {
  return new Response(JSON.stringify({
    items: [{
      full_name: 'Example/Plugin',
      name: 'Plugin',
      html_url: 'https://github.com/Example/Plugin',
      description: 'Coding plugin',
      stargazers_count: 3,
      updated_at: '2026-08-13T00:00:00.000Z',
      default_branch: 'main',
      topics: ['dsh-plugin', 'coding'],
      license: { spdx_id: 'MIT' },
    }],
  }), { status: 200, headers: { etag: '"v1"' } })
}

describe('PluginMarketplaceGateway', () => {
  it('publishes the complete read/plan surface and keeps confirmation execution disabled', async () => {
    const fetcher = vi.fn(async () => githubResponse()) as unknown as typeof fetch
    const { gateway } = await harness(fetcher)

    expect(gateway.typertRemote).toMatchObject({
      serviceKey: 'pluginMarketplace',
      namespace: 'pluginMarketplace',
    })
    expect(remoteMethods(gateway).map(method => method.method).sort()).toEqual([
      'catalog',
      'confirmImport',
      'curatedBundleStatus',
      'installCuratedBundle',
      'prepareImport',
      'resources',
      'uninstallCuratedBundle',
      'validateCatalogItem',
    ])
    const confirmation = await gateway.confirmImport({
      confirmationId: 'unused' as PluginMarketplaceConfirmationId,
      acknowledgeRisks: true,
    })
    expect(confirmation.ok).toBe(false)
    if (confirmation.ok) throw new Error('unknown confirmation should fail')
    expect(confirmation.error.code).toBe('confirmation-not-found')
  })

  it('persists one successful topic page and serves it explicitly from cache offline', async () => {
    let now = Date.parse('2026-08-14T00:00:00.000Z')
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const fetcher = vi.fn()
      .mockResolvedValueOnce(githubResponse())
      .mockRejectedValueOnce(new TypeError('offline')) as unknown as typeof fetch
    const { gateway, rows, ctx, close } = await harness(fetcher)

    const fresh = await gateway.catalog({})
    expect(fresh.status).toBe('fresh')
    expect(fresh.fromCache).toBe(false)
    expect(fresh.items[0]).toMatchObject({ id: 'example/plugin', installability: 'unknown' })
    expect(fresh.publicOffers).toHaveLength(3)
    expect(rows.get('github-topic')).toMatchObject({ etag: '"v1"' })

    now += 2_000
    const offline = await gateway.catalog({ refresh: true })
    expect(offline).toMatchObject({
      status: 'fresh',
      fromCache: true,
      warning: 'offline-cache',
    })
    expect(offline.items[0]?.id).toBe('example/plugin')
    expect(fetcher).toHaveBeenCalledTimes(2)

    await ctx.fiber.dispose()
    expect(close).toHaveBeenCalledOnce()
  })
})
