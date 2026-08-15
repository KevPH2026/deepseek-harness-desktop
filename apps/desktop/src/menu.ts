/** Locale-aware native menu and About copy for the desktop wrapper. */

import type { MenuItemConstructorOptions } from 'electron'

/** Stable desktop product label. */
export const DESKTOP_PRODUCT_NAME = 'DeepSeek Harness Desktop'
/** Upstream project link retained separately from community attribution. */
export const UPSTREAM_PROJECT_URL = 'https://github.com/deepseek-ai/deepseek-harness'
/** Community maintainer identity shown in native surfaces. */
export const COMMUNITY_MAINTAINER = '@KevPH2026'
/** Community maintainer link retained until a verified fork URL exists. */
export const COMMUNITY_MAINTAINER_URL = 'https://github.com/KevPH2026'
/** Verified community desktop repository used for releases and support. */
export const COMMUNITY_REPOSITORY_URL = 'https://github.com/KevPH2026/deepseek-harness-desktop'
/** Published desktop release history. */
export const RELEASE_NOTES_URL = `${COMMUNITY_REPOSITORY_URL}/releases`
/** New-issue entry point for desktop feedback. */
export const FEEDBACK_URL = `${COMMUNITY_REPOSITORY_URL}/issues/new/choose`
/** Upstream license link. */
export const LICENSE_URL = `${UPSTREAM_PROJECT_URL}/blob/master/LICENSE`
/** Upstream third-party-notice link. */
export const THIRD_PARTY_NOTICES_URL = `${UPSTREAM_PROJECT_URL}/blob/master/THIRD_PARTY_NOTICES.md`

interface DesktopNativeCopy {
  about: string
  edit: string
  view: string
  window: string
  help: string
  upstream: string
  community: string
  license: string
  notices: string
  version: (version: string) => string
  checkUpdates: string
  releaseNotes: string
  feedback: string
  openWindow: string
  running: string
  quit: string
  copyright: string
  credits: string
}

/** About-panel fields accepted by Electron without coupling tests to its runtime. */
export interface DesktopAboutOptions {
  applicationName: string
  applicationVersion: string
  copyright: string
  credits: string
}

type ExternalOpener = (url: string) => Promise<void> | void

/** Runtime actions and version injected by the Electron main process. */
export interface DesktopMenuActions {
  version: string
  openExternal: ExternalOpener
  checkForUpdates: () => Promise<void> | void
}

/** Whether Electron's resolved application locale is Chinese. */
export function isChineseDesktopLocale(locale: string): boolean {
  return /^zh(?:[-_]|$)/i.test(locale.trim())
}

function nativeCopy(locale: string): DesktopNativeCopy {
  if (isChineseDesktopLocale(locale)) {
    return {
      about: `关于 ${DESKTOP_PRODUCT_NAME}`,
      edit: '编辑',
      view: '显示',
      window: '窗口',
      help: '帮助',
      upstream: '上游 DeepSeek Harness（GitHub）',
      community: `社区桌面封装维护者 ${COMMUNITY_MAINTAINER}`,
      license: 'MIT 许可证',
      notices: '第三方声明',
      version: version => `版本 ${version}`,
      checkUpdates: '检查更新…',
      releaseNotes: '版本说明',
      feedback: '反馈问题',
      openWindow: '打开主窗口',
      running: 'Harness 运行中',
      quit: '退出',
      copyright: 'DeepSeek Harness 版权所有 (c) 2026 DeepSeek',
      credits: `非官方社区桌面封装，由 ${COMMUNITY_MAINTAINER} 维护。\n\n基于 DeepSeek Harness，并按 MIT 许可证分发。`,
    }
  }
  return {
    about: `About ${DESKTOP_PRODUCT_NAME}`,
    edit: 'Edit',
    view: 'View',
    window: 'Window',
    help: 'Help',
    upstream: 'Upstream DeepSeek Harness on GitHub',
    community: `Community desktop wrapper by ${COMMUNITY_MAINTAINER}`,
    license: 'MIT License',
    notices: 'Third-Party Notices',
    version: version => `Version ${version}`,
    checkUpdates: 'Check for Updates…',
    releaseNotes: 'Release Notes',
    feedback: 'Send Feedback',
    openWindow: 'Open Main Window',
    running: 'Harness is running',
    quit: 'Quit',
    copyright: 'DeepSeek Harness copyright (c) 2026 DeepSeek',
    credits: `Unofficial community desktop wrapper maintained by ${COMMUNITY_MAINTAINER}.\n\nBased on DeepSeek Harness and distributed under the MIT License.`,
  }
}

/** Build locale-aware About-panel metadata while preserving upstream ownership. */
export function desktopAboutOptions(locale: string, version: string): DesktopAboutOptions {
  const copy = nativeCopy(locale)
  return {
    applicationName: DESKTOP_PRODUCT_NAME,
    applicationVersion: version,
    copyright: copy.copyright,
    credits: copy.credits,
  }
}

/** Build the native application menu with stable upstream and maintainer targets. */
export function desktopMenuTemplate(
  locale: string,
  actions: DesktopMenuActions,
): MenuItemConstructorOptions[] {
  const copy = nativeCopy(locale)
  return [
    {
      label: DESKTOP_PRODUCT_NAME,
      submenu: [
        { label: copy.about, role: 'about' },
        { label: copy.version(actions.version), enabled: false },
        { label: copy.checkUpdates, click: () => { void actions.checkForUpdates() } },
        { label: copy.releaseNotes, click: () => { void actions.openExternal(RELEASE_NOTES_URL) } },
        { label: copy.feedback, click: () => { void actions.openExternal(FEEDBACK_URL) } },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: copy.edit,
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      ],
    },
    {
      label: copy.view,
      submenu: [
        { role: 'reload' }, { role: 'forceReload' }, { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' }, { role: 'togglefullscreen' },
      ],
    },
    {
      label: copy.window,
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }],
    },
    {
      label: copy.help,
      role: 'help',
      submenu: [
        { label: copy.upstream, click: () => { void actions.openExternal(UPSTREAM_PROJECT_URL) } },
        { label: copy.community, click: () => { void actions.openExternal(COMMUNITY_REPOSITORY_URL) } },
        { type: 'separator' },
        { label: copy.license, click: () => { void actions.openExternal(LICENSE_URL) } },
        { label: copy.notices, click: () => { void actions.openExternal(THIRD_PARTY_NOTICES_URL) } },
      ],
    },
  ]
}

/** Runtime actions available from the persistent system-tray menu. */
export interface DesktopTrayActions {
  /** Restore or recreate the desktop window. */
  showWindow: () => void
  /** Run the same interactive updater used by the native application menu. */
  checkForUpdates: () => Promise<void> | void
  /** Open a validated HTTP(S) target in the system browser. */
  openExternal: ExternalOpener
  /** Gracefully stop Harness and terminate the desktop process. */
  quit: () => Promise<void> | void
}

/** Build the locale-aware system-tray menu. */
export function desktopTrayTemplate(
  locale: string,
  actions: DesktopTrayActions,
): MenuItemConstructorOptions[] {
  const copy = nativeCopy(locale)
  return [
    { label: copy.running, enabled: false },
    { label: copy.openWindow, click: actions.showWindow },
    { type: 'separator' },
    { label: copy.checkUpdates, click: () => { void actions.checkForUpdates() } },
    { label: copy.releaseNotes, click: () => { void actions.openExternal(RELEASE_NOTES_URL) } },
    { label: copy.feedback, click: () => { void actions.openExternal(FEEDBACK_URL) } },
    { type: 'separator' },
    { label: copy.quit, click: () => { void actions.quit() } },
  ]
}
