/**
 * Electron main process for DeepSeek Harness Desktop.
 * @module @deepseek-ai/dsh-desktop
 */

import { appendFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  app, BrowserWindow, dialog, Menu, nativeImage, shell, Tray, type MessageBoxOptions,
} from 'electron'
import electronUpdater, { type UpdateInfo } from 'electron-updater'
import { launchHarness, type HarnessHandle } from './harness-process.ts'
import {
  DESKTOP_PRODUCT_NAME, desktopAboutOptions, desktopMenuTemplate, desktopTrayTemplate,
  isChineseDesktopLocale,
} from './menu.ts'
import { externalHttpUrl, isHarnessNavigation } from './navigation.ts'
import { createDesktopShutdown } from './shutdown.ts'
import { desktopUpdateEligibility } from './update-signature.ts'
import {
  createDesktopUpdateService, desktopAllowsPrerelease, desktopReleaseNotesSummary,
  desktopUpdateDownloadDetail, type DesktopUpdateClient, type DesktopUpdateInfo,
  type DesktopUpdatePrompts, type DesktopUpdateService,
} from './updater.ts'
import { readDesktopUpdaterVersion } from './version.ts'
import { createDesktopWindowLifecycle } from './window-lifecycle.ts'

const PRODUCT_NAME = DESKTOP_PRODUCT_NAME
// electron-updater is CommonJS. Its runtime `autoUpdater` export is available
// on the default namespace, but not as a native ESM named export in Electron.
const { MacUpdater } = electronUpdater

app.setName(PRODUCT_NAME)

let mainWindow: BrowserWindow | undefined
let tray: Tray | undefined
let harness: HarnessHandle | undefined
let startup: Promise<void> | undefined
let launchAbort: AbortController | undefined
let updates: DesktopUpdateService | undefined
const shutdown = createDesktopShutdown(async () => {
  launchAbort?.abort()
  await startup?.catch(() => {})
  updates?.stop()
  tray?.destroy()
  tray = undefined
  const current = harness
  harness = undefined
  await current?.stop()
}, (code) => { app.exit(code) })

const windowLifecycle = createDesktopWindowLifecycle({
  getWindow: () => mainWindow,
  createWindow: () => {
    if (harness === undefined) throw new Error('Harness is not ready')
    return createMainWindow(harness.url)
  },
  isQuitting: () => shutdown.active,
})

/** Unhide the macOS application before restoring its BrowserWindow. */
function showMainWindow(): void {
  if (process.platform === 'darwin') app.show()
  windowLifecycle.showWindow()
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (harness !== undefined) showMainWindow()
  })

  app.on('before-quit', (event) => {
    shutdown.beforeQuit(event)
  })

  app.on('activate', () => {
    if (harness !== undefined) showMainWindow()
  })

  app.on('window-all-closed', () => {
    // The system tray and supervised Harness own app lifetime on every platform.
  })

  void app.whenReady().then(() => {
    startup = startDesktop()
    return startup
  }).catch((error: unknown) => {
    if (shutdown.active) return
    const message = error instanceof Error ? error.message : String(error)
    dialog.showErrorBox(`${PRODUCT_NAME} could not start`, message)
    void shutdown.request(1)
  })
}

/** Boot the supervised Harness process before revealing the desktop window. */
async function startDesktop(): Promise<void> {
  app.setAppLogsPath()
  app.on('web-contents-created', (_event, contents) => {
    contents.session.setPermissionCheckHandler(() => false)
    contents.session.setPermissionRequestHandler((_webContents, _permission, callback) => { callback(false) })
  })
  const currentVersion = await readDesktopUpdaterVersion(app.getAppPath())
  const updateEligibility = await desktopUpdateEligibility(app.isPackaged, process.platform, process.execPath)
  updates = createDesktopUpdateService({
    client: electronUpdateClient(currentVersion),
    prompts: desktopUpdatePrompts(app.getLocale()),
    eligibility: updateEligibility,
    currentVersion,
    logger: { warn: (message) => { writeUpdateLog('warn', message) } },
  })
  installMenu(currentVersion)
  launchAbort = new AbortController()
  const launched = await launchHarness({
    executable: process.execPath,
    home: join(app.getPath('userData'), 'harness'),
    logPath: join(app.getPath('logs'), 'harness.log'),
    signal: launchAbort.signal,
  })
  launchAbort = undefined
  if (shutdown.active) {
    await launched.stop()
    return
  }
  harness = launched
  const current = launched
  void current.exit.then(({ code, signal }) => {
    if (shutdown.active || harness !== current) return
    dialog.showErrorBox(
      `${PRODUCT_NAME} stopped`,
      `The Harness process exited unexpectedly (code=${String(code)}, signal=${String(signal)}). Its log is in ${app.getPath('logs')}.`,
    )
    // Keep the handle published: stop() retains the spawned POSIX group id
    // and can still terminate surviving descendants after the leader closed.
    void shutdown.request(1)
  })
  createMainWindow(current.url)
  installTray()
  updates.start()
}

/** Create the single desktop window with no Node or arbitrary-navigation access. */
function createMainWindow(harnessOrigin: string): BrowserWindow {
  const window = new BrowserWindow({
    title: PRODUCT_NAME,
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#0b0d10',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })
  mainWindow = window

  window.once('ready-to-show', () => {
    if (process.platform === 'darwin') app.show()
    window.show()
    window.focus()
  })
  window.on('close', (event) => { windowLifecycle.onWindowClose(event) })
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = undefined
  })
  window.webContents.on('will-navigate', (event, target) => {
    if (isHarnessNavigation(target, harnessOrigin)) return
    event.preventDefault()
    const external = externalHttpUrl(target)
    if (external !== undefined) void shell.openExternal(external)
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isHarnessNavigation(url, harnessOrigin)) void window.loadURL(url)
    else {
      const external = externalHttpUrl(url)
      if (external !== undefined) void shell.openExternal(external)
    }
    return { action: 'deny' }
  })

  void window.loadURL(harnessOrigin).catch((error: unknown) => {
    if (window.isDestroyed() || shutdown.active) return
    const message = error instanceof Error ? error.message : String(error)
    dialog.showErrorBox(`${PRODUCT_NAME} could not load`, message)
  })
  return window
}

/** Install a persistent system tray backed by the official Harness favicon. */
function installTray(): void {
  if (tray !== undefined) return
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'desktop', 'tray-icon.png')
    : join(app.getAppPath(), 'build', 'tray-icon.png')
  let icon = nativeImage.createFromPath(iconPath)
  if (icon.isEmpty()) throw new Error(`desktop tray icon is missing: ${iconPath}`)
  if (process.platform === 'darwin') {
    icon = icon.resize({ width: 18, height: 18 })
    icon.setTemplateImage(true)
  }
  const current = new Tray(icon)
  tray = current
  current.setToolTip(PRODUCT_NAME)
  current.setContextMenu(Menu.buildFromTemplate(desktopTrayTemplate(app.getLocale(), {
    showWindow: showMainWindow,
    checkForUpdates: () => updates?.check(true),
    openExternal: url => shell.openExternal(url),
    quit: () => shutdown.request(0),
  })))
  current.on('click', showMainWindow)
}

/** Install a native macOS application menu without exposing privileged IPC. */
function installMenu(currentVersion: string): void {
  const locale = app.getLocale()
  app.setAboutPanelOptions(desktopAboutOptions(locale, currentVersion))
  const template = desktopMenuTemplate(locale, {
    version: currentVersion,
    openExternal: url => shell.openExternal(url),
    checkForUpdates: () => updates?.check(true),
  })
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/** Adapt the concrete updater without exposing it to focused unit tests. */
function electronUpdateClient(currentVersion: string): DesktopUpdateClient {
  // CFBundleShortVersionString must be numeric for Apple tooling, while update
  // comparison must retain the full package prerelease SemVer. MacUpdater's
  // public AppAdapter seam keeps those two version domains independent.
  const updater = new MacUpdater(undefined, desktopUpdaterApp(currentVersion))
  return {
    configure() {
      updater.autoDownload = false
      updater.autoInstallOnAppQuit = false
      updater.autoRunAppAfterInstall = true
      updater.allowPrerelease = desktopAllowsPrerelease(updater.currentVersion)
      updater.allowDowngrade = false
      updater.fullChangelog = false
      updater.disableWebInstaller = true
      updater.logger = {
        info: (message) => { writeUpdateLog('info', message) },
        warn: (message) => { writeUpdateLog('warn', message) },
        error: (message) => { writeUpdateLog('error', message) },
      }
    },
    onUpdateDownloaded(listener) {
      updater.on('update-downloaded', (info) => { listener(desktopUpdateInfo(info)) })
    },
    onError(listener) {
      updater.on('error', (error) => { listener(error) })
    },
    async checkForUpdates() {
      const result = await updater.checkForUpdates()
      if (result === null) return null
      return { isUpdateAvailable: result.isUpdateAvailable, update: desktopUpdateInfo(result.updateInfo) }
    },
    async downloadUpdate() {
      await updater.downloadUpdate()
    },
    quitAndInstall() {
      // electron-updater validates the macOS code signature before its native
      // quit. The existing before-quit coordinator then drains Harness before
      // app.exit releases the process for Squirrel.Mac installation.
      updater.quitAndInstall()
    },
  }
}

function desktopUpdaterApp(version: string) {
  return {
    version,
    get name() { return app.getName() },
    get isPackaged() { return app.isPackaged },
    get appUpdateConfigPath() {
      return app.isPackaged
        ? join(process.resourcesPath, 'app-update.yml')
        : join(app.getAppPath(), 'dev-app-update.yml')
    },
    get userDataPath() { return app.getPath('userData') },
    get baseCachePath() { return join(homedir(), 'Library', 'Caches') },
    whenReady() { return app.whenReady() },
    relaunch() { app.relaunch() },
    quit() { app.quit() },
    onQuit(handler: (exitCode: number) => void) {
      app.once('quit', (_event, exitCode) => { handler(exitCode) })
    },
  }
}

function desktopUpdateInfo(info: UpdateInfo): DesktopUpdateInfo {
  const releaseNotes = desktopReleaseNotesSummary(info.releaseNotes)
  return {
    version: info.version,
    ...(typeof info.releaseName === 'string' ? { releaseName: info.releaseName } : {}),
    ...(releaseNotes === undefined ? {} : { releaseNotes }),
  }
}

function desktopUpdatePrompts(locale: string): DesktopUpdatePrompts {
  const zh = isChineseDesktopLocale(locale)
  return {
    async confirmDownload(update) {
      return await nativeMessage({
        type: 'info',
        title: zh ? '发现更新' : 'Update Available',
        message: zh ? `版本 ${update.version} 已发布。` : `Version ${update.version} is available.`,
        detail: desktopUpdateDownloadDetail(zh, update),
        buttons: zh ? ['下载', '稍后'] : ['Download', 'Later'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      }) === 0
    },
    async confirmRestart(update) {
      return await nativeMessage({
        type: 'info',
        title: zh ? '更新已下载' : 'Update Downloaded',
        message: zh ? `版本 ${update.version} 已准备好安装。` : `Version ${update.version} is ready to install.`,
        detail: zh ? '现在重启并安装吗？' : 'Restart and install now?',
        buttons: zh ? ['重启并安装', '稍后'] : ['Restart and Install', 'Later'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      }) === 0
    },
    async showUpToDate(currentVersion) {
      await nativeMessage({
        type: 'info',
        title: zh ? '检查更新' : 'Check for Updates',
        message: zh ? `当前版本 ${currentVersion} 已是最新版本。` : `Version ${currentVersion} is up to date.`,
        buttons: [zh ? '好' : 'OK'],
        defaultId: 0,
        noLink: true,
      })
    },
    async showUnavailable() {
      await nativeMessage({
        type: 'info',
        title: zh ? '无法检查更新' : 'Updates Unavailable',
        message: zh ? '自动更新仅在已签名的正式安装版本中启用。' : 'Updates are enabled only in a signed release build.',
        buttons: [zh ? '好' : 'OK'],
        defaultId: 0,
        noLink: true,
      })
    },
    async showError(message) {
      await nativeMessage({
        type: 'error',
        title: zh ? '检查更新失败' : 'Update Check Failed',
        message: zh ? '暂时无法检查更新。' : 'Could not check for updates.',
        detail: message,
        buttons: [zh ? '好' : 'OK'],
        defaultId: 0,
        noLink: true,
      })
    },
  }
}

async function nativeMessage(options: MessageBoxOptions): Promise<number> {
  const owner = mainWindow
  const result = owner === undefined || owner.isDestroyed()
    ? await dialog.showMessageBox(options)
    : await dialog.showMessageBox(owner, options)
  return result.response
}

function writeUpdateLog(level: 'info' | 'warn' | 'error', message: unknown): void {
  const line = `[${new Date().toISOString()}] ${level}: ${String(message)}\n`
  void appendFile(join(app.getPath('logs'), 'updates.log'), line, 'utf8').catch(() => {})
}
