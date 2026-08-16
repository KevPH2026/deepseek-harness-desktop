import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  desktopBundleShortVersion, desktopUpdaterVersion, readDesktopUpdaterVersion,
} from '../src/version.ts'

const desktopRoot = join(import.meta.dirname, '..')

describe('desktop version surfaces', () => {
  it('keeps prerelease SemVer in the package while configuring numeric Apple bundle versions', async () => {
    const manifest = JSON.parse(await readFile(join(desktopRoot, 'package.json'), 'utf8')) as unknown
    const updaterVersion = desktopUpdaterVersion(manifest)
    const builder = await readFile(join(desktopRoot, 'electron-builder.yml'), 'utf8')
    const bundleShortVersion = quotedYamlValue(builder, 'bundleShortVersion')
    const bundleVersion = quotedYamlValue(builder, 'bundleVersion')

    expect(updaterVersion).toBe('0.1.0-beta.2')
    expect(await readDesktopUpdaterVersion(desktopRoot)).toBe(updaterVersion)
    expect(bundleShortVersion).toBe(desktopBundleShortVersion(updaterVersion))
    expect(bundleShortVersion).toMatch(/^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){2}$/)
    expect(bundleVersion).toBe('2')
    expect(bundleVersion).toMatch(/^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){0,2}$/)
  })

  it('rejects non-SemVer package versions', () => {
    expect(() => desktopUpdaterVersion({ version: '0.1-beta' })).toThrow('invalid package SemVer')
    expect(() => desktopUpdaterVersion(null)).toThrow('package manifest must be an object')
  })
})

function quotedYamlValue(source: string, key: string): string {
  const match = new RegExp(`^\\s*${key}:\\s*['\"]([^'\"]+)['\"]\\s*$`, 'm').exec(source)
  if (match?.[1] === undefined) throw new Error(`Missing quoted ${key} in electron-builder.yml`)
  return match[1]
}
