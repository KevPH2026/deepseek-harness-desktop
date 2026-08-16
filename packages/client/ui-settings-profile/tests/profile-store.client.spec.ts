import { describe, expect, it, vi } from 'vitest'
import type { SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import { editableProfile } from '../src/client/profile-model.ts'
import { ProfileSettingsController } from '../src/client/profile-store.ts'

function view(value: unknown = {}, revision = 0): SettingsNamespaceView {
  return {
    ns: 'user-profile', schema: {}, value, revision, applies: 'live', secrets: [],
  }
}

function api(initial: unknown = {}) {
  let current = view(initial)
  const describe = vi.fn(async () => ({
    rpcId: 'describe',
    result: { ok: true as const, value: { writable: true, hasDocument: true, namespaces: [current] } },
  }))
  const mutate = vi.fn(async (request: { ops: Array<{ op: string; path: string[]; value?: unknown }> }) => {
    let next = { ...(current.value as Record<string, unknown>) }
    for (const op of request.ops) {
      const key = op.path[0]!
      if (op.op === 'set') next[key] = op.value
      else {
        const { [key]: _removed, ...kept } = next
        next = kept
      }
    }
    current = view(next, current.revision + 1)
    return { rpcId: 'mutate', result: { ok: true as const, value: current } }
  })
  return { api: { settings: { describe, mutate } } as never, describe, mutate }
}

describe('ProfileSettingsController', () => {
  it('loads optional values and defaults absent visibility to false', async () => {
    const wire = api({ preferredName: { value: 'Kev' } })
    const controller = new ProfileSettingsController(wire.api)
    await controller.load()
    expect(controller.store.getSnapshot()).toMatchObject({
      status: 'ready', writable: true, value: { preferredName: { value: 'Kev', agentVisible: false } },
    })
  })

  it('normalizes public handles and atomically completes onboarding', async () => {
    const wire = api()
    const controller = new ProfileSettingsController(wire.api)
    await controller.load()
    const draft = editableProfile({})
    draft.xHandle = { value: 'https://x.com/KevPH2026', agentVisible: true }
    draft.githubHandle = { value: 'https://github.com/KevPH2026/', agentVisible: false }
    await expect(controller.save(draft, true)).resolves.toBe(true)
    const request = wire.mutate.mock.calls[0]![0]
    expect(request.ops).toContainEqual({
      op: 'set', path: ['xHandle'], value: { value: 'KevPH2026', agentVisible: true },
    })
    expect(request.ops).toContainEqual({
      op: 'set', path: ['githubHandle'], value: { value: 'KevPH2026', agentVisible: false },
    })
    expect(request.ops).toContainEqual({
      op: 'set', path: ['onboarding'], value: { version: 1, state: 'completed' },
    })
    expect(controller.store.getSnapshot().onboarding).toEqual({ version: 1, state: 'completed' })
  })

  it('treats malformed website input as a validation failure without throwing or calling Host', async () => {
    const wire = api()
    const controller = new ProfileSettingsController(wire.api)
    await controller.load()
    const draft = editableProfile({})
    draft.websiteUrl.value = 'not a URL at all'
    await expect(controller.save(draft)).resolves.toBe(false)
    expect(wire.mutate).not.toHaveBeenCalled()
    expect(controller.store.getSnapshot().error).toBe('save')
  })

  it('persists a skip separately and clear removes fields but not onboarding', async () => {
    const wire = api({ preferredName: { value: 'Kev', agentVisible: true } })
    const controller = new ProfileSettingsController(wire.api)
    await controller.load()
    expect(await controller.skip()).toBe(true)
    expect(controller.store.getSnapshot().onboarding).toEqual({ version: 1, state: 'skipped' })
    expect(await controller.clear()).toBe(true)
    expect(controller.store.getSnapshot().value).toEqual({})
    expect(controller.store.getSnapshot().onboarding).toEqual({ version: 1, state: 'skipped' })
  })

  it('contains transport failures and ignores late loads after dispose', async () => {
    let settle: ((value: unknown) => void) | undefined
    const describe = vi.fn(() => new Promise((resolve) => { settle = resolve }))
    const controller = new ProfileSettingsController({ settings: { describe } } as never)
    const pending = controller.load()
    controller.dispose()
    settle?.({ rpcId: 'describe', result: { ok: false, error: { code: 'offline', message: 'offline' } } })
    await pending
    expect(controller.store.getSnapshot().status).toBe('loading')
  })
})
