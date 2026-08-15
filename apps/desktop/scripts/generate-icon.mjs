import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

if (process.platform !== 'darwin') throw new Error('generate-icon: macOS iconutil is required')

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const root = resolve(desktop, '../..')
const source = join(root, 'apps', 'web', 'public', 'favicon.svg')
const outputDirectory = join(desktop, 'build')
const output = join(outputDirectory, 'icon.icns')
const trayOutput = join(outputDirectory, 'tray-icon.png')
const provenance = join(outputDirectory, 'icon-source.json')
const sourceBefore = await readFile(source)
const sourceHash = sha256(sourceBefore)
const expectedSourceHash = 'c61a62a9d47d8660f9cfe08aac6775ff0476f7d6c5053f7659c1f8493fd6d814'
if (sourceHash !== expectedSourceHash) throw new Error(`generate-icon: official Web favicon changed (${sourceHash})`)
const temporary = await mkdtemp(join(tmpdir(), 'deepseek-harness-desktop-icon-'))
const iconset = join(temporary, 'DeepSeekHarness.iconset')

const variants = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024],
]

try {
  await mkdir(iconset)
  await mkdir(outputDirectory, { recursive: true })
  await Promise.all(variants.map(async ([filename, size]) => {
    await sharp(sourceBefore, { density: 2048 })
      .resize(size, size, { fit: 'fill' })
      .png({ compressionLevel: 9, palette: false })
      .toFile(join(iconset, filename))
  }))
  await sharp(sourceBefore, { density: 512 })
    .resize(36, 36, { fit: 'fill' })
    .png({ compressionLevel: 9, palette: false })
    .toFile(trayOutput)
  execFileSync('/usr/bin/iconutil', ['--convert', 'icns', '--output', output, iconset])
} finally {
  await rm(temporary, { recursive: true, force: true })
}

const sourceAfter = await readFile(source)
if (sha256(sourceAfter) !== sourceHash) throw new Error('generate-icon: source favicon changed during conversion')
const iconHash = sha256(await readFile(output))
const trayIconHash = sha256(await readFile(trayOutput))
await writeFile(provenance, `${JSON.stringify({
  source: 'apps/web/public/favicon.svg',
  sourceSha256: sourceHash,
  icnsSha256: iconHash,
  trayPngSha256: trayIconHash,
}, null, 2)}\n`)
console.log(`generate-icon: ${output} from apps/web/public/favicon.svg (${sourceHash})`)

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}
