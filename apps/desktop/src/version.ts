/** Desktop package-version access independent of macOS bundle metadata. */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const SEMVER = new RegExp(
  '^(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)'
  + '(?:-[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?'
  + '(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$',
)

/** Extract the full updater SemVer from an unknown package manifest. */
export function desktopUpdaterVersion(manifest: unknown): string {
  if (manifest === null || typeof manifest !== 'object') {
    throw new Error('desktop version: package manifest must be an object.')
  }
  const version = (manifest as { version?: unknown }).version
  if (typeof version !== 'string' || !SEMVER.test(version)) {
    throw new Error(`desktop version: invalid package SemVer ${String(version)}.`)
  }
  return version
}

/** Read the packaged app manifest, whose version remains the updater SemVer. */
export async function readDesktopUpdaterVersion(appPath: string): Promise<string> {
  const source = await readFile(join(appPath, 'package.json'), 'utf8')
  return desktopUpdaterVersion(JSON.parse(source) as unknown)
}

/** Numeric marketing version required by CFBundleShortVersionString. */
export function desktopBundleShortVersion(updaterVersion: string): string {
  return desktopUpdaterVersion({ version: updaterVersion }).replace(/[+-].*$/, '')
}
