/** Profile Settings wire controller. */

import type { IApiClient, SettingsNamespaceView, SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import {
  canonicalProfileValue, PROFILE_FIELD_KEYS, type EditableProfile, type ProfileValue,
} from './profile-model.ts'

/** Host settings namespace owning public profile data. */
export const PROFILE_SETTINGS_NAMESPACE = 'user-profile'
/** Onboarding marker generation understood by this client. */
export const PROFILE_ONBOARDING_VERSION = 1

/** Immutable UI snapshot for profile settings and first-run onboarding. */
export interface ProfileSettingsState {
  /** Namespace loading state. */
  status: 'idle' | 'loading' | 'ready' | 'unavailable' | 'error'
  /** Whether the Host settings document is writable. */
  writable: boolean
  /** Optimistic-concurrency revision returned by the Host. */
  revision: number | undefined
  /** Sparse canonical profile snapshot. */
  value: ProfileValue
  /** Durable completion or skip marker, when onboarding has finished. */
  onboarding: { version: 1; state: 'completed' | 'skipped' } | undefined
  /** Mutation currently in flight. */
  action: 'idle' | 'saving' | 'clearing' | 'skipping'
  /** Stable error category rendered by the UI. */
  error: 'load' | 'save' | null
  /** Whether the most recent profile save completed. */
  saved: boolean
}

/** Public controller surface shared by settings and onboarding components. */
export interface ProfileSettingsControllerFace {
  /** Observable immutable profile state. */
  store: SnapshotStore<ProfileSettingsState>
  /** Load or refresh the namespace. */
  load: () => Promise<void>
  /** Atomically save every profile field. */
  save: (draft: EditableProfile, finishOnboarding?: boolean) => Promise<boolean>
  /** Persist a deliberate empty onboarding skip. */
  skip: () => Promise<boolean>
  /** Clear every profile field while retaining onboarding state. */
  clear: () => Promise<boolean>
  /** Stop accepting late Host responses. */
  dispose: () => void
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function decode(view: SettingsNamespaceView): Pick<ProfileSettingsState, 'revision' | 'value' | 'onboarding'> | undefined {
  const source = record(view.value)
  if (source === undefined) return undefined
  const value: ProfileValue = {}
  for (const key of PROFILE_FIELD_KEYS) {
    if (!(key in source)) continue
    const candidate = record(source[key])
    if (candidate === undefined) return undefined
    if (typeof candidate.value !== 'string'
      || (candidate.agentVisible !== undefined && typeof candidate.agentVisible !== 'boolean')) return undefined
    value[key] = { value: candidate.value, agentVisible: candidate.agentVisible === true }
  }
  const marker = record(source.onboarding)
  if ('onboarding' in source && marker === undefined) return undefined
  if (marker !== undefined
    && (marker.version !== 1 || (marker.state !== 'completed' && marker.state !== 'skipped'))) return undefined
  const onboarding: ProfileSettingsState['onboarding'] = marker?.version === 1
    && (marker.state === 'completed' || marker.state === 'skipped')
    ? { version: 1, state: marker.state }
    : undefined
  return { revision: view.revision, value, onboarding }
}

/** Own loading and atomic profile mutations without retaining secret-like drafts in snapshots. */
export class ProfileSettingsController implements ProfileSettingsControllerFace {
  readonly store: SnapshotStore<ProfileSettingsState> = createSnapshotStore({
    status: 'idle', writable: false, revision: undefined, value: {}, onboarding: undefined,
    action: 'idle', error: null, saved: false,
  })

  private generation = 0
  private disposed = false

  /** Keep concurrency checks opaque to static narrowing across awaited Host calls. */
  private accepts(generation: number): boolean {
    return !this.disposed && generation === this.generation
  }

  /** @param api - loopback Host settings API. */
  constructor(private readonly api: Pick<IApiClient, 'settings'>) {}

  /** Load the profile namespace and current onboarding marker. */
  async load(): Promise<void> {
    if (this.disposed) return
    const generation = ++this.generation
    this.store.update((state) => { state.status = 'loading'; state.error = null; state.saved = false })
    try {
      const response = await this.api.settings.describe({})
      if (!response.result.ok) throw new Error('profile settings describe rejected')
      const described = response.result.value
      const view = described.namespaces.find(candidate => candidate.ns === PROFILE_SETTINGS_NAMESPACE)
      if (!this.accepts(generation)) return
      if (view === undefined) {
        this.store.update((state) => {
          state.status = 'unavailable'; state.writable = described.writable
        })
        return
      }
      const decoded = decode(view)
      if (decoded === undefined) throw new Error('profile settings view is invalid')
      this.accept(decoded, described.writable)
    } catch {
      if (!this.accepts(generation)) return
      this.store.update((state) => { state.status = 'error'; state.error = 'load' })
    }
  }

  /** Save every optional field atomically, optionally finishing onboarding. */
  async save(draft: EditableProfile, finishOnboarding = false): Promise<boolean> {
    const ops: SettingsPathOpView[] = []
    for (const key of PROFILE_FIELD_KEYS) {
      const canonical = canonicalProfileValue(key, draft[key].value)
      if (canonical === undefined) {
        this.store.update((state) => { state.error = 'save'; state.saved = false })
        return false
      }
      ops.push(canonical === ''
        ? { op: 'unset', path: [key] }
        : { op: 'set', path: [key], value: { value: canonical, agentVisible: draft[key].agentVisible } })
    }
    if (finishOnboarding) {
      ops.push({ op: 'set', path: ['onboarding'], value: { version: 1, state: 'completed' } })
    }
    return this.mutate(ops, 'saving')
  }

  /** Persist a deliberate first-run skip without inventing profile values. */
  skip(): Promise<boolean> {
    return this.mutate([
      { op: 'set', path: ['onboarding'], value: { version: 1, state: 'skipped' } },
    ], 'skipping')
  }

  /** Remove every optional field while retaining the onboarding marker. */
  clear(): Promise<boolean> {
    return this.mutate(PROFILE_FIELD_KEYS.map(key => ({ op: 'unset' as const, path: [key] })), 'clearing')
  }

  /** Stop accepting late responses after plugin teardown. */
  dispose(): void {
    this.disposed = true
    this.generation += 1
  }

  private async mutate(ops: SettingsPathOpView[], action: ProfileSettingsState['action']): Promise<boolean> {
    if (this.disposed || this.store.getSnapshot().status !== 'ready'
      || !this.store.getSnapshot().writable || action === 'idle') return false
    const generation = ++this.generation
    const revision = this.store.getSnapshot().revision
    this.store.update((state) => { state.action = action; state.error = null; state.saved = false })
    try {
      const response = await this.api.settings.mutate({
        ns: PROFILE_SETTINGS_NAMESPACE,
        ops,
        ...(revision === undefined ? {} : { expectedRevision: revision }),
      })
      if (!response.result.ok) throw new Error('profile settings mutation rejected')
      const decoded = decode(response.result.value)
      if (decoded === undefined) throw new Error('profile settings mutation view is invalid')
      if (this.accepts(generation)) {
        this.accept(decoded, true)
        this.store.update((state) => { state.saved = action !== 'skipping' })
      }
      return true
    } catch {
      if (this.accepts(generation)) {
        this.store.update((state) => { state.action = 'idle'; state.error = 'save'; state.saved = false })
      }
      return false
    }
  }

  private accept(decoded: Pick<ProfileSettingsState, 'revision' | 'value' | 'onboarding'>, writable: boolean): void {
    this.store.update((state) => {
      state.status = 'ready'
      state.writable = writable
      state.revision = decoded.revision
      state.value = decoded.value
      state.onboarding = decoded.onboarding
      state.action = 'idle'
      state.error = null
    })
  }
}

/**
 * Refresh only after a profile surface has requested its initial load.
 * @param controller - Profile controller associated with the active client composition.
 */
export function refreshProfileIfLoaded(controller: ProfileSettingsController): void {
  if (controller.store.getSnapshot().status === 'idle') return
  void controller.load()
}
