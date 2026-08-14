import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const builtMain = resolve(import.meta.dirname, '..', 'apps', 'desktop', 'lib', 'main.js')
const source = await readFile(builtMain, 'utf8')

if (!/import\s+electronUpdater\s+from\s+["']electron-updater["']/.test(source)) {
  throw new Error('verify-desktop-built-main: built main must default-import the CommonJS electron-updater module.')
}
if (/import\s*\{[^}]*\}\s*from\s*["']electron-updater["']/.test(source)) {
  throw new Error('verify-desktop-built-main: built main contains an unsafe ESM named import from electron-updater.')
}
if (!/const\s*\{\s*MacUpdater\s*\}\s*=\s*electronUpdater/.test(source)) {
  throw new Error('verify-desktop-built-main: built main does not resolve MacUpdater from the CommonJS namespace.')
}

console.log('verify-desktop-built-main: CommonJS electron-updater interop is safe in the built Electron entry.')
