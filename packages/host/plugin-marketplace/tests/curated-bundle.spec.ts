import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import PluginMarketplaceGateway, {
  allowBuildsRewritten,
  CURATED_BUNDLE_PACKAGES,
  CURATED_BUNDLE_REMOVALS,
  sanitizeCliOutput,
  type Config,
} from '../src/index.ts'
import type { PluginMarketplaceCacheRow } from '../src/spec.ts'

const REPRESENTATIVE = CURATED_BUNDLE_PACKAGES[0] ?? '@linxin666/dsh-client-ui-git-graph'

const contexts: Context[] = []

afterEach(async () => {
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

function storageDomain(): object {
  const rows = new Map<string, PluginMarketplaceCacheRow>()
  return {
    open: async () => ({
      table: () => ({
        get: (key: string) => rows.get(key),
        entries: () => new Map(rows).entries(),
        keys: () => new Map(rows).keys(),
        get size() { return rows.size },
        put: async (key: string, row: PluginMarketplaceCacheRow) => { rows.set(key, row) },
      }),
      close: async () => {},
    }),
  }
}

async function harness(options: {
  readonly profileDir: string
  readonly runCuratedCli?: (args: readonly string[]) => Promise<{ readonly code: number; readonly tail: string }>
}): Promise<PluginMarketplaceGateway> {
  const ctx = new Context()
  contexts.push(ctx)
  ctx.provide('storageDomain', storageDomain() as never)
  await ctx.plugin(PluginMarketplaceGateway, CONFIG)
  const gateway = ctx.get('pluginMarketplace') as PluginMarketplaceGateway
  // The Dependencies constructor seam is not forwarded by ctx.plugin; the two
  // call-time function fields are safe to point at the test fixtures.
  const seams = gateway as unknown as {
    curatedProfileDir: () => string
    runCuratedCli: (args: readonly string[]) => Promise<{ readonly code: number; readonly tail: string }>
  }
  seams.curatedProfileDir = () => options.profileDir
  if (options.runCuratedCli !== undefined) seams.runCuratedCli = options.runCuratedCli
  return gateway
}

async function writeNested(path: string, content: string): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, content)
}

describe('allowBuildsRewritten', () => {
  it('replaces the CLI placeholder hint with explicit approval', () => {
    const source = ['packages:', '  - .', '', 'allowBuilds:', '  ssh2: set this to true or false', ''].join('\n')
    expect(allowBuildsRewritten(source, ['ssh2'])).toBe(
      ['packages:', '  - .', '', 'allowBuilds:', '  ssh2: true', ''].join('\n'),
    )
  })

  it('appends missing packages and creates the block when absent', () => {
    expect(allowBuildsRewritten('packages:\n  - .\n', ['cloudflared', 'ssh2'])).toBe(
      'packages:\n  - .\nallowBuilds:\n  cloudflared: true\n  ssh2: true\n',
    )
    const existing = 'packages:\n  - .\nallowBuilds:\n  cpu-features: true\n'
    expect(allowBuildsRewritten(existing, ['ssh2'])).toBe(
      'packages:\n  - .\nallowBuilds:\n  cpu-features: true\n  ssh2: true\n',
    )
  })

  it('is idempotent when every package is already approved', () => {
    const source = 'packages:\n  - .\nallowBuilds:\n  ssh2: true\n  cpu-features: true\n  cloudflared: true\n'
    expect(allowBuildsRewritten(source, ['cloudflared', 'cpu-features', 'ssh2'])).toBe(source)
  })
})

describe('curated bundle remotes', () => {
  it('reports installed state and version from the profile manifests', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-curated-'))
    try {
      await writeFile(join(dir, 'package.json'), JSON.stringify({
        dependencies: Object.fromEntries(CURATED_BUNDLE_PACKAGES.map(name => [name, '^0.1.16'])),
      }))
      await writeNested(join(dir, 'node_modules', REPRESENTATIVE, 'package.json'), JSON.stringify({
        version: '0.1.18',
      }))
      const gateway = await harness({ profileDir: dir })
      expect(await gateway.curatedBundleStatus()).toEqual({
        package: REPRESENTATIVE,
        installed: true,
        version: '0.1.18',
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('refuses to install without an explicit acknowledgement', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-curated-'))
    try {
      const gateway = await harness({ profileDir: dir })
      const result = await gateway.installCuratedBundle({ acknowledgedRisk: false })
      expect(result).toMatchObject({ ok: false, installed: false, errorCode: 'acknowledgement-required' })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('approves known build scripts, runs the CLI, and reports the restart requirement', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-curated-'))
    try {
      await writeFile(join(dir, 'package.json'), JSON.stringify({ dependencies: {} }))
      await writeFile(join(dir, 'pnpm-workspace.yaml'), 'packages:\n  - .\n')
      const calls: string[][] = []
      const gateway = await harness({
        profileDir: dir,
        runCuratedCli: async (args) => {
          calls.push([...args])
          await writeFile(join(dir, 'package.json'), JSON.stringify({
            dependencies: Object.fromEntries(CURATED_BUNDLE_PACKAGES.map(name => [name, '^0.1.16'])),
          }))
          await writeNested(join(dir, 'node_modules', REPRESENTATIVE, 'package.json'), JSON.stringify({
            version: '0.1.18',
          }))
          return { code: 0, tail: '' }
        },
      })
      const result = await gateway.installCuratedBundle({ acknowledgedRisk: true })
      expect(result).toEqual({
        ok: true,
        installed: true,
        requiresRestart: true,
        errorCode: undefined,
        detail: undefined,
      })
      expect(calls).toEqual([
        ...CURATED_BUNDLE_REMOVALS.map(name => ['plugin', '--profile', 'web', 'remove', name]),
        ...CURATED_BUNDLE_PACKAGES.map(name => ['plugin', '--profile', 'web', 'add', name]),
      ])
      const workspace = await readFile(join(dir, 'pnpm-workspace.yaml'), 'utf8')
      expect(workspace).toContain('ssh2: true')
      expect(workspace).toContain('cloudflared: true')
      expect(workspace).toContain('cpu-features: true')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('surfaces a sanitized CLI failure tail as install-failed', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-curated-'))
    try {
      const gateway = await harness({
        profileDir: dir,
        runCuratedCli: async () => ({ code: 1, tail: sanitizeCliOutput('\u001B[31mERR_PNPM\u001B[0m network unreachable') }),
      })
      const result = await gateway.installCuratedBundle({ acknowledgedRisk: true })
      expect(result.ok).toBe(false)
      expect(result.errorCode).toBe('install-failed')
      expect(result.detail).toContain('ERR_PNPM network unreachable')
      expect(result.detail).not.toContain('\u001B')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('requires the bundle to be absent after an uninstall', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-curated-'))
    try {
      const gateway = await harness({
        profileDir: dir,
        runCuratedCli: async () => ({ code: 0, tail: '' }),
      })
      const result = await gateway.uninstallCuratedBundle()
      expect(result).toEqual({
        ok: true,
        installed: false,
        requiresRestart: true,
        errorCode: undefined,
        detail: undefined,
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
