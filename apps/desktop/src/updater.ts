/** User-controlled GitHub Release updater orchestration. */

import type { DesktopUpdateEligibility } from './update-signature.ts'

/** Six-hour background cadence after the startup check. */
export const DESKTOP_UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000

/** Keep untrusted GitHub release text short enough for a native dialog. */
export const DESKTOP_RELEASE_NOTES_MAX_CHARACTERS = 1200

/** Minimal release metadata shown in native prompts. */
export interface DesktopUpdateInfo {
  version: string
  releaseName?: string
  /** Plain-text, length-bounded release notes only. */
  releaseNotes?: string
}

/** Result shape independent of electron-updater internals. */
export interface DesktopUpdateCheckResult {
  isUpdateAvailable: boolean
  update: DesktopUpdateInfo
}

/** Narrow adapter around electron-updater for deterministic tests. */
export interface DesktopUpdateClient {
  configure(): void
  onUpdateDownloaded(listener: (update: DesktopUpdateInfo) => void): void
  onError(listener: (error: Error) => void): void
  checkForUpdates(): Promise<DesktopUpdateCheckResult | null>
  downloadUpdate(): Promise<void>
  quitAndInstall(): void
}

/** Native dialogs supplied by the Electron main process. */
export interface DesktopUpdatePrompts {
  confirmDownload(update: DesktopUpdateInfo): Promise<boolean>
  confirmRestart(update: DesktopUpdateInfo): Promise<boolean>
  showUpToDate(currentVersion: string): Promise<void> | void
  showUnavailable(reason: DesktopUpdateEligibility['reason']): Promise<void> | void
  showError(message: string): Promise<void> | void
}

/** Update service exposed to startup, shutdown, and the native menu. */
export interface DesktopUpdateService {
  start(): void
  stop(): void
  check(interactive: boolean): Promise<void>
}

/** Diagnostic sink that keeps automatic failures non-disruptive. */
export interface DesktopUpdateLogger {
  warn(message: string): void
}

interface DesktopUpdateServiceOptions {
  client: DesktopUpdateClient
  prompts: DesktopUpdatePrompts
  eligibility: DesktopUpdateEligibility
  currentVersion: string
  logger: DesktopUpdateLogger
  intervalMs?: number
}

/**
 * Electron-updater defaults prerelease builds to their own semver channel.
 * Preserve that behavior explicitly: beta builds may advance to newer beta or
 * stable versions, while stable builds do not opt into prereleases.
 */
export function desktopAllowsPrerelease(currentVersion: unknown): boolean {
  if (currentVersion === null || typeof currentVersion !== 'object') return false
  const prerelease = (currentVersion as { prerelease?: unknown }).prerelease
  return Array.isArray(prerelease) && prerelease.length > 0
}

/** Convert GitHub's string/array release notes into bounded native-dialog text. */
export function desktopReleaseNotesSummary(releaseNotes: unknown): string | undefined {
  const source = Array.isArray(releaseNotes)
    ? releaseNotes.map(releaseNoteEntry).filter(value => value.length > 0).join('\n\n')
    : typeof releaseNotes === 'string' ? releaseNotes : ''
  const plain = plainReleaseNoteText(source)
  if (plain.length === 0) return undefined

  const characters = Array.from(plain)
  if (characters.length <= DESKTOP_RELEASE_NOTES_MAX_CHARACTERS) return plain
  return `${characters.slice(0, DESKTOP_RELEASE_NOTES_MAX_CHARACTERS - 1).join('')}…`
}

/** Native download-confirmation detail with an optional plain-text notes section. */
export function desktopUpdateDownloadDetail(isChinese: boolean, update: DesktopUpdateInfo): string {
  const prompt = isChinese ? '是否现在下载？' : 'Download it now?'
  if (update.releaseNotes === undefined) return prompt
  const heading = isChinese ? '版本说明：' : 'Release notes:'
  return `${prompt}\n\n${heading}\n${update.releaseNotes}`
}

/**
 * Create one coalesced updater: no automatic download, no install-on-quit,
 * and no network access from development/ad-hoc packages.
 */
export function createDesktopUpdateService(options: DesktopUpdateServiceOptions): DesktopUpdateService {
  const intervalMs = options.intervalMs ?? DESKTOP_UPDATE_INTERVAL_MS
  let started = false
  let stopped = false
  let timer: NodeJS.Timeout | undefined
  let checking: Promise<void> | undefined
  let interactiveRequested = false
  let downloadedPrompt: Promise<void> | undefined

  options.client.configure()
  options.client.onError((error) => {
    options.logger.warn(`desktop updater: ${error.message}`)
  })
  options.client.onUpdateDownloaded((update) => {
    if (stopped || downloadedPrompt !== undefined) return
    downloadedPrompt = promptForRestart(update).finally(() => { downloadedPrompt = undefined })
  })

  const check = (interactive: boolean): Promise<void> => {
    if (stopped) return Promise.resolve()
    if (!options.eligibility.enabled) {
      return Promise.resolve(interactive ? options.prompts.showUnavailable(options.eligibility.reason) : undefined)
    }
    if (interactive) interactiveRequested = true
    if (checking !== undefined) return checking
    checking = checkOnce().finally(() => {
      checking = undefined
      interactiveRequested = false
    })
    return checking
  }

  return {
    start() {
      if (started || stopped) return
      started = true
      if (!options.eligibility.enabled) return
      void check(false)
      timer = setInterval(() => { void check(false) }, intervalMs)
      timer.unref()
    },
    stop() {
      if (stopped) return
      stopped = true
      if (timer !== undefined) clearInterval(timer)
      timer = undefined
    },
    check,
  }

  async function checkOnce(): Promise<void> {
    try {
      const result = await options.client.checkForUpdates()
      if (result === null || !result.isUpdateAvailable) {
        if (interactiveRequested) await options.prompts.showUpToDate(options.currentVersion)
        return
      }
      if (await options.prompts.confirmDownload(result.update)) await options.client.downloadUpdate()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      options.logger.warn(`desktop updater check failed: ${message}`)
      if (interactiveRequested) await options.prompts.showError(message)
    }
  }

  async function promptForRestart(update: DesktopUpdateInfo): Promise<void> {
    try {
      if (await options.prompts.confirmRestart(update)) options.client.quitAndInstall()
    } catch (error) {
      options.logger.warn(`desktop updater install prompt failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

function releaseNoteEntry(value: unknown): string {
  if (value === null || typeof value !== 'object') return ''
  const entry = value as { note?: unknown; version?: unknown }
  const note = typeof entry.note === 'string' ? entry.note : ''
  const version = typeof entry.version === 'string' ? entry.version.trim() : ''
  return version.length === 0 ? note : `${version}\n${note}`
}

function plainReleaseNoteText(value: string): string {
  const decoded = value
    .replace(/<br\b[^>]*>/gi, '\n')
    .replace(/<\/(?:div|h[1-6]|li|p)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (match, digits: string) => decodeNumericEntity(match, digits, 10))
    .replace(/&#x([\da-f]+);/gi, (match, digits: string) => decodeNumericEntity(match, digits, 16))
    .replace(/\r\n?/g, '\n')

  return Array.from(decoded)
    .filter((character) => {
      const point = character.codePointAt(0) ?? 0
      return point >= 32 || character === '\n' || character === '\t'
    })
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function decodeNumericEntity(match: string, digits: string, radix: number): string {
  const point = Number.parseInt(digits, radix)
  return Number.isSafeInteger(point) && point >= 0 && point <= 0x10_FFFF
    ? String.fromCodePoint(point)
    : match
}
