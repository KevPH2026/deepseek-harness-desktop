import { describe, expect, it, vi } from 'vitest'
import {
  desktopUpdateEligibility, macAppBundlePath, type DesktopUpdateEligibility,
} from '../src/update-signature.ts'
import {
  createDesktopUpdateService, DESKTOP_RELEASE_NOTES_MAX_CHARACTERS,
  desktopAllowsPrerelease, desktopReleaseNotesSummary, desktopUpdateDownloadDetail,
  type DesktopUpdateCheckResult, type DesktopUpdateClient, type DesktopUpdateInfo,
  type DesktopUpdatePrompts,
} from '../src/updater.ts'

function fakeClient(result: DesktopUpdateCheckResult | null = null) {
  let downloaded!: (update: DesktopUpdateInfo) => void
  let failed!: (error: Error) => void
  const client = {
    configure: vi.fn(),
    onUpdateDownloaded(listener) { downloaded = listener },
    onError(listener) { failed = listener },
    checkForUpdates: vi.fn(async (): Promise<DesktopUpdateCheckResult | null> => result),
    downloadUpdate: vi.fn(async (): Promise<void> => {}),
    quitAndInstall: vi.fn((): void => {}),
  } satisfies DesktopUpdateClient
  return {
    ...client,
    emitDownloaded(update: DesktopUpdateInfo) { downloaded(update) },
    emitError(error: Error) { failed(error) },
  }
}

function fakePrompts() {
  return {
    confirmDownload: vi.fn(async (_update: DesktopUpdateInfo): Promise<boolean> => true),
    confirmRestart: vi.fn(async (_update: DesktopUpdateInfo): Promise<boolean> => true),
    showUpToDate: vi.fn((_version: string): void => {}),
    showUnavailable: vi.fn((_reason: DesktopUpdateEligibility['reason']): void => {}),
    showError: vi.fn((_message: string): void => {}),
  } satisfies DesktopUpdatePrompts
}

const signed: DesktopUpdateEligibility = { enabled: true, reason: 'signed-release' }

describe('desktop update metadata', () => {
  it('follows prerelease channels only from an installed prerelease', () => {
    expect(desktopAllowsPrerelease({ prerelease: ['beta', 1] })).toBe(true)
    expect(desktopAllowsPrerelease({ prerelease: [] })).toBe(false)
  })

  it('turns string and array release notes into bounded plain text', () => {
    expect(desktopReleaseNotesSummary('<h2>Highlights</h2><p>Image &amp; video</p>')).toBe(
      'Highlights\nImage & video',
    )
    expect(desktopReleaseNotesSummary([
      { version: '0.2.0-beta.2', note: '<p>First</p>' },
      { version: '0.2.0-beta.1', note: 'Second' },
    ])).toBe('0.2.0-beta.2\nFirst\n\n0.2.0-beta.1\nSecond')

    const bounded = desktopReleaseNotesSummary(`<script>${'x'.repeat(2000)}</script>`)
    expect(bounded).toBeDefined()
    expect(Array.from(bounded ?? '')).toHaveLength(DESKTOP_RELEASE_NOTES_MAX_CHARACTERS)
    expect(bounded).not.toContain('<script>')
    expect(bounded?.endsWith('…')).toBe(true)
  })

  it('adds the sanitized notes to the download confirmation detail', () => {
    const update = { version: '0.2.0', releaseNotes: 'Desktop shell\nMedia tools' }
    expect(desktopUpdateDownloadDetail(false, update)).toBe(
      'Download it now?\n\nRelease notes:\nDesktop shell\nMedia tools',
    )
    expect(desktopUpdateDownloadDetail(true, update)).toContain('版本说明：\nDesktop shell')
  })
})

describe('Developer ID update gate', () => {
  it('resolves the enclosing macOS bundle from the Electron executable', () => {
    expect(macAppBundlePath('/Applications/DeepSeek Harness Desktop.app/Contents/MacOS/DeepSeek Harness Desktop'))
      .toBe('/Applications/DeepSeek Harness Desktop.app')
  })

  it('keeps development, other platforms, and ad-hoc packages offline', async () => {
    const probe = vi.fn(async () => 'Signature=adhoc\nTeamIdentifier=not set\n')
    await expect(desktopUpdateEligibility(false, 'darwin', '/tmp/Electron', probe))
      .resolves.toEqual({ enabled: false, reason: 'development' })
    await expect(desktopUpdateEligibility(true, 'linux', '/tmp/Electron', probe))
      .resolves.toEqual({ enabled: false, reason: 'unsupported-platform' })
    await expect(desktopUpdateEligibility(true, 'darwin', '/tmp/App.app/Contents/MacOS/App', probe))
      .resolves.toEqual({ enabled: false, reason: 'signature-unverified' })
    expect(probe).toHaveBeenCalledOnce()
  })

  it('enables only a verified Developer ID identity with a Team ID', async () => {
    const signature = [
      'Authority=Developer ID Application: Example (ABCDE12345)',
      'TeamIdentifier=ABCDE12345',
    ].join('\n')
    await expect(desktopUpdateEligibility(
      true, 'darwin', '/tmp/App.app/Contents/MacOS/App', async () => signature,
    )).resolves.toEqual(signed)
  })
})

describe('desktop updater orchestration', () => {
  it('checks on startup and on the interval without downloading when current', async () => {
    vi.useFakeTimers()
    const client = fakeClient({ isUpdateAvailable: false, update: { version: '0.1.0' } })
    const prompts = fakePrompts()
    const service = createDesktopUpdateService({
      client, prompts, eligibility: signed, currentVersion: '0.1.0', logger: { warn: vi.fn() }, intervalMs: 1000,
    })

    service.start()
    await vi.waitFor(() => { expect(client.checkForUpdates.mock.calls).toHaveLength(1) })
    await vi.advanceTimersByTimeAsync(1000)
    expect(client.checkForUpdates.mock.calls).toHaveLength(2)
    expect(prompts.showUpToDate.mock.calls).toHaveLength(0)
    service.stop()
    vi.useRealTimers()
  })

  it('asks before download and again before restart/install', async () => {
    const update = { version: '0.2.0', releaseName: 'Desktop 0.2.0' }
    const client = fakeClient({ isUpdateAvailable: true, update })
    const prompts = fakePrompts()
    const service = createDesktopUpdateService({
      client, prompts, eligibility: signed, currentVersion: '0.1.0', logger: { warn: vi.fn() },
    })

    await service.check(true)
    expect(prompts.confirmDownload.mock.calls).toEqual([[update]])
    expect(client.downloadUpdate.mock.calls).toHaveLength(1)

    client.emitDownloaded(update)
    await vi.waitFor(() => { expect(client.quitAndInstall.mock.calls).toHaveLength(1) })
    expect(prompts.confirmRestart.mock.calls).toEqual([[update]])
  })

  it('fails soft without a signed package and explains only manual checks', async () => {
    const client = fakeClient()
    const prompts = fakePrompts()
    const service = createDesktopUpdateService({
      client,
      prompts,
      eligibility: { enabled: false, reason: 'signature-unverified' },
      currentVersion: '0.1.0-beta.1',
      logger: { warn: vi.fn() },
    })

    service.start()
    expect(client.checkForUpdates.mock.calls).toHaveLength(0)
    expect(prompts.showUnavailable.mock.calls).toHaveLength(0)
    await service.check(true)
    expect(prompts.showUnavailable.mock.calls).toEqual([['signature-unverified']])
  })

  it('logs background errors and surfaces interactive failures', async () => {
    const client = fakeClient()
    client.checkForUpdates.mockRejectedValue(new Error('offline'))
    const prompts = fakePrompts()
    const warn = vi.fn()
    const service = createDesktopUpdateService({ client, prompts, eligibility: signed, currentVersion: '1.0.0', logger: { warn } })

    await service.check(false)
    expect(warn).toHaveBeenCalledWith('desktop updater check failed: offline')
    expect(prompts.showError.mock.calls).toHaveLength(0)
    await service.check(true)
    expect(prompts.showError.mock.calls).toEqual([['offline']])

    client.emitError(new Error('provider error'))
    expect(warn).toHaveBeenCalledWith('desktop updater: provider error')
  })
})
