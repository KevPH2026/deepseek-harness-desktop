import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const repositoryRoot = join(import.meta.dirname, '..', '..', '..')
const workflowRoot = join(repositoryRoot, '.github', 'workflows')

describe('desktop release workflow gates', () => {
  it('runs phone-control, remote-fence, skin, and profile suites in CI and release', async () => {
    const targets = [
      'packages/interaction/channel/tests',
      'packages/interaction/channel-agent/tests',
      'packages/interaction/channel-telegram/tests',
      'packages/client/ui-settings-channel-telegram/tests',
      'packages/client/connection/tests/node-half.host.spec.ts',
      'apps/cli/tests/web-agent-presets.e2e.ts',
      'packages/client/ui-theme/tests',
      'packages/context/user-profile/tests',
      'packages/client/ui-settings-profile/tests',
    ]

    for (const workflowName of ['desktop-ci.yml', 'desktop-release.yml']) {
      const workflow = await readFile(join(workflowRoot, workflowName), 'utf8')
      for (const target of targets) expect(workflow, `${workflowName}: ${target}`).toContain(target)
    }
  })

  it('keeps manual approval and notarizes the DMG before creating the GitHub Release', async () => {
    const workflow = await readFile(join(workflowRoot, 'desktop-release.yml'), 'utf8')
    const submit = workflow.indexOf('xcrun notarytool submit "$dmg_path"')
    const wait = workflow.indexOf('            --wait', submit)
    const staple = workflow.indexOf('xcrun stapler staple "$dmg_path"', submit)
    const validate = workflow.indexOf('xcrun stapler validate "$dmg_path"', staple)
    const assess = workflow.indexOf('spctl --assess --type open', validate)
    const release = workflow.indexOf('gh release create "$RELEASE_TAG"')

    expect(workflow).toContain('environment: desktop-release')
    expect(submit).toBeGreaterThanOrEqual(0)
    expect(wait).toBeGreaterThan(submit)
    expect(staple).toBeGreaterThan(wait)
    expect(validate).toBeGreaterThan(staple)
    expect(assess).toBeGreaterThan(validate)
    expect(release).toBeGreaterThan(assess)
  })
})
