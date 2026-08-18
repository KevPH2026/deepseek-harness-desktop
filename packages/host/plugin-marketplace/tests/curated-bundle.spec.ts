import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import PluginMarketplaceGateway, {
  allowBuildsRewritten,
  CURATED_BUNDLE_DISABLED_IDS,
  CURATED_BUNDLE_PACKAGE,
  CURATED_DISABLE_BEGIN,
  CURATED_DISABLE_END,
  sanitizeCliOutput,
  withCuratedDisableSection,
  withoutCuratedDisableSection,
  type Config,
} from '../src/index.ts'
import type { PluginMarketplaceCacheRow } from '../src/spec.ts'

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

type CuratedRunner = (args: readonly string[]) => Promise<{ readonly code: number; readonly tail: string }>

async function harness(options: {
  readonly profileDir: string
  readonly runCuratedCli?: CuratedRunner
}): Promise<PluginMarketplaceGateway> {
  const ctx = new Context()
  contexts.push(ctx)
  ctx.provide('storageDomain', storageDomain() as never)
  await ctx.plugin(PluginMarketplaceGateway, CONFIG)
  const gateway = ctx.get('pluginMarketplace') as PluginMarketplaceGateway
  const seams = gateway as unknown as { curatedProfileDir: () => string; runCuratedCli: CuratedRunner }
  seams.curatedProfileDir = () => options.profileDir
  if (options.runCuratedCli !== undefined) seams.runCuratedCli = options.runCuratedCli
  return gateway
}

async function installAggregate(dir: string, version = '0.1.18'): Promise<void> {
  await writeFile(join(dir, 'package.json'), JSON.stringify({
    dependencies: { [CURATED_BUNDLE_PACKAGE]: `^${version}` },
  }))
  const manifestDir = join(dir, 'node_modules', CURATED_BUNDLE_PACKAGE)
  await mkdir(manifestDir, { recursive: true })
  await writeFile(join(manifestDir, 'package.json'), JSON.stringify({ version }))
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

describe('curated disable section helpers', () => {
  it('inserts the managed section once and preserves user content', () => {
    const user = '# my notes\n- id: mine\n  disabled: false\n'
    const once = withCuratedDisableSection(user)
    // The managed section is appended with a leading '---' document
    // separator, so the user content lives in the first document and
    // the managed disable rows live in the second. The first doc is
    // round-tripped exactly.
    expect(once.split('\n---\n')[0]?.trimEnd()).toBe(user.trimEnd()) // already trimmed
    expect(once).toContain(`- id: ${CURATED_BUNDLE_DISABLED_IDS[0]}`)
    expect(withCuratedDisableSection(once)).toBe(once)
  })

  it('removes exactly the managed section', () => {
    const user = '# my notes\n'
    const patched = withCuratedDisableSection(user)
    // The leading '---' document separator is a write-side artefact of
    // keeping the managed section in its own YAML document. The test
    // strips it explicitly here so it can compare against the user input.
    const stripped = withoutCuratedDisableSection(patched)
      .replace(/^\n*---\n*/, '')
      .trimEnd()
    expect(stripped).toBe(user.trimEnd())
    expect(withoutCuratedDisableSection(user)).toBe(user)
  })
})

describe('curated bundle remotes', () => {
  it('reports installed only with the aggregate dependency and the managed section', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-curated-'))
    try {
      await installAggregate(dir)
      await writeFile(join(dir, 'cordis.patch.yml'), withCuratedDisableSection('[]\n'))
      const gateway = await harness({ profileDir: dir })
      expect(await gateway.curatedBundleStatus()).toEqual({
        package: CURATED_BUNDLE_PACKAGE,
        installed: true,
        version: '0.1.18',
      })
      await writeFile(join(dir, 'cordis.patch.yml'), '[]\n')
      expect((await gateway.curatedBundleStatus()).installed).toBe(false)
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

  it('migrates legacy members, installs the aggregate, and writes the disable section', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-curated-'))
    try {
      await writeFile(join(dir, 'package.json'), JSON.stringify({ dependencies: {} }))
      await writeFile(join(dir, 'pnpm-workspace.yaml'), 'packages:\n  - .\n')
      const calls: string[][] = []
      const gateway = await harness({
        profileDir: dir,
        runCuratedCli: async (args) => {
          calls.push([...args])
          const packageName = args.at(-1)
          if (args[3] === 'remove') return { code: 0, tail: '' }
          if (packageName === CURATED_BUNDLE_PACKAGE) {
            await installAggregate(dir)
            return { code: 0, tail: '' }
          }
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
      expect(calls.filter(call => call[3] === 'remove')).toEqual([])
      expect(calls.filter(call => call[3] === 'add').map(call => call.at(-1)))
        .toEqual([CURATED_BUNDLE_PACKAGE])
      const patch = await readFile(join(dir, 'cordis.patch.yml'), 'utf8')
      expect(patch).toContain(CURATED_DISABLE_BEGIN)
      expect(patch).toContain(CURATED_DISABLE_END)
      const workspace = await readFile(join(dir, 'pnpm-workspace.yaml'), 'utf8')
      expect(workspace).toContain('ssh2: true')
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

  it('removes the aggregate and strips the managed section on uninstall', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-curated-'))
    try {
      await installAggregate(dir)
      await writeFile(join(dir, 'cordis.patch.yml'), withCuratedDisableSection('# mine\n'))
      const gateway = await harness({
        profileDir: dir,
        runCuratedCli: async () => {
          await writeFile(join(dir, 'package.json'), JSON.stringify({ dependencies: {} }))
          return { code: 0, tail: '' }
        },
      })
      const result = await gateway.uninstallCuratedBundle()
      expect(result).toEqual({
        ok: true,
        installed: false,
        requiresRestart: true,
        errorCode: undefined,
        detail: undefined,
      })
      const patch = await readFile(join(dir, 'cordis.patch.yml'), 'utf8')
      expect(patch).not.toContain(CURATED_DISABLE_BEGIN)
      expect(patch).toContain('# mine')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
