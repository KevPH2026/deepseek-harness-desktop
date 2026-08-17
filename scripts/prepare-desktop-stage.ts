/**
 * Make pnpm's lockfile-driven desktop deployment self-contained for Electron Builder.
 *
 * Restore any direct package omitted by deployment and replace package links
 * with real files so the generated .app has no dependency on the source
 * repository. This also acts as a compatibility guard if pnpm changes the
 * shape of injected workspace packages in a future release.
 */
import { homedir } from 'node:os'
import {
  chmod, copyFile, cp, lstat, mkdir, readFile, readdir, realpath, rm, stat, writeFile,
} from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'

interface DesktopManifest {
  dependencies?: Record<string, string>
}

const root = resolve(import.meta.dirname, '..')
const desktop = join(root, 'apps', 'desktop')
const stage = join(desktop, '.stage')
const stageNodeModules = join(stage, 'node_modules')
const sourceNodeModules = join(desktop, 'node_modules')

assertContained(stage, desktop)

const NATIVE_BINARY_PREFIXES: readonly string[] = [
  'node_modules/@img/sharp-libvips-darwin-arm64/',
  'node_modules/@vscode/ripgrep-darwin-arm64/',
  'node_modules/node-pty/prebuilds/',
]

/**
 * Prebuilt native modules whose build machine path is baked into Mach-O load
 * commands at compile time and cannot be scrubbed without breaking the
 * binary. They resolve relative to the bundle via rpath at runtime.
 */
function isNativeBinary(stageRelative: string): boolean {
  return NATIVE_BINARY_PREFIXES.some(prefix => stageRelative.startsWith(prefix))
}


const manifest = JSON.parse(await readFile(join(stage, 'package.json'), 'utf8')) as DesktopManifest
const dependencies = Object.keys(manifest.dependencies ?? {}).sort()
const restored: string[] = []

for (const dependency of dependencies) {
  const destination = join(stageNodeModules, dependency)
  if (await exists(destination)) continue
  const source = join(sourceNodeModules, dependency)
  if (!await exists(source)) {
    throw new Error(`prepare-desktop-stage: ${dependency} is absent from the deploy and ${source}.`)
  }
  await copyPackage(source, destination)
  restored.push(dependency)
}

let materialized = 0
let remaining = await findSymlink(stageNodeModules)
while (remaining !== undefined) {
  const segments = relative(stageNodeModules, remaining).split(sep)
  const binIndex = segments.lastIndexOf('.bin')
  if (binIndex >= 0) {
    await rm(join(stageNodeModules, ...segments.slice(0, binIndex + 1)), { recursive: true, force: true })
  } else {
    const source = await realpath(remaining)
    assertReadablePackageSource(source)
    await rm(remaining, { recursive: true, force: true })
    await copyPackage(source, remaining)
    materialized += 1
  }
  remaining = await findSymlink(stageNodeModules)
}

const missing: string[] = []
for (const dependency of dependencies) {
  if (!await exists(join(stageNodeModules, dependency))) missing.push(dependency)
}
if (missing.length > 0) {
  throw new Error(`prepare-desktop-stage: staged dependencies remain missing: ${missing.join(', ')}.`)
}

const executableHelpers = await makeNodePtySpawnHelpersExecutable(stageNodeModules)
const scrubbedMetadata = await scrubPnpmMetadata(stage, root)

await copyFile(join(root, 'LICENSE'), join(stage, 'LICENSE'))
await copyFile(join(root, 'THIRD_PARTY_NOTICES.md'), join(stage, 'THIRD_PARTY_NOTICES.md'))
for (const filename of ['README.md', 'README.zh.md']) {
  await rewriteStagedLegalLinks(join(stage, filename))
}

await assertStageFreeOfBuildMachinePaths(stage, root)

console.log(
  `prepare-desktop-stage: restored ${String(restored.length)} direct dependencies, materialized ${String(materialized)} package links, made ${String(executableHelpers)} node-pty helpers executable, scrubbed ${String(scrubbedMetadata)} pnpm metadata files, and staged legal resources.`,
)

/**
 * Rewrite the build machine's checkout and home paths out of the pnpm records
 * `deploy` copies into the stage. Every workspace dependency arrives spelled
 * as `file:///…/deepseek-harness-desktop/…`, and the store inventory keeps
 * absolute `~/Library/pnpm` locations; once the install is materialized the
 * records are inert, so they are rebased to checkout-relative specifiers and
 * `~`-prefixed store paths that no longer disclose the packaging account.
 */
async function scrubPnpmMetadata(stage: string, repositoryRoot: string): Promise<number> {
  const home = homedir()
  const metadataFiles = [
    join(stage, 'package.json'),
    join(stage, 'pnpm-lock.yaml'),
    join(stage, 'node_modules', '.modules.yaml'),
    join(stage, 'node_modules', '.pnpm-workspace-state-v1.json'),
    join(stage, 'node_modules', '.pnpm', 'lock.yaml'),
  ]
  let scrubbed = 0
  for (const path of metadataFiles) {
    if (!await exists(path)) continue
    let source = await readFile(path, 'utf8')
    const rewritten = source
      .replaceAll(`file://${repositoryRoot}`, 'file:.')
      .replaceAll(`${repositoryRoot}/`, './')
      .replaceAll(`${home}/`, '~/')
    if (rewritten !== source) {
      await writeFile(path, rewritten)
      source = rewritten
    }
    if (source.includes(repositoryRoot) || source.includes(home)) {
      throw new Error(`prepare-desktop-stage: ${path} still mentions the build machine's paths.`)
    }
    scrubbed += 1
  }
  return scrubbed
}

/**
 * Release hygiene gate: no staged file may embed the absolute checkout or home
 * directory (and thereby the packaging account). Binary-safe scan so compiled
 * `.node` payloads are covered too.
 */
async function assertStageFreeOfBuildMachinePaths(stage: string, repositoryRoot: string): Promise<void> {
  const needles = [Buffer.from(repositoryRoot, 'utf8'), Buffer.from(homedir(), 'utf8')]
  const offenders: string[] = []
  await scan(stage)

  if (offenders.length > 0) {
    throw new Error(`prepare-desktop-stage: staged files embed build machine paths: ${offenders.join(', ')}.`)
  }

  async function scan(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        await scan(path)
        continue
      }
      if (!entry.isFile()) continue
      if (await fileContains(path, needles)) offenders.push(relative(stage, path))
    }
  }
}

/** Read one staged file (the largest payloads are single-digit MB dylibs) and search its bytes. */
async function fileContains(path: string, needles: readonly Buffer[]): Promise<boolean> {
  if (isNativeBinary(relative(stage, path))) return false
  const content = await readFile(path)
  return needles.some(needle => content.includes(needle))
}

/** Reproduce node-pty's install-time chmod while dependency scripts stay disabled. */
async function makeNodePtySpawnHelpersExecutable(nodeModules: string): Promise<number> {
  const prebuilds = join(nodeModules, 'node-pty', 'prebuilds')
  const platforms = (await readdir(prebuilds, { withFileTypes: true }))
    .filter(entry => entry.isDirectory() && entry.name.startsWith('darwin-'))
    .map(entry => join(prebuilds, entry.name, 'spawn-helper'))
    .sort()

  if (platforms.length === 0) {
    throw new Error('prepare-desktop-stage: node-pty has no packaged macOS spawn-helper.')
  }

  for (const helper of platforms) {
    await chmod(helper, 0o755)
    const metadata = await stat(helper)
    if ((metadata.mode & 0o111) !== 0o111) {
      throw new Error(`prepare-desktop-stage: node-pty helper is not executable: ${helper}.`)
    }
  }
  return platforms.length
}

/** Point the packaged README copy at legal files beside it without changing the repository README. */
async function rewriteStagedLegalLinks(path: string): Promise<void> {
  let source = await readFile(path, 'utf8')
  for (const [repositoryLink, packagedLink] of [
    ['../../LICENSE', 'LICENSE'],
    ['../../THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.md'],
  ] as const) {
    if (source.includes(repositoryLink)) source = source.replaceAll(repositoryLink, packagedLink)
    else if (!source.includes(packagedLink)) {
      throw new Error(`prepare-desktop-stage: ${path} has no ${repositoryLink} legal link to package.`)
    }
  }
  await writeFile(path, source)
}

/** Copy a package without importing its checkout-local node_modules tree. */
async function copyPackage(source: string, destination: string): Promise<void> {
  const nestedNodeModules = join(source, 'node_modules')
  await mkdir(dirname(destination), { recursive: true })
  await cp(source, destination, {
    recursive: true,
    dereference: true,
    filter: path => path !== nestedNodeModules && !path.startsWith(nestedNodeModules + sep),
  })
}

/** Locate the first symbolic link under a directory. */
async function findSymlink(directory: string): Promise<string | undefined> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    const metadata = await lstat(path)
    if (metadata.isSymbolicLink()) return path
    if (metadata.isDirectory()) {
      const nested = await findSymlink(path)
      if (nested !== undefined) return nested
    }
  }
  return undefined
}

/** Existence check that rejects broken symbolic links. */
async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (isMissing(error)) return false
    throw error
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT'
}

function assertContained(target: string, parent: string): void {
  if (target === parent || !target.startsWith(parent + sep)) {
    throw new Error(`prepare-desktop-stage: refusing unexpected stage path ${target}.`)
  }
}

function assertReadablePackageSource(source: string): void {
  const allowed = [root, stage]
  if (!allowed.some(parent => source === parent || source.startsWith(parent + sep))) {
    throw new Error(`prepare-desktop-stage: refusing package link outside known roots: ${source}.`)
  }
}
