/** Reactive join of media-generation settings and write-only credential state. */

import type { IApiClient, SettingsNamespaceView, SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import {
  createSnapshotStore, type SettingsScope, type SettingsScopeSnapshot, type SnapshotStore,
} from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ApprovalPolicy, ImageGenerationConfig, MediaGenerationConfig, VideoGenerationConfig,
} from '../types.ts'
import { MEDIA_SETTINGS_NAMESPACE } from '../types.ts'

const DEFAULT_IMAGE_CREDENTIAL = 'OPENAI_API_KEY'
const DEFAULT_VIDEO_CREDENTIAL = 'GOOGLE_API_KEY'

/** Credential status safe to expose to the settings renderer. */
export interface MediaCredentialState {
  /** Reference the status describes. */
  ref: string
  /** Whether the credential lookup is still in flight, settled, or unavailable. */
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** Whether any Host credential layer supplies a value. */
  configured: boolean
  /** Whether the active credential provider accepts a replacement. */
  writable: boolean
}

/** Provider credential addressed by one settings card. */
export type MediaCredentialKind = 'image' | 'video'

/** Save stage whose failure determines what may already have landed. */
export type MediaSaveFailureStage = 'credentials' | 'settings' | 'settings-unknown'

/** Structured save failure kept separate from localized operational copy. */
export interface MediaSaveError {
  /** Stage at which the save stopped. */
  stage: MediaSaveFailureStage
  /** Host or transport detail retained for diagnostics. */
  message: string
}

/** Failed credential removal, scoped to the card that initiated it. */
export interface MediaCredentialActionError {
  /** Provider card whose stored credential could not be removed. */
  kind: MediaCredentialKind
  /** Host or transport detail retained for diagnostics. */
  message: string
}

/** Snapshot rendered by the Media settings section. */
export interface MediaSettingsState {
  /** Namespace availability from the bound settings scope. */
  status: SettingsScopeSnapshot<MediaGenerationConfig>['status']
  /** Last schema-resolved configuration. */
  config: MediaGenerationConfig | undefined
  /** Revision fencing the next settings write. */
  revision: number | undefined
  /** Whether the settings document accepts writes. */
  writable: boolean
  /** Host-backed settings or process-local remote-browser mode. */
  mode: SettingsScopeSnapshot<MediaGenerationConfig>['mode']
  /** Image-provider credential state. */
  imageCredential: MediaCredentialState
  /** Video-provider credential state. */
  videoCredential: MediaCredentialState
  /** Credential describe failure; settings remain usable. */
  credentialError: string | null
  /** Whether a staged save is crossing the wire. */
  saving: boolean
  /** Last save failure and its commit stage. */
  saveError: MediaSaveError | null
  /** Increments after a complete settings-and-credentials save. */
  savedRevision: number
  /** Credential removal currently crossing the wire. */
  removingCredential: MediaCredentialKind | null
  /** Last failed credential removal. */
  credentialActionError: MediaCredentialActionError | null
  /** Last credential removed successfully in this mounted page. */
  removedCredential: MediaCredentialKind | null
}

/** Complete staged configuration submitted by the settings form. */
export interface MediaSettingsWrite {
  approval: ApprovalPolicy
  image: Required<ImageGenerationConfig>
  video: Required<VideoGenerationConfig>
  /** Blank preserves the currently resolved image credential. */
  imageApiKey: string
  /** Blank preserves the currently resolved video credential. */
  videoApiKey: string
}

function credential(ref: string): MediaCredentialState {
  return { ref, status: 'idle', configured: false, writable: true }
}

function imageRef(config: MediaGenerationConfig | undefined): string {
  const value = config?.image?.apiKeyEnv?.trim()
  return value === undefined || value === '' ? DEFAULT_IMAGE_CREDENTIAL : value
}

function videoRef(config: MediaGenerationConfig | undefined): string {
  const value = config?.video?.apiKeyEnv?.trim()
  return value === undefined || value === '' ? DEFAULT_VIDEO_CREDENTIAL : value
}

function copyConfig(config: MediaGenerationConfig | undefined): MediaGenerationConfig | undefined {
  if (config === undefined) return undefined
  return {
    ...config,
    ...config.image === undefined ? {} : { image: { ...config.image } },
    ...config.video === undefined ? {} : { video: { ...config.video } },
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Settings and credentials controller owned by the client plugin fiber. */
export class MediaSettingsStore {
  /** Observable source bound into the renderer's `useMediaSettings` hook. */
  readonly store: SnapshotStore<MediaSettingsState>

  private readonly stopScope: () => void
  private credentialGeneration = 0
  private disposed = false

  /**
   * @param scope - bound `media-generation` settings namespace.
   * @param api - credentials wire face.
   */
  constructor(
    private readonly scope: SettingsScope<MediaGenerationConfig>,
    private readonly api: Pick<IApiClient, 'credentials' | 'settings'>,
  ) {
    const snapshot = scope.getSnapshot()
    const config = copyConfig(snapshot.value)
    this.store = createSnapshotStore<MediaSettingsState>({
      status: snapshot.status,
      config,
      revision: snapshot.revision,
      writable: snapshot.writable,
      mode: snapshot.mode,
      imageCredential: credential(imageRef(config)),
      videoCredential: credential(videoRef(config)),
      credentialError: null,
      saving: false,
      saveError: null,
      savedRevision: 0,
      removingCredential: null,
      credentialActionError: null,
      removedCredential: null,
    })
    this.stopScope = scope.subscribe(() => { this.syncScope() })
    if (snapshot.status === 'ready') void this.loadCredentials()
  }

  /** Stop subscriptions and suppress all later asynchronous publications. */
  dispose(): void {
    this.disposed = true
    this.credentialGeneration += 1
    this.stopScope()
  }

  private isDisposed(): boolean {
    return this.disposed
  }

  /**
   * Refresh a credential changed outside this page when it is one the page addresses.
   * @param ref - Host-reported credential reference.
   */
  refreshCredential(ref: string): void {
    const state = this.store.getSnapshot()
    if (ref !== state.imageCredential.ref && ref !== state.videoCredential.ref) return
    void this.loadCredentials()
  }

  /**
   * Store non-blank credentials first, then atomically commit all three settings groups.
   * Credential writes are intentionally first: a credential failure cannot leave a newly
   * permissive approval policy active without the requested provider key. Credential values
   * are write-only, so a successful earlier write cannot be rolled back safely when a later
   * write fails; the staged failure tells the UI exactly which outcome remains possible.
   * @param write - complete staged form value.
   * @returns whether every requested write landed.
   */
  async save(write: MediaSettingsWrite): Promise<boolean> {
    const current = this.store.getSnapshot()
    if (
      this.isDisposed() || current.saving || current.removingCredential !== null
      || current.status !== 'ready' || !current.writable
    ) return false
    this.store.update((state) => {
      state.saving = true
      state.saveError = null
      state.credentialActionError = null
      state.removedCredential = null
    })

    // Image then video is deterministic. If either fails, settings.mutate is never called.
    try {
      await this.writeCredential(write.image.apiKeyEnv, write.imageApiKey)
      await this.writeCredential(write.video.apiKeyEnv, write.videoApiKey)
    } catch (error) {
      this.failSave('credentials', error)
      void this.loadCredentials()
      return false
    }
    if (this.isDisposed()) return false

    const ops: SettingsPathOpView[] = [
      { op: 'set', path: ['approval'], value: write.approval },
      { op: 'set', path: ['image'], value: write.image },
      { op: 'set', path: ['video'], value: write.video },
    ]
    let response: Awaited<ReturnType<IApiClient['settings']['mutate']>>
    try {
      response = await this.api.settings.mutate({
        ns: MEDIA_SETTINGS_NAMESPACE,
        ops,
        ...(current.revision === undefined ? {} : { expectedRevision: current.revision }),
      })
    } catch (error) {
      // The transport ended without an RPC result, so the atomic Host outcome is unknown.
      this.failSave('settings-unknown', error)
      void this.loadCredentials()
      return false
    }
    if (!response.result.ok) {
      this.failSave('settings', response.result.error.message)
      void this.loadCredentials()
      return false
    }
    if (this.isDisposed()) return false

    this.acceptSettings(response.result.value)
    await this.loadCredentials()
    if (this.isDisposed()) return false
    this.store.update((state) => {
      state.saving = false
      state.saveError = null
      state.savedRevision += 1
    })
    return true
  }

  /**
   * Remove the currently resolved credential for one configured, writable provider.
   * This remains available when the settings document itself is read-only because the
   * credential store has its own writability contract.
   * @param kind - provider card whose current credential reference should be unset.
   * @returns whether the Host accepted the idempotent removal.
   */
  async removeCredential(kind: MediaCredentialKind): Promise<boolean> {
    const current = this.store.getSnapshot()
    const target = kind === 'image' ? current.imageCredential : current.videoCredential
    if (
      this.isDisposed() || current.saving || current.removingCredential !== null
      || current.status !== 'ready' || target.status !== 'ready'
      || !target.configured || !target.writable
    ) return false
    const ref = target.ref
    this.store.update((state) => {
      state.removingCredential = kind
      state.credentialActionError = null
      state.removedCredential = null
    })
    try {
      const response = await this.api.credentials.unset({ ref })
      if (!response.result.ok) throw new Error(response.result.error.message)
    } catch (error) {
      if (!this.isDisposed()) {
        this.store.update((state) => {
          state.removingCredential = null
          const latest = kind === 'image' ? state.imageCredential : state.videoCredential
          state.credentialActionError = latest.ref === ref ? { kind, message: messageOf(error) } : null
        })
      }
      return false
    }
    if (this.isDisposed()) return false
    this.store.update((state) => {
      state.removingCredential = null
      const latest = kind === 'image' ? state.imageCredential : state.videoCredential
      if (latest.ref === ref) {
        latest.status = 'ready'
        latest.configured = false
        state.removedCredential = kind
      }
    })
    void this.loadCredentials()
    return true
  }

  private syncScope(): void {
    if (this.isDisposed()) return
    const snapshot = this.scope.getSnapshot()
    const config = copyConfig(snapshot.value)
    const nextImageRef = imageRef(config)
    const nextVideoRef = videoRef(config)
    const current = this.store.getSnapshot()
    if (
      snapshot.status === 'ready' && snapshot.revision !== undefined && current.revision !== undefined
      && snapshot.revision < current.revision
    ) return
    const refsChanged = current.imageCredential.ref !== nextImageRef
      || current.videoCredential.ref !== nextVideoRef
    this.store.update((state) => {
      state.status = snapshot.status
      state.config = config
      state.revision = snapshot.revision
      state.writable = snapshot.writable
      state.mode = snapshot.mode
      if (state.imageCredential.ref !== nextImageRef) state.imageCredential = credential(nextImageRef)
      if (state.videoCredential.ref !== nextVideoRef) state.videoCredential = credential(nextVideoRef)
      if (refsChanged) {
        state.credentialActionError = null
        state.removedCredential = null
      }
    })
    if (snapshot.status === 'ready' && refsChanged) void this.loadCredentials()
  }

  private async writeCredential(ref: string, value: string): Promise<void> {
    const trimmed = value.trim()
    if (trimmed === '') return
    const response = await this.api.credentials.set({ ref, value: trimmed })
    if (!response.result.ok) throw new Error(response.result.error.message)
  }

  private failSave(stage: MediaSaveFailureStage, error: unknown): void {
    if (this.isDisposed()) return
    this.store.update((state) => {
      state.saving = false
      state.saveError = { stage, message: messageOf(error) }
    })
  }

  private acceptSettings(view: SettingsNamespaceView): void {
    const config = copyConfig(view.value as MediaGenerationConfig)
    const nextImageRef = imageRef(config)
    const nextVideoRef = videoRef(config)
    this.store.update((state) => {
      state.config = config
      state.revision = view.revision
      if (state.imageCredential.ref !== nextImageRef) state.imageCredential = credential(nextImageRef)
      if (state.videoCredential.ref !== nextVideoRef) state.videoCredential = credential(nextVideoRef)
    })
  }

  private async loadCredentials(): Promise<void> {
    const state = this.store.getSnapshot()
    if (this.isDisposed() || state.status !== 'ready') return
    const generation = ++this.credentialGeneration
    const refs = [...new Set([state.imageCredential.ref, state.videoCredential.ref])]
    this.store.update((draft) => {
      draft.imageCredential.status = 'loading'
      draft.videoCredential.status = 'loading'
      draft.credentialError = null
    })
    try {
      const response = await this.api.credentials.describe({ refs })
      if (!response.result.ok) throw new Error(response.result.error.message)
      if (this.isDisposed() || generation !== this.credentialGeneration) return
      const credentials = response.result.value.credentials
      this.store.update((draft) => {
        for (const entry of [draft.imageCredential, draft.videoCredential]) {
          const view = credentials[entry.ref]
          entry.status = 'ready'
          entry.configured = view?.configured ?? false
          entry.writable = view?.writable ?? true
        }
        draft.credentialError = null
      })
    } catch (error) {
      if (this.isDisposed() || generation !== this.credentialGeneration) return
      this.store.update((draft) => {
        draft.imageCredential.status = 'error'
        draft.videoCredential.status = 'error'
        draft.credentialError = messageOf(error)
      })
    }
  }
}
