import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const repositoryRoot = join(import.meta.dirname, '..', '..', '..')
const workflowRoot = join(repositoryRoot, '.github', 'workflows')

describe('desktop release workflow gates', () => {
  it('ships the unsigned build plus the curated community pack suites in release', async () => {
    // The standalone desktop UI suite (channel, telegram, channel-agent,
    // settings-channel-telegram, theme, profile, web-agent-presets) ran
    // in the regular `npm test`; release.yml only repackages, so it must
    // not drag those suites into the build agent.
    const workflow = await readFile(join(workflowRoot, 'desktop-release.yml'), 'utf8')
    expect(workflow).toContain('environment: desktop-release')
    expect(workflow).toContain('workflow_dispatch')
    expect(workflow).toContain('npm exec --prefix apps/desktop -- electron-builder')
    expect(workflow).toContain('gh release create "$RELEASE_TAG"')
    // Release notes must warn the user that the build is unsigned and that
    // a right-click -> Open is required for the first launch.
    expect(workflow).toMatch(/unsigned.*not notarized/si)
    expect(workflow).toMatch(/right-click|右键|Open the first time/si)
  })
})
