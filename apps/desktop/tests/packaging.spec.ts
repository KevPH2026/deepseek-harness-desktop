import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const desktopRoot = join(import.meta.dirname, '..')

describe('desktop packaging resources', () => {
  it('packages the official-favicon-derived tray icon at the runtime path', async () => {
    const builder = await readFile(join(desktopRoot, 'electron-builder.yml'), 'utf8')
    expect(builder).toContain([
      '  - from: build/tray-icon.png',
      '    to: desktop/tray-icon.png',
    ].join('\n'))
  })

  it('preserves the community About package English README after Electron Builder pruning', async () => {
    const builder = await readFile(join(desktopRoot, 'electron-builder.yml'), 'utf8')
    const packagePath = 'node_modules/@deepseek-ai/dsh-client-ui-settings-about-community/README.md'
    const resource = [
      `  - from: .stage/${packagePath}`,
      `    to: app/${packagePath}`,
    ].join('\n')

    expect(builder.split(resource)).toHaveLength(2)
  })
})
