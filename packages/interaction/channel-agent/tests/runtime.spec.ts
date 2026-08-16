import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle, AgentOptions } from '@deepseek-ai/dsh-agent'
import ChannelService, {
  ChannelConversationId,
  ChannelError,
  ChannelExternalMessageId,
  ChannelProviderId,
  ChannelSenderId,
  type ChannelInboundMessage,
} from '@deepseek-ai/dsh-channel'
import * as ChannelAgentPlugin from '@deepseek-ai/dsh-channel-agent'
import { createAssistantMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent, type SessionHeader } from '@deepseek-ai/dsh-session'

interface StoredSession {
  header: SessionHeader
  events: SessionEvent[]
}

interface SharedState {
  conversations: Map<string, unknown>
  admissions: Map<string, unknown>
  sessions: Map<string, StoredSession>
  deliveries: string[]
  createCount: number
  resumeCount: number
  deliveryAttempts: number
}

function sharedState(): SharedState {
  return {
    conversations: new Map(),
    admissions: new Map(),
    sessions: new Map(),
    deliveries: [],
    createCount: 0,
    resumeCount: 0,
    deliveryAttempts: 0,
  }
}

class MemoryTable {
  constructor(private readonly rows: Map<string, unknown>) {}
  get(key: string): unknown { return this.rows.get(key) }
  entries(): IterableIterator<[string, unknown]> { return new Map(this.rows).entries() }
  keys(): IterableIterator<string> { return new Map(this.rows).keys() }
  get size(): number { return this.rows.size }
  async put(key: string, value: unknown): Promise<void> { this.rows.set(key, structuredClone(value)) }
  async delete(key: string): Promise<boolean> { return this.rows.delete(key) }
  async update(key: string, transform: (value: unknown) => unknown): Promise<unknown> {
    const current = this.rows.get(key)
    if (current === undefined) throw new Error('missing-key')
    const next = transform(current)
    this.rows.set(key, structuredClone(next))
    return next
  }
}

class FakeSession {
  readonly events: SessionEvent[]
  constructor(
    private readonly ctx: Context,
    readonly header: SessionHeader,
    events: readonly SessionEvent[] = [],
  ) {
    this.events = structuredClone([...events])
  }
  get id(): SessionId { return this.header.id }
  append(type: SessionEvent['type'], data: unknown): SessionEvent {
    const event = { type, data, seq: this.events.length, time: Date.now() } as SessionEvent
    this.events.push(event)
    this.ctx.emit('session/event', this as never, event)
    return event
  }
}

class FakeAgent implements Agent {
  readonly options: AgentOptions = { provider: 'test', model: 'test' }
  readonly inbox = { hasPending: false } as Agent['inbox']
  readonly ctx: Context
  readonly session: Agent['session']
  status: Agent['status'] = 'idle'
  private pending: UserMessage | undefined
  private idle = Promise.resolve()
  private resolveIdle: (() => void) | undefined
  followupCount = 0

  constructor(private readonly fakeSession: FakeSession) {
    this.ctx = new Context()
    this.session = fakeSession as never
    const consumed = new Set(
      fakeSession.events.filter(event => event.type === 'user/message').map(event =>
        event.type === 'user/message' ? event.data.id : ''),
    )
    this.pending = fakeSession.events
      .filter(event => event.type === 'agent/inbox/spliced')
      .flatMap(event => event.type === 'agent/inbox/spliced' ? event.data.inserted : [])
      .findLast(message => !consumed.has(message.id))
    if (this.pending !== undefined) this.reserve()
  }

  get id(): SessionId { return this.fakeSession.id }

  private reserve(): void {
    this.status = 'running'
    this.idle = new Promise((resolve) => { this.resolveIdle = resolve })
  }

  send(message: UserMessage, _target: 'next-turn' | 'next-step', wakeup: boolean): void {
    this.pending = message
    this.fakeSession.append('agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [message] })
    if (wakeup) this.reserve()
  }
  followup(message: UserMessage): void {
    this.followupCount += 1
    this.send(message, 'next-turn', true)
  }
  steer(message: UserMessage): void { this.send(message, 'next-step', true) }
  inject(message: UserMessage): void { this.send(message, 'next-step', false) }
  runMaintenance<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T> {
    return task(new AbortController().signal)
  }
  whenIdle(): Promise<void> { return this.idle }
  cancel(): void { this.finish({ kind: 'aborted', reason: { kind: 'user' } }) }

  finish(reason: { kind: 'completed' } | { kind: 'aborted'; reason: { kind: 'user' } }, text = 'result'): void {
    const message = this.pending
    if (message === undefined || this.status !== 'running') return
    const turn = this.fakeSession.events.filter(event => event.type === 'turn/start').length + 1
    this.fakeSession.append('turn/start', { turn })
    this.fakeSession.append('step/start', { turn, step: 1 })
    this.fakeSession.append('user/message', message)
    if (reason.kind === 'completed') {
      this.fakeSession.append('assistant/message', {
        turn,
        step: 1,
        message: createAssistantMessage({
          content: [{ type: 'text', text }],
          source: { provider: 'test', model: 'test' },
        }),
      })
    }
    this.fakeSession.append('step/end', { turn, step: 1 })
    this.fakeSession.append('turn/end', { turn, reason })
    this.pending = undefined
    this.status = 'idle'
    this.resolveIdle?.()
    this.resolveIdle = undefined
  }
}

interface Mounted {
  ctx: Context
  plugin: Awaited<ReturnType<Context['plugin']>>
  agents: Map<SessionId, FakeAgent>
  permissions: Array<{ sessionId: SessionId; preset: string }>
  registerProvider: () => void
}

interface FakeAgentHandle extends AgentHandle {
  agent: FakeAgent
}

interface MountOptions {
  readonly providerInitiallyRegistered?: boolean
  readonly deliver?: (attempt: number, text: string, signal: AbortSignal) => Promise<void>
  readonly deliveryRetryInitialMs?: number
  readonly deliveryRetryMaxMs?: number
}

async function mount(
  shared: SharedState,
  crashOnDispose = false,
  finishOnResume = false,
  options: MountOptions = {},
): Promise<Mounted> {
  const ctx = new Context()
  await ctx.plugin(ChannelService)
  const provider = ChannelProviderId('telegram')
  let registered = false
  const registerProvider = (): void => {
    if (registered) return
    registered = true
    ctx.channel.registerProvider({
      id: provider,
      deliver: async (message, signal) => {
        shared.deliveryAttempts += 1
        await options.deliver?.(shared.deliveryAttempts, message.text, signal)
        shared.deliveries.push(message.text)
        return { externalMessageId: ChannelExternalMessageId(`out-${shared.deliveries.length}`) }
      },
    })
  }
  if (options.providerInitiallyRegistered !== false) registerProvider()

  const liveSessions = new Map<SessionId, FakeSession>()
  const agents = new Map<SessionId, FakeAgent>()
  const permissions: Array<{ sessionId: SessionId; preset: string }> = []
  const persist = (session: FakeSession): void => {
    shared.sessions.set(session.id, {
      header: structuredClone(session.header),
      events: structuredClone(session.events),
    })
  }
  const sessions = {
    get: (id: SessionId) => liveSessions.get(id),
    list: () => [...liveSessions.values()],
    flush: async (session: FakeSession) => { persist(session); return true },
  }
  const makeHandle = (session: FakeSession): FakeAgentHandle => {
    const agent = new FakeAgent(session)
    agents.set(session.id, agent)
    liveSessions.set(session.id, session)
    return {
      agent,
      dispose: async () => {
        persist(session)
        if (!crashOnDispose && agent.status === 'running') agent.cancel()
        agents.delete(session.id)
        liveSessions.delete(session.id)
      },
    }
  }
  const registry = {
    get: (id: SessionId) => agents.get(id),
    create: async (options: {
      sessionId: SessionId
      meta?: { cwd?: string; agentPreset?: string }
      setup?: (ctx: Context) => Promise<void>
    }) => {
      shared.createCount += 1
      const session = new FakeSession(ctx, {
        version: 0,
        id: options.sessionId,
        createdAt: Date.now(),
        ...(options.meta?.cwd === undefined ? {} : { cwd: options.meta.cwd }),
        ...(options.meta?.agentPreset === undefined ? {} : { agentPreset: options.meta.agentPreset }),
      })
      const handle = makeHandle(session)
      await options.setup?.(ctx.extend({ agent: handle.agent }))
      return handle
    },
    resume: async (options: { resumeSessionId: SessionId; setup?: (ctx: Context) => Promise<void> }) => {
      shared.resumeCount += 1
      const stored = shared.sessions.get(options.resumeSessionId)
      if (stored === undefined) throw new Error('missing session')
      const handle = makeHandle(new FakeSession(ctx, stored.header, stored.events))
      await options.setup?.(ctx.extend({ agent: handle.agent }))
      if (finishOnResume) queueMicrotask(() => { handle.agent.finish({ kind: 'completed' }, 'recovered result') })
      return handle
    },
  }
  const workspace = {
    id: 'workspace' as never,
    path: '/workspace',
    title: 'workspace',
    createdAt: '',
    updatedAt: '',
    sessionIds: [] as SessionId[],
    attachSession: async () => {},
  }
  const persistence = {
    list: async () => [...shared.sessions.values()].map(value => value.header),
    inspect: async (id: SessionId) => {
      const stored = shared.sessions.get(id)
      if (stored === undefined) throw new Error('missing session')
      return { meta: stored.header, events: stored.events }
    },
  }
  const tables = {
    conversations: new MemoryTable(shared.conversations),
    admissions: new MemoryTable(shared.admissions),
  }
  ctx.provide('agents', registry as never)
  ctx.provide('sessions', sessions as never)
  ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'test', model: 'test' }) } as never)
  ctx.provide('agentPresets', {
    resolve: async (id: string) => ({ id }),
    mount: async () => ({ id: 'telegram-safe' }),
  } as never)
  ctx.provide('permissionPresets', {
    resolve: (preset: string) => ({ sandbox: preset, approval: 'ask' }),
    set: (session: FakeSession, preset: string) => { permissions.push({ sessionId: session.id, preset }) },
  } as never)
  ctx.provide('workspaceRegistry', { get: () => workspace, list: () => [workspace] } as never)
  ctx.provide('sessionPersistence', persistence as never)
  ctx.provide('storageDomain', {
    open: async () => ({
      table: (name: 'conversations' | 'admissions') => tables[name],
      close: async () => {},
    }),
  } as never)
  ctx.provide('tools', { restrict: () => () => {}, guard: () => () => {} } as never)
  const plugin = await ctx.plugin(ChannelAgentPlugin, {
    agentPreset: 'telegram-safe',
    ...(options.deliveryRetryInitialMs === undefined
      ? {}
      : { deliveryRetryInitialMs: options.deliveryRetryInitialMs }),
    ...(options.deliveryRetryMaxMs === undefined ? {} : { deliveryRetryMaxMs: options.deliveryRetryMaxMs }),
  })
  return { ctx, plugin, agents, permissions, registerProvider }
}

function inbound(id: string, text: string): ChannelInboundMessage {
  return {
    provider: ChannelProviderId('telegram'),
    conversationId: ChannelConversationId('chat'),
    senderId: ChannelSenderId('user'),
    externalMessageId: ChannelExternalMessageId(id),
    text,
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('channel Agent runtime', () => {
  it('admits one durable prompt, blocks concurrent work, and deduplicates its external id', async () => {
    const shared = sharedState()
    const mounted = await mount(shared)
    const first = inbound('1', 'research this')
    await expect(mounted.ctx.channel.admit(first)).resolves.toEqual({ kind: 'accepted' })
    const [agent] = [...mounted.agents.values()]
    expect(agent?.followupCount).toBe(1)
    expect(mounted.permissions.at(-1)?.preset).toBe('read-only')

    await expect(mounted.ctx.channel.admit(inbound('2', 'second task'))).resolves.toEqual({ kind: 'accepted' })
    expect(agent?.followupCount).toBe(1)
    expect(shared.deliveries.at(-1)).toContain('already running')

    await expect(mounted.ctx.channel.admit(inbound('3', '/new another task'))).resolves.toEqual({ kind: 'accepted' })
    expect(agent?.followupCount).toBe(1)
    expect(shared.createCount).toBe(1)
    expect(shared.deliveries.at(-1)).toContain('already running')

    agent?.finish({ kind: 'completed' }, 'first result')
    await vi.waitFor(() => { expect(shared.deliveries).toContain('first result') })
    await expect(mounted.ctx.channel.admit(first)).resolves.toEqual({ kind: 'duplicate' })
    expect(agent?.session.events.filter(event => event.type === 'user/message')).toHaveLength(1)
    const userEvent = agent?.session.events.find(event => event.type === 'user/message')
    expect(userEvent).toMatchObject({ data: { source: { provider: 'telegram', channel: 'external' } } })
    if (userEvent?.type !== 'user/message' || !('channel' in userEvent.data.source)) {
      throw new Error('expected channel user source')
    }
    expect(userEvent.data.source.conversationId).toMatch(/^sha256:[0-9a-f]{64}$/u)
    expect(userEvent.data.source.senderId).toMatch(/^sha256:[0-9a-f]{64}$/u)
    expect(userEvent.data.source.externalMessageId).toMatch(/^sha256:[0-9a-f]{64}$/u)
    expect(userEvent.data.source).not.toMatchObject({
      conversationId: 'chat', senderId: 'user', externalMessageId: '1',
    })
  })

  it('re-pins the locally configured permission before every prompt on a live session', async () => {
    const shared = sharedState()
    const mounted = await mount(shared)
    await mounted.ctx.channel.admit(inbound('permission-1', 'first'))
    const [agent] = [...mounted.agents.values()]
    agent?.finish({ kind: 'completed' }, 'done')
    await vi.waitFor(() => { expect(shared.deliveries).toContain('done') })

    mounted.permissions.length = 0
    await mounted.ctx.channel.admit(inbound('permission-2', 'second'))

    expect(mounted.permissions).toEqual([{ sessionId: agent?.id, preset: 'read-only' }])
    expect(agent?.followupCount).toBe(2)
  })

  it('recovers a flushed inbox whose sidecar was still processing and executes and reports it once', async () => {
    const shared = sharedState()
    const first = await mount(shared, true)
    const message = inbound('crash', 'survive restart')
    await expect(first.ctx.channel.admit(message)).resolves.toEqual({ kind: 'accepted' })
    const admissionEntry = [...shared.admissions.entries()][0]
    if (admissionEntry === undefined) throw new Error('expected a durable admission')
    const [admissionKey, admissionValue] = admissionEntry
    const admission = admissionValue as ChannelAgentPlugin.ChannelAgentAdmissionRow
    if (admission.kind !== 'prompt') throw new Error('expected a prompt admission')
    shared.admissions.set(admissionKey, {
      provider: admission.provider,
      conversationId: admission.conversationId,
      senderId: admission.senderId,
      externalMessageId: admission.externalMessageId,
      textDigest: admission.textDigest,
      admittedAt: admission.admittedAt,
      kind: 'processing',
    } satisfies ChannelAgentPlugin.ChannelAgentProcessingAdmission)
    await first.plugin.dispose()

    const recovered = await mount(shared, false, true)
    await vi.waitFor(() => {
      expect({
        deliveries: shared.deliveries,
        createCount: shared.createCount,
        resumeCount: shared.resumeCount,
        admissions: [...shared.admissions.values()],
      }).toMatchObject({ deliveries: ['recovered result'] })
    })
    expect(shared.createCount).toBe(1)
    expect(shared.resumeCount).toBe(1)
    expect(recovered.permissions.map(item => item.preset)).toEqual(['read-only', 'read-only'])
    const stored = [...shared.sessions.values()][0]
    expect(stored?.events.filter(event => event.type === 'user/message')).toHaveLength(1)
    await expect(recovered.ctx.channel.admit(message)).resolves.toEqual({ kind: 'duplicate' })
    expect(shared.deliveries).toEqual(['recovered result'])
  })

  it('never resumes or delivers an unsafe legacy preset and starts a fresh safe session', async () => {
    const shared = sharedState()
    const original = await mount(shared)
    await original.ctx.channel.admit(inbound('legacy-1', 'old task'))
    const [oldAgent] = [...original.agents.values()]
    oldAgent?.finish({ kind: 'completed' }, 'LEGACY_LOCAL_SECRET')
    await vi.waitFor(() => { expect(shared.deliveries).toContain('LEGACY_LOCAL_SECRET') })
    await original.plugin.dispose()

    const oldStored = [...shared.sessions.values()][0]
    if (oldStored === undefined) throw new Error('expected persisted legacy session')
    shared.sessions.set(oldStored.header.id, {
      ...oldStored,
      header: { ...oldStored.header, agentPreset: 'standard' },
    })
    for (const [key, value] of shared.admissions) {
      const row = value as ChannelAgentPlugin.ChannelAgentAdmissionRow
      if (row.kind === 'prompt') shared.admissions.set(key, { ...row, delivered: false })
    }
    shared.deliveries.length = 0

    const upgraded = await mount(shared)
    await vi.waitFor(() => {
      expect(shared.deliveries).toEqual([
        'Task could not be resumed safely. Open the desktop app for details.',
      ])
    })
    expect(shared.deliveries.join('\n')).not.toContain('LEGACY_LOCAL_SECRET')
    expect(shared.resumeCount).toBe(0)

    await upgraded.ctx.channel.admit(inbound('legacy-2', 'new safe task'))
    const safeAgent = [...upgraded.agents.values()][0]
    expect(safeAgent?.session.header.agentPreset).toBe('telegram-safe')
    expect(JSON.stringify(safeAgent?.session.events)).not.toContain('LEGACY_LOCAL_SECRET')
    expect(shared.createCount).toBe(2)
    expect(shared.resumeCount).toBe(0)

    safeAgent?.finish({ kind: 'completed' }, 'safe result')
    await vi.waitFor(() => { expect(shared.deliveries).toContain('safe result') })
    await upgraded.plugin.dispose()
  })

  it('keeps a durable reply until a provider registered after recovery becomes available', async () => {
    vi.useFakeTimers()
    const shared = sharedState()
    const first = await mount(shared, false, false, {
      deliveryRetryInitialMs: 1,
      deliveryRetryMaxMs: 2,
      deliver: async () => {
        throw new ChannelError('provider is starting', 'CHANNEL_TELEGRAM_UNAVAILABLE')
      },
    })
    const message = inbound('late-provider', '/help')
    await expect(first.ctx.channel.admit(message)).resolves.toEqual({ kind: 'accepted' })
    await vi.advanceTimersByTimeAsync(0)
    expect(shared.deliveryAttempts).toBe(1)
    await first.plugin.dispose()

    const recovered = await mount(shared, false, false, {
      providerInitiallyRegistered: false,
      deliveryRetryInitialMs: 1,
      deliveryRetryMaxMs: 2,
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(shared.deliveries).toEqual([])

    recovered.registerProvider()
    await vi.advanceTimersByTimeAsync(2)
    expect(shared.deliveries).toEqual([ChannelAgentPlugin.CHANNEL_HELP])
    await expect(recovered.ctx.channel.admit(message)).resolves.toEqual({ kind: 'duplicate' })
    expect(shared.deliveries).toHaveLength(1)
    await recovered.plugin.dispose()
  })

  it('retries a disabled provider after re-enable without losing the durable reply', async () => {
    vi.useFakeTimers()
    const shared = sharedState()
    let enabled = false
    const mounted = await mount(shared, false, false, {
      deliveryRetryInitialMs: 1,
      deliveryRetryMaxMs: 2,
      deliver: async () => {
        if (!enabled) throw new ChannelError('disabled', 'CHANNEL_TELEGRAM_UNAVAILABLE')
      },
    })
    await mounted.ctx.channel.admit(inbound('disabled-provider', '/status'))
    await vi.advanceTimersByTimeAsync(0)
    expect(shared.deliveryAttempts).toBe(1)
    expect(shared.deliveries).toEqual([])

    enabled = true
    await vi.advanceTimersByTimeAsync(1)
    expect(shared.deliveries).toEqual(['No selected session. Send text or use /new.'])
    await mounted.plugin.dispose()
  })

  it('survives more than five provider failures without running the model prompt again', async () => {
    vi.useFakeTimers()
    const shared = sharedState()
    const mounted = await mount(shared, false, false, {
      deliveryRetryInitialMs: 1,
      deliveryRetryMaxMs: 2,
      deliver: async (attempt) => {
        if (attempt <= 7) throw new ChannelError('offline', 'CHANNEL_TELEGRAM_UNAVAILABLE')
      },
    })
    await mounted.ctx.channel.admit(inbound('retry-prompt', 'research once'))
    const [agent] = [...mounted.agents.values()]
    agent?.finish({ kind: 'completed' }, 'durable result')

    await vi.advanceTimersByTimeAsync(20)
    expect(shared.deliveryAttempts).toBe(8)
    expect(shared.deliveries).toEqual(['durable result'])
    expect(agent?.followupCount).toBe(1)
    expect(agent?.session.events.filter(event => event.type === 'user/message')).toHaveLength(1)
    await mounted.plugin.dispose()
  })

  it.each([
    'CHANNEL_TELEGRAM_ROUTE_EXPIRED',
    'CHANNEL_TELEGRAM_TEXT_TOO_LONG',
  ] as const)('persists %s as abandoned and never retries it', async (code) => {
    vi.useFakeTimers()
    const shared = sharedState()
    const mounted = await mount(shared, false, false, {
      deliveryRetryInitialMs: 1,
      deliveryRetryMaxMs: 2,
      deliver: async () => { throw new ChannelError('permanent provider rejection', code) },
    })
    const message = inbound(`permanent-${code}`, '/help')
    await mounted.ctx.channel.admit(message)
    await vi.advanceTimersByTimeAsync(0)

    expect(shared.deliveryAttempts).toBe(1)
    expect([...shared.admissions.values()]).toContainEqual(expect.objectContaining({
      kind: 'reply',
      delivered: false,
      deliveryAbandoned: code,
    }))
    await vi.advanceTimersByTimeAsync(100)
    await expect(mounted.ctx.channel.admit(message)).resolves.toEqual({ kind: 'duplicate' })
    await vi.advanceTimersByTimeAsync(100)
    expect(shared.deliveryAttempts).toBe(1)
    await mounted.plugin.dispose()
  })

  it('aborts retry timers and reaches quiescence on dispose', async () => {
    vi.useFakeTimers()
    const shared = sharedState()
    const mounted = await mount(shared, false, false, {
      deliveryRetryInitialMs: 5,
      deliveryRetryMaxMs: 5,
      deliver: async () => { throw new ChannelError('offline', 'CHANNEL_TELEGRAM_UNAVAILABLE') },
    })
    await mounted.ctx.channel.admit(inbound('dispose-retry', '/help'))
    await vi.advanceTimersByTimeAsync(0)
    expect(shared.deliveryAttempts).toBe(1)

    await expect(mounted.plugin.dispose()).resolves.toBeUndefined()
    await vi.advanceTimersByTimeAsync(100)
    expect(shared.deliveryAttempts).toBe(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})
