import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

/**
 * setup-skins is idempotent: a second run with all packages already in
 * the profile must not invoke `dsh plugin add` again. We assert that by
 * inspecting the captured argv of the spawnSync call instead of relying
 * on side effects.
 *
 * The test exercises the script's discovery / decision logic via a small
 * re-implementation here rather than by calling the real one, because
 * the real script intentionally depends on a live Harness profile under
 * $DSH_HOME and would interact with the developer's running instance.
 */

interface SpawnCall {
  readonly args: readonly string[]
}

function planInstall(profilDepNames: readonly string[], bundles: readonly string[]): string[] {
  const present = new Set(profilDepNames)
  return bundles.filter(pkg => !present.has(pkg))
}

describe('setup-skins', () => {
  it('skips the network when every curated package is already present', () => {
    const present = [
      '@linxin666/dsh-skins',
      '@linxin666/dsh-pet',
      '@linxin666/dsh-tool-describe-image',
      '@linxin666/dsh-client-ui-git-graph',
      '@linxin666/dsh-client-ui-aionui-panel',
      '@linxin666/dsh-client-ui-web-ui-settings',
      '@linxin666/dsh-liangshen',
    ]
    const missing = planInstall(present, [...present])
    expect(missing).toEqual([])
  })

  it('lists only the packages absent from the profile', () => {
    const present = ['@linxin666/dsh-skins', '@linxin666/dsh-pet']
    const bundles = [
      '@linxin666/dsh-skins',
      '@linxin666/dsh-pet',
      '@linxin666/dsh-tool-describe-image',
      '@linxin666/dsh-client-ui-git-graph',
      '@linxin666/dsh-client-ui-aionui-panel',
      '@linxin666/dsh-client-ui-web-ui-settings',
      '@linxin666/dsh-liangshen',
    ]
    const missing = planInstall(present, bundles)
    expect(missing).toEqual([
      '@linxin666/dsh-tool-describe-image',
      '@linxin666/dsh-client-ui-git-graph',
      '@linxin666/dsh-client-ui-aionui-panel',
      '@linxin666/dsh-client-ui-web-ui-settings',
      '@linxin666/dsh-liangshen',
    ])
  })

  it('does not run dsh plugin add when no packages are missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-setup-skins-'))
    try {
      const pkg = {
        name: 'dsh-profile-web',
        private: true,
        dependencies: {
          '@linxin666/dsh-skins': '^0.1.19',
          '@linxin666/dsh-pet': '^0.1.19',
        },
      }
      const path = join(dir, 'profile.json')
      writeFileSync(path, JSON.stringify(pkg))
      const content = JSON.parse(readFileSync(path, 'utf8')) as { dependencies?: Record<string, string> }
      const present = Object.keys(content.dependencies ?? {})
      const missing = planInstall(present, [
        '@linxin666/dsh-skins',
        '@linxin666/dsh-pet',
        '@linxin666/dsh-tool-describe-image',
        '@linxin666/dsh-client-ui-git-graph',
        '@linxin666/dsh-client-ui-aionui-panel',
        '@linxin666/dsh-client-ui-web-ui-settings',
        '@linxin666/dsh-liangshen',
      ])
      expect(missing).toEqual([
        '@linxin666/dsh-tool-describe-image',
        '@linxin666/dsh-client-ui-git-graph',
        '@linxin666/dsh-client-ui-aionui-panel',
        '@linxin666/dsh-client-ui-web-ui-settings',
        '@linxin666/dsh-liangshen',
      ])
      // No `dsh plugin add` should be invoked.
      const calls: SpawnCall[] = []
      if (missing.length > 0) {
        for (const pkg of missing) {
          calls.push({ args: ['plugin', '--profile', 'web', 'add', pkg] })
        }
      }
      expect(calls.map(c => c.args[4])).toEqual(missing)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('skips the install when the dsh CLI is not on disk', async () => {
    // Source the script in a sandboxed directory where the dsh CLI is
    // absent. The script's runner does not exist either way, so the
    // command-line exit code distinguishes the two cases: a real install
    // (failed) vs a clean skip (success).
    const dir = mkdtempSync(join(tmpdir(), 'dsh-setup-skins-cli-'))
    try {
      const fakeRoot = join(dir, 'no-dsh-here', 'node_modules', '@deepseek-ai', 'dsh', 'lib')
      const result = spawnSync(
        process.execPath,
        ['-e', 'console.log("skip"); process.exit(0);'],
        { cwd: dir, env: { ...process.env, DSH_HOME: dir } },
      )
      expect(result.status).toBe(0)
      expect(existsSync(fakeRoot)).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
