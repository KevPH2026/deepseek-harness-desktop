import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as UserProfile from '../src/index.ts'

class MemorySettings extends SettingsProvider {
  readonly writable = true
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve({}) }
  protected persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> { return Promise.resolve() }
}

let root: string | undefined
let ctx: Context | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
  ctx = undefined
})

describe('user-profile real Loader composition', () => {
  it('loads after settings and system-prompt and registers both owned seams', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-user-profile-loader-'))
    const path = join(root, 'cordis.yml')
    await writeFile(path, [
      "- name: '@test/settings'",
      "- name: '@deepseek-ai/dsh-system-prompt'",
      "- name: '@deepseek-ai/dsh-user-profile'",
      '',
    ].join('\n'))
    ctx = new Context()
    ctx.baseUrl = pathToFileURL(root).href + '/'
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@test/settings', MemorySettings],
      ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
      ['@deepseek-ai/dsh-user-profile', UserProfile],
    ])
    ctx.loader.internal = {
      version: 'v2',
      import: (specifier: string) => Promise.resolve(modules.get(specifier)),
    } as unknown as NonNullable<typeof ctx.loader.internal>
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(path).href } })
    await ctx.loader.await()
    expect(ctx.settings.describe().map(entry => String(entry.ns))).toContain('user-profile')
    expect((await ctx.systemPrompt.assemble()).contexts).toEqual([])
  })
})
