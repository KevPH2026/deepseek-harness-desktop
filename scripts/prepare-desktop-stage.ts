/**
 * Make pnpm's legacy desktop deployment self-contained for Electron Builder.
 *
 * The production deploy can omit direct workspace packages hoisted beside the
 * source project, while link: overrides can remain as paths into the checkout.
 * Restore every direct dependency and replace package links with real files so
 * the generated .app has no dependency on the source repository.
 */
import {
  copyFile, cp, lstat, mkdir, readFile, readdir, realpath, rm, stat, writeFile,
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

await copyFile(join(root, 'LICENSE'), join(stage, 'LICENSE'))
await copyFile(join(root, 'THIRD_PARTY_NOTICES.md'), join(stage, 'THIRD_PARTY_NOTICES.md'))
for (const filename of ['README.md', 'README.zh.md']) {
  await rewriteStagedLegalLinks(join(stage, filename))
}

console.log(
  `prepare-desktop-stage: restored ${String(restored.length)} direct dependencies, materialized ${String(materialized)} package links, and staged legal resources.`,
)

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
