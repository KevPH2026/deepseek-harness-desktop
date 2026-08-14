import { describe, expect, it, vi } from 'vitest'
import type {
  IApiClient, RpcResponse, SettingsNamespaceView,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { MEDIA_SETTINGS_NAMESPACE, type MediaGenerationConfig } from '../src/types.ts'
import { MediaSettingsStore, type MediaSettingsWrite } from '../src/client/settings-store.ts'

let rpc = 0
function ok<T>(value: T): RpcResponse<T> {
  return { rpcId: `media-${rpc++}` as never, result: { ok: true, value } }
}

function fail<T>(message: string): RpcResponse<T> {
  return {
    rpcId: `media-${rpc++}` as never,
    result: { ok: false, error: { code: 'internal', message, details: {} } },
  }
}

const CONFIG: MediaGenerationConfig = {
  approval: 'always',
  image: {
    enabled: true,
    baseURL: 'https://api.openai.com/v1',
    model: 'gpt-image-2',
    apiKeyEnv: 'OPENAI_API_KEY',
    defaultSize: 'auto',
    defaultQuality: 'auto',
  },
  video: {
    enabled: false,
    baseURL: 'https://generativelanguage.googleapis.com/v1beta',
    model: 'veo-3.1-generate-preview',
    apiKeyEnv: 'GOOGLE_API_KEY',
    defaultAspectRatio: '16:9',
    defaultDuration: '4',
    defaultResolution: '720p',
  },
}

class FakeScope implements SettingsScope<MediaGenerationConfig> {
  private listeners = new Set<() => void>()
  snapshot: SettingsScopeSnapshot<MediaGenerationConfig> = {
    status: 'ready',
    value: structuredClone(CONFIG),
    base: structuredClone(CONFIG),
    user: {},
    revision: 1,
    writable: true,
    mode: 'host',
  }

  getSnapshot(): SettingsScopeSnapshot<MediaGenerationConfig> { return this.snapshot }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  async set(field: string, value: unknown): Promise<void> {
    this.snapshot = {
      ...this.snapshot,
      value: { ...this.snapshot.value, [field]: structuredClone(value) },
      user: { ...(this.snapshot.user as object), [field]: structuredClone(value) },
      revision: (this.snapshot.revision ?? 0) + 1,
    }
    for (const listener of this.listeners) listener()
  }

  async unset(field: string): Promise<void> {
    const { [field]: _removed, ...value } = this.snapshot.value as Record<string, unknown>
    this.snapshot = { ...this.snapshot, value, revision: (this.snapshot.revision ?? 0) + 1 }
    for (const listener of this.listeners) listener()
  }
}

type CredentialStatus = { configured: boolean; writable: boolean }
type SettingsMutation = Parameters<IApiClient['settings']['mutate']>[0]

function namespace(config: MediaGenerationConfig, revision = 2): SettingsNamespaceView {
  return {
    ns: MEDIA_SETTINGS_NAMESPACE,
    schema: {},
    value: structuredClone(config),
    base: structuredClone(CONFIG),
    user: structuredClone(config),
    applies: 'live',
    secrets: [],
    revision,
  }
}

function configAfter(ops: SettingsMutation['ops']): MediaGenerationConfig {
  const next = structuredClone(CONFIG) as Record<string, unknown>
  for (const op of ops) {
    if (op.op === 'set' && op.path.length === 1) next[op.path[0]!] = structuredClone(op.value)
  }
  return next
}

function api(overrides: {
  configured?: Record<string, CredentialStatus>
  describe?: (refs: string[]) => Promise<RpcResponse<{ credentials: Record<string, CredentialStatus> }>>
  set?: (ref: string, value: string) => Promise<RpcResponse<Record<string, never>>>
  unset?: (ref: string) => Promise<RpcResponse<Record<string, never>>>
  mutate?: (payload: SettingsMutation) => Promise<RpcResponse<SettingsNamespaceView>>
} = {}) {
  const described: string[][] = []
  const written: Array<{ ref: string; value: string }> = []
  const unset: string[] = []
  const mutations: SettingsMutation[] = []
  const events: string[] = []
  const configured: Record<string, CredentialStatus> = {
    OPENAI_API_KEY: { configured: true, writable: true },
    GOOGLE_API_KEY: { configured: false, writable: true },
    ...overrides.configured,
  }
  return {
    described,
    written,
    unset,
    mutations,
    events,
    face: {
      credentials: {
        describe: ({ refs }: { refs: string[] }) => {
          described.push(refs)
          return (overrides.describe ?? (async requested => ok({
            credentials: Object.fromEntries(requested.map(ref => [ref, {
              configured: configured[ref]?.configured ?? false,
              writable: configured[ref]?.writable ?? true,
            }])),
          })))(refs)
        },
        set: async ({ ref, value }: { ref: string; value: string }) => {
          written.push({ ref, value })
          events.push(`credential:set:${ref}`)
          const response = await (overrides.set ?? (async () => ok({})))(ref, value)
          if (response.result.ok) configured[ref] = { configured: true, writable: true }
          return response
        },
        unset: async ({ ref }: { ref: string }) => {
          unset.push(ref)
          events.push(`credential:unset:${ref}`)
          const response = await (overrides.unset ?? (async () => ok({})))(ref)
          if (response.result.ok) configured[ref] = { configured: false, writable: true }
          return response
        },
      },
      settings: {
        mutate: async (payload: SettingsMutation) => {
          mutations.push(structuredClone(payload))
          events.push('settings:mutate')
          return (overrides.mutate ?? (async request => ok(
            namespace(configAfter(request.ops), (request.expectedRevision ?? 1) + 1),
          )))(payload)
        },
      },
    } as never,
  }
}

function write(overrides: Partial<MediaSettingsWrite> = {}): MediaSettingsWrite {
  return {
    approval: 'video-only',
    image: { ...CONFIG.image } as MediaSettingsWrite['image'],
    video: { ...CONFIG.video, enabled: true } as MediaSettingsWrite['video'],
    imageApiKey: '  new-image-key  ',
    videoApiKey: '',
    ...overrides,
  }
}

describe('MediaSettingsStore', () => {
  it('joins the namespace with both credential states', async () => {
    const scope = new FakeScope()
    const { face, described } = api()
    const controller = new MediaSettingsStore(scope, face)
    await vi.waitFor(() => { expect(controller.store.getSnapshot().imageCredential.status).toBe('ready') })
    expect(described).toEqual([['OPENAI_API_KEY', 'GOOGLE_API_KEY']])
    expect(controller.store.getSnapshot()).toMatchObject({
      status: 'ready',
      writable: true,
      imageCredential: { ref: 'OPENAI_API_KEY', configured: true, writable: true },
      videoCredential: { ref: 'GOOGLE_API_KEY', configured: false, writable: true },
      credentialError: null,
    })
    controller.dispose()
  })

  it('stores non-blank credentials before one revision-fenced atomic settings mutation', async () => {
    const scope = new FakeScope()
    const { face, written, mutations, events } = api()
    const controller = new MediaSettingsStore(scope, face)
    await vi.waitFor(() => { expect(controller.store.getSnapshot().imageCredential.status).toBe('ready') })
    await expect(controller.save(write())).resolves.toBe(true)
    expect(controller.store.getSnapshot().config).toMatchObject({
      approval: 'video-only',
      image: { model: 'gpt-image-2' },
      video: { enabled: true, defaultDuration: '4' },
    })
    expect(written).toEqual([{ ref: 'OPENAI_API_KEY', value: 'new-image-key' }])
    expect(events).toEqual(['credential:set:OPENAI_API_KEY', 'settings:mutate'])
    expect(mutations).toEqual([{
      ns: MEDIA_SETTINGS_NAMESPACE,
      ops: [
        { op: 'set', path: ['approval'], value: 'video-only' },
        { op: 'set', path: ['image'], value: CONFIG.image },
        { op: 'set', path: ['video'], value: { ...CONFIG.video, enabled: true } },
      ],
      expectedRevision: 1,
    }])
    expect(controller.store.getSnapshot()).toMatchObject({
      saving: false, saveError: null, savedRevision: 1, revision: 2,
    })
    controller.dispose()
  })

  it('does not mutate settings when a credential write fails', async () => {
    const scope = new FakeScope()
    const { face, written, mutations, events } = api({
      configured: { OPENAI_API_KEY: { configured: false, writable: true } },
      set: async ref => ref === 'GOOGLE_API_KEY' ? fail('video credential rejected') : ok({}),
    })
    const controller = new MediaSettingsStore(scope, face)
    await vi.waitFor(() => { expect(controller.store.getSnapshot().imageCredential.status).toBe('ready') })
    const next = write({ videoApiKey: 'new-video-key' })
    await expect(controller.save(next)).resolves.toBe(false)
    expect(written).toEqual([
      { ref: 'OPENAI_API_KEY', value: 'new-image-key' },
      { ref: 'GOOGLE_API_KEY', value: 'new-video-key' },
    ])
    expect(mutations).toEqual([])
    expect(events).toEqual([
      'credential:set:OPENAI_API_KEY',
      'credential:set:GOOGLE_API_KEY',
    ])
    expect(controller.store.getSnapshot().config?.approval).toBe('always')
    expect(controller.store.getSnapshot()).toMatchObject({
      saving: false,
      saveError: { stage: 'credentials', message: 'video credential rejected' },
      savedRevision: 0,
    })
    controller.dispose()
  })

  it('keeps settings unchanged when the atomic mutation is rejected after credentials land', async () => {
    const scope = new FakeScope()
    const { face, written, mutations } = api({ mutate: async () => fail('stale settings revision') })
    const controller = new MediaSettingsStore(scope, face)
    await vi.waitFor(() => { expect(controller.store.getSnapshot().imageCredential.status).toBe('ready') })
    await expect(controller.save(write())).resolves.toBe(false)
    expect(written).toEqual([{ ref: 'OPENAI_API_KEY', value: 'new-image-key' }])
    expect(mutations).toHaveLength(1)
    expect(controller.store.getSnapshot()).toMatchObject({
      config: { approval: 'always' },
      saveError: { stage: 'settings', message: 'stale settings revision' },
      savedRevision: 0,
    })
    controller.dispose()
  })

  it('marks a thrown settings mutation as unknown rather than claiming rollback', async () => {
    const scope = new FakeScope()
    const { face } = api({ mutate: async () => { throw new Error('connection closed') } })
    const controller = new MediaSettingsStore(scope, face)
    await vi.waitFor(() => { expect(controller.store.getSnapshot().imageCredential.status).toBe('ready') })
    await expect(controller.save(write({ imageApiKey: '' }))).resolves.toBe(false)
    expect(controller.store.getSnapshot().saveError).toEqual({
      stage: 'settings-unknown', message: 'connection closed',
    })
    controller.dispose()
  })

  it('removes a configured writable credential even when settings are read-only', async () => {
    const scope = new FakeScope()
    scope.snapshot = { ...scope.snapshot, writable: false }
    const { face, unset } = api()
    const controller = new MediaSettingsStore(scope, face)
    await vi.waitFor(() => { expect(controller.store.getSnapshot().imageCredential.status).toBe('ready') })
    await expect(controller.removeCredential('image')).resolves.toBe(true)
    expect(unset).toEqual(['OPENAI_API_KEY'])
    await vi.waitFor(() => {
      expect(controller.store.getSnapshot().imageCredential).toMatchObject({
        status: 'ready', configured: false,
      })
    })
    expect(controller.store.getSnapshot()).toMatchObject({
      removingCredential: null, credentialActionError: null, removedCredential: 'image',
    })
    controller.dispose()
  })

  it('keeps a configured credential visible when removal fails', async () => {
    const scope = new FakeScope()
    const { face, unset } = api({ unset: async () => fail('credential is shadowed') })
    const controller = new MediaSettingsStore(scope, face)
    await vi.waitFor(() => { expect(controller.store.getSnapshot().imageCredential.status).toBe('ready') })
    await expect(controller.removeCredential('image')).resolves.toBe(false)
    expect(unset).toEqual(['OPENAI_API_KEY'])
    expect(controller.store.getSnapshot()).toMatchObject({
      imageCredential: { configured: true },
      removingCredential: null,
      credentialActionError: { kind: 'image', message: 'credential is shadowed' },
      removedCredential: null,
    })
    controller.dispose()
  })

  it('refuses to remove an unconfigured or read-only credential', async () => {
    const scope = new FakeScope()
    const { face, unset } = api({
      configured: { OPENAI_API_KEY: { configured: true, writable: false } },
    })
    const controller = new MediaSettingsStore(scope, face)
    await vi.waitFor(() => { expect(controller.store.getSnapshot().imageCredential.status).toBe('ready') })
    await expect(controller.removeCredential('image')).resolves.toBe(false)
    await expect(controller.removeCredential('video')).resolves.toBe(false)
    expect(unset).toEqual([])
    controller.dispose()
  })

  it('degrades credential status without hiding settings', async () => {
    const scope = new FakeScope()
    const { face } = api({ describe: async () => fail('credential store offline') })
    const controller = new MediaSettingsStore(scope, face)
    await vi.waitFor(() => { expect(controller.store.getSnapshot().imageCredential.status).toBe('error') })
    expect(controller.store.getSnapshot()).toMatchObject({
      status: 'ready',
      credentialError: 'credential store offline',
    })
    controller.dispose()
  })

  it('refreshes only credential references addressed by the page', async () => {
    const scope = new FakeScope()
    const { face, described } = api()
    const controller = new MediaSettingsStore(scope, face)
    await vi.waitFor(() => { expect(controller.store.getSnapshot().imageCredential.status).toBe('ready') })
    controller.refreshCredential('UNRELATED_KEY')
    await Promise.resolve()
    expect(described).toHaveLength(1)
    controller.refreshCredential('GOOGLE_API_KEY')
    await vi.waitFor(() => { expect(described).toHaveLength(2) })
    controller.dispose()
  })
})
