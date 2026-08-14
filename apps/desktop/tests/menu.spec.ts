import type { MenuItemConstructorOptions } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import {
  COMMUNITY_REPOSITORY_URL,
  desktopAboutOptions,
  desktopMenuTemplate,
  FEEDBACK_URL,
  isChineseDesktopLocale,
  RELEASE_NOTES_URL,
  UPSTREAM_PROJECT_URL,
} from '../src/menu.ts'

function submenu(item: MenuItemConstructorOptions | undefined): MenuItemConstructorOptions[] {
  if (item === undefined || !Array.isArray(item.submenu)) throw new Error('expected submenu array')
  return item.submenu
}

describe('desktop native localization', () => {
  it('recognizes Electron Chinese locale variants without changing other languages', () => {
    expect(isChineseDesktopLocale('zh-CN')).toBe(true)
    expect(isChineseDesktopLocale('zh-Hans-CN')).toBe(true)
    expect(isChineseDesktopLocale('zh_TW')).toBe(true)
    expect(isChineseDesktopLocale('en-US')).toBe(false)
  })

  it('shows Chinese community attribution in About for zh-CN', () => {
    expect(desktopAboutOptions('zh-CN', '0.1.0-rc.5')).toEqual({
      applicationName: 'DeepSeek Harness Desktop',
      applicationVersion: '0.1.0-rc.5',
      copyright: 'DeepSeek Harness 版权所有 (c) 2026 DeepSeek',
      credits: '非官方社区桌面封装，由 @KevPH2026 维护。\n\n基于 DeepSeek Harness，并按 MIT 许可证分发。',
    })
  })

  it('keeps the English About copy outside Chinese locales', () => {
    const about = desktopAboutOptions('en-US', '1.2.3')
    expect(about).toMatchObject({
      applicationVersion: '1.2.3',
      copyright: 'DeepSeek Harness copyright (c) 2026 DeepSeek',
    })
    expect(about.credits).toContain('Unofficial community desktop wrapper maintained by @KevPH2026.')
  })

  it('localizes top-level and Help labels while retaining upstream and author links', () => {
    const openExternal = vi.fn(async (_url: string) => {})
    const checkForUpdates = vi.fn(async () => {})
    const template = desktopMenuTemplate('zh-CN', { version: '0.1.0-beta.1', openExternal, checkForUpdates })
    expect(template.map(item => item.label)).toEqual([
      'DeepSeek Harness Desktop', '编辑', '显示', '窗口', '帮助',
    ])

    const appMenu = submenu(template[0])
    expect(appMenu[0]).toMatchObject({ label: '关于 DeepSeek Harness Desktop', role: 'about' })
    expect(appMenu[1]).toMatchObject({ label: '版本 0.1.0-beta.1', enabled: false })
    expect(appMenu[2]?.label).toBe('检查更新…')
    expect(appMenu[3]?.label).toBe('版本说明')
    expect(appMenu[4]?.label).toBe('反馈问题')
    appMenu[2]?.click?.(undefined as never, undefined, undefined as never)
    appMenu[3]?.click?.(undefined as never, undefined, undefined as never)
    appMenu[4]?.click?.(undefined as never, undefined, undefined as never)
    expect(checkForUpdates).toHaveBeenCalledOnce()
    const help = submenu(template[4])
    expect(help[0]?.label).toBe('上游 DeepSeek Harness（GitHub）')
    expect(help[1]?.label).toBe('社区桌面封装维护者 @KevPH2026')
    help[0]?.click?.(undefined as never, undefined, undefined as never)
    help[1]?.click?.(undefined as never, undefined, undefined as never)
    expect(openExternal).toHaveBeenNthCalledWith(1, RELEASE_NOTES_URL)
    expect(openExternal).toHaveBeenNthCalledWith(2, FEEDBACK_URL)
    expect(openExternal).toHaveBeenNthCalledWith(3, UPSTREAM_PROJECT_URL)
    expect(openExternal).toHaveBeenNthCalledWith(4, COMMUNITY_REPOSITORY_URL)
  })

  it('uses English version and update labels outside Chinese locales', () => {
    const template = desktopMenuTemplate('en-US', {
      version: '1.2.3', openExternal: vi.fn(), checkForUpdates: vi.fn(),
    })
    expect(submenu(template[0]).slice(0, 5).map(item => item.label)).toEqual([
      'About DeepSeek Harness Desktop', 'Version 1.2.3', 'Check for Updates…',
      'Release Notes', 'Send Feedback',
    ])
    expect(submenu(template[4]).map(item => item.label).filter(Boolean)).not.toContain('Release Notes')
    expect(submenu(template[4]).map(item => item.label).filter(Boolean)).not.toContain('Send Feedback')
  })
})
