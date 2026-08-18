/**
 * Install the curated community skins and pet into the running Harness
 * web profile.
 *
 * The desktop release ships only the three built-in skins (Deep Sea Blue,
 * Aurora Night, Warm Paper) and the official pet slot. To reproduce the
 * public demo's surface — skin center with ten community skins and the
 * whale pet — run this script after `pnpm install`:
 *
 *     pnpm setup:skins
 *
 * Each `dsh plugin add` call is idempotent: it is a no-op when the
 * package is already present in `profiles/web/package.json`, so re-runs
 * are safe. The script discovers the runtime CLI entry from
 * `apps/desktop/node_modules` first, then falls back to
 * `node_modules/@deepseek-ai/dsh/lib/bin.js`, so it works whether the
 * command runs from the repo root or from `apps/desktop`.
 */
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Every entry this script wants the running profile to have. */
const COMMUNITY_BUNDLE = [
  '@linxin666/dsh-skins',
  '@linxin666/dsh-pet',
  '@linxin666/dsh-tool-describe-image',
  '@linxin666/dsh-client-ui-git-graph',
  '@linxin666/dsh-client-ui-aionui-panel',
  '@linxin666/dsh-client-ui-web-ui-settings',
  '@linxin666/dsh-liangshen',
] as const

/**
 * Locate the running dsh CLI. The published app bundles it under
 * `apps/desktop/node_modules/@deepseek-ai/dsh`; a dev checkout
 * typically has it at the repo root.
 */
function locateDshBin(): string | undefined {
  for (const candidate of [
    resolve(root, 'apps/desktop/node_modules/@deepseek-ai/dsh/lib/bin.js'),
    resolve(root, 'node_modules/@deepseek-ai/dsh/lib/bin.js'),
  ]) {
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

function currentProfileDependencies(): Set<string> {
  // Import the profile manifest dynamically so a failed lookup shows
  // the same error to the user as a stale profile.
  const { readFileSync } = require('node:fs') as typeof import('node:fs')
  const { homedir } = require('node:os') as typeof import('node:os')
  const { join } = require('node:path') as typeof import('node:path')
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const candidates = [join(home, 'profiles/web/package.json'), join(home, 'profiles/web/package.json.tmp')]
  for (const path of candidates) {
    if (existsSync(path)) {
      try {
        const manifest = JSON.parse(readFileSync(path, 'utf8')) as { dependencies?: Record<string, string> }
        return new Set(Object.keys(manifest.dependencies ?? {}))
      } catch {
        // Fall through to a fresh empty set so the script still tries
        // to add the missing packages.
      }
    }
  }
  return new Set()
}

function runPlugin(bin: string, args: readonly string[]): void {
  const result = spawnSync(process.execPath, [bin, ...args], {
    stdio: 'inherit',
    env: process.env,
  })
  if (result.status !== 0) {
    throw new Error(`dsh ${args.join(' ')} exited with status ${result.status}`)
  }
}

const bin = locateDshBin()
if (bin === undefined) {
  console.log('setup-skins: dsh CLI not found; skipping (run after `pnpm install --frozen-lockfile` once).')
  process.exit(0)
}

const alreadyInstalled = currentProfileDependencies()
const missing = COMMUNITY_BUNDLE.filter(pkg => !alreadyInstalled.has(pkg))

if (missing.length === 0) {
  console.log(`setup-skins: all ${COMMUNITY_BUNDLE.length} curated packages are already in the web profile; nothing to do.`)
  process.exit(0)
}

console.log(`setup-skins: installing ${missing.length} package(s) into the web profile: ${missing.join(', ')}`)
for (const pkg of missing) {
  runPlugin(bin, ['plugin', '--profile', 'web', 'add', pkg])
}
console.log(`setup-skins: done. Restart the desktop app to see the new skins, the whale pet, and the skin-center shortcut.`)
