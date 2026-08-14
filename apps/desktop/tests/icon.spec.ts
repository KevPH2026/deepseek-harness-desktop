import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

interface IconProvenance {
  source: string
  sourceSha256: string
  icnsSha256: string
}

const root = resolve(import.meta.dirname, '../../..')
const desktopBuild = join(root, 'apps', 'desktop', 'build')

describe('desktop icon provenance', () => {
  it('pins the generated ICNS to the exact official Web favicon bytes', async () => {
    const provenance = JSON.parse(
      await readFile(join(desktopBuild, 'icon-source.json'), 'utf8'),
    ) as IconProvenance
    const source = await readFile(join(root, provenance.source))
    const icon = await readFile(join(desktopBuild, 'icon.icns'))

    expect(provenance).toEqual({
      source: 'apps/web/public/favicon.svg',
      sourceSha256: 'c61a62a9d47d8660f9cfe08aac6775ff0476f7d6c5053f7659c1f8493fd6d814',
      icnsSha256: sha256(icon),
    })
    expect(sha256(source)).toBe(provenance.sourceSha256)
    expect(icon.subarray(0, 4).toString('ascii')).toBe('icns')
  })
})

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}
