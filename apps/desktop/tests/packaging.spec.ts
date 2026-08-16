import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const desktopRoot = join(import.meta.dirname, '..')
const repositoryRoot = join(desktopRoot, '..', '..')

describe('desktop packaging resources', () => {
  it('stages production dependencies from the frozen workspace lockfile without lifecycle scripts', async () => {
    const manifest = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>
    }
    const stage = manifest.scripts?.['desktop:stage'] ?? ''

    expect(stage).toContain('tsx scripts/reset-desktop-stage.ts && pnpm')
    expect(stage).toContain('deploy --prod --frozen-lockfile --trust-lockfile --ignore-scripts')
    expect(stage).toContain('--config.inject-workspace-packages=true')
    expect(stage).toContain('--config.auto-install-peers=true')
    expect(stage).not.toContain('deploy --force')
    expect(stage).not.toContain('--legacy')
  })

  it('restores node-pty spawn-helper execute permissions after scriptless staging', async () => {
    const prepare = await readFile(join(repositoryRoot, 'scripts', 'prepare-desktop-stage.ts'), 'utf8')

    expect(prepare).toContain('entry.name.startsWith(\'darwin-\')')
    expect(prepare).toContain('await chmod(helper, 0o755)')
    expect(prepare).toContain('metadata.mode & 0o111')
  })

  it('scrubs the build machine checkout and home paths from pnpm records and rejects any leak left in the stage', async () => {
    const prepare = await readFile(join(repositoryRoot, 'scripts', 'prepare-desktop-stage.ts'), 'utf8')

    expect(prepare).toContain('await scrubPnpmMetadata(stage, root)')
    expect(prepare).toContain("join(stage, 'node_modules', '.modules.yaml')")
    expect(prepare).toContain("join(stage, 'node_modules', '.pnpm-workspace-state-v1.json')")
    expect(prepare).toContain("replaceAll(`${home}/`, '~/')")
    expect(prepare).toContain('await assertStageFreeOfBuildMachinePaths(stage, root)')
    expect(prepare).toContain('embed build machine paths')
  })

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

  it('preserves every Telegram channel package README language set after pruning', async () => {
    const builder = await readFile(join(desktopRoot, 'electron-builder.yml'), 'utf8')
    const packages = [
      '@deepseek-ai/dsh-channel',
      '@deepseek-ai/dsh-channel-agent',
      '@deepseek-ai/dsh-channel-telegram',
      '@deepseek-ai/dsh-client-ui-settings-channel-telegram',
    ]

    for (const packageName of packages) {
      for (const fileName of ['README.md', 'README.zh.md', 'README.i18n.yaml']) {
        const packagePath = `node_modules/${packageName}/${fileName}`
        const resource = [
          `  - from: .stage/${packagePath}`,
          `    to: app/${packagePath}`,
        ].join('\n')

        expect(builder.split(resource), `${packageName}/${fileName}`).toHaveLength(2)
      }
    }
  })

  it('registers the Telegram provider before recovering Agent channel deliveries', async () => {
    const patch = await readFile(
      join(desktopRoot, '..', '..', 'packages', 'bundle', 'web-app', 'cordis.patch.yml'),
      'utf8',
    )
    const channel = patch.indexOf('- id: channel\n')
    const telegram = patch.indexOf('- id: channel-telegram\n')
    const agent = patch.indexOf('- id: channel-agent\n')

    expect(channel).toBeGreaterThanOrEqual(0)
    expect(telegram).toBeGreaterThan(channel)
    expect(agent).toBeGreaterThan(telegram)
  })
})
