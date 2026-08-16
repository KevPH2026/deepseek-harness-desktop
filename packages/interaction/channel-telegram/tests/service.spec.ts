import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  ChannelConversationId,
  ChannelProviderId,
} from '@deepseek-ai/dsh-channel'
import type { ChannelOutboundMessage, ChannelProvider } from '@deepseek-ai/dsh-channel'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import TelegramChannelService, { TELEGRAM_BOT_TOKEN } from '../src/index.ts'
import { TELEGRAM_TEXT_LIMIT } from '../src/http.ts'
import type { TelegramApiMessage, TelegramApiUpdate } from '../src/http.ts'
import type { TelegramDurableState } from '../src/spec.ts'

const contexts: Context[] = []
const TOKEN_A = ['123456', 'test_only_token_never_use'].join(':')
const TOKEN_B = ['999999', 'different_test_only_token'].join(':')
const ROUTE_A = 'AAAAAAAAAAAAAAAAAAAAAA'
const BOT_A = { id: '70', firstName: 'Harness A', username: 'HarnessABot' }

afterEach(async () => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

function telegramResponse(result: unknown, status = 200): Response {
  return new Response(JSON.stringify({ ok: true, result }), { status })
}

function telegramError(status: number): Response {
  return new Response(JSON.stringify({ ok: false, error_code: status }), { status })
}

function sentMessageResponse(body: TelegramRequestBody, messageId = 900): Response {
  if (body.chat_id === undefined || body.text === undefined) throw new TypeError('invalid sendMessage body')
  const message: TelegramApiMessage = {
    message_id: messageId,
    chat: { id: Number(body.chat_id), type: 'private' },
    text: body.text,
  }
  return telegramResponse(message)
}

function activeState(route = ROUTE_A): TelegramDurableState {
  return {
    enabled: true,
    bot: BOT_A,
    binding: {
      userId: '3',
      chatId: '3',
      firstName: 'Mobile User',
      confirmedAt: 1,
      routingEpoch: route,
    },
  }
}

function requestUrl(input: string | URL | Request): string {
  if (typeof input === 'string') return input
  return input instanceof URL ? input.href : input.url
}

interface TelegramRequestBody {
  readonly chat_id?: string
  readonly text?: string
  readonly timeout?: number
  readonly offset?: number
}

function requestBody(init: RequestInit | undefined): TelegramRequestBody {
  if (typeof init?.body !== 'string') throw new TypeError('expected a JSON string request body')
  return JSON.parse(init.body) as TelegramRequestBody
}

interface PendingPoll {
  readonly respond: (updates: readonly TelegramApiUpdate[]) => void
}

interface Harness {
  readonly ctx: Context
  readonly service: TelegramChannelService
  readonly pendingPolls: PendingPoll[]
  readonly calls: string[]
  readonly sentTexts: string[]
  readonly sentChatIds: string[]
  readonly admits: ReturnType<typeof vi.fn>
  readonly deliver: (conversationId: string, text: string, signal?: AbortSignal) => Promise<unknown>
  readonly readState: () => TelegramDurableState
  readonly replaceState: (state: TelegramDurableState) => void
  readonly setBot: (bot: { readonly id: number; readonly first_name: string; readonly username: string }) => void
  readonly setToken: (token: string) => void
  readonly setPendingUpdateCount: (count: number) => void
  readonly emitCredentialUpdated: () => void
}

async function harness(options: {
  readonly webhookUrl?: string
  readonly failTaskAcknowledgement?: boolean
  readonly initialState?: TelegramDurableState
  readonly pendingUpdateCount?: number
  readonly sendMessage?: (
    body: TelegramRequestBody,
    signal: AbortSignal | null | undefined,
    ordinal: number,
  ) => Promise<Response>
  readonly getUpdates?: (
    body: TelegramRequestBody,
    signal: AbortSignal | null | undefined,
    ordinal: number,
  ) => Promise<Response> | undefined
  readonly connectionRequest?: (
    method: 'getMe' | 'getWebhookInfo',
    signal: AbortSignal | null | undefined,
  ) => Promise<Response> | undefined
} = {}): Promise<Harness> {
  let state: TelegramDurableState = options.initialState ?? { enabled: false }
  let token = TOKEN_A
  let bot = { id: 70, first_name: 'Harness A', username: 'HarnessABot' }
  let pendingUpdateCount = options.pendingUpdateCount ?? 0
  let provider: ChannelProvider | undefined
  let getUpdatesOrdinal = 0
  let sendOrdinal = 0
  const calls: string[] = []
  const pendingPolls: PendingPoll[] = []
  const sentTexts: string[] = []
  const sentChatIds: string[] = []
  const admits = vi.fn(async () => ({ kind: 'accepted' as const }))
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const method = requestUrl(input).split('/').at(-1) ?? ''
    calls.push(method)
    if (method === 'getMe' || method === 'getWebhookInfo') {
      const handled = options.connectionRequest?.(method, init?.signal)
      if (handled !== undefined) return await handled
      if (method === 'getMe') return telegramResponse({ ...bot, is_bot: true })
      return telegramResponse({ url: options.webhookUrl ?? '', pending_update_count: pendingUpdateCount })
    }
    if (method === 'sendMessage') {
      const body = requestBody(init)
      if (body.text === undefined || body.chat_id === undefined) throw new TypeError('invalid sendMessage body')
      sentTexts.push(body.text)
      sentChatIds.push(body.chat_id)
      sendOrdinal += 1
      if (options.sendMessage !== undefined) return await options.sendMessage(body, init?.signal, sendOrdinal)
      if (options.failTaskAcknowledgement === true
        && body.text === 'Task received. The result will be sent here when it is ready.') {
        return telegramError(409)
      }
      return sentMessageResponse(body)
    }
    if (method !== 'getUpdates') throw new Error(`unexpected Telegram method ${method}`)
    const body = requestBody(init)
    getUpdatesOrdinal += 1
    const handled = options.getUpdates?.(body, init?.signal, getUpdatesOrdinal)
    if (handled !== undefined) return await handled
    return await new Promise<Response>((resolve, reject) => {
      const signal = init?.signal
      const removePending = (): void => {
        const index = pendingPolls.indexOf(pending)
        if (index >= 0) pendingPolls.splice(index, 1)
      }
      const onAbort = (): void => {
        removePending()
        reject(signal?.reason instanceof Error ? signal.reason : new Error('aborted'))
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      const pending: PendingPoll = {
        respond: (updates) => {
          removePending()
          signal?.removeEventListener('abort', onAbort)
          resolve(telegramResponse(updates))
        },
      }
      pendingPolls.push(pending)
    })
  }) as unknown as typeof fetch

  const ctx = new Context()
  contexts.push(ctx)
  ctx.provide('credentials', {
    resolve: async () => ({ value: token, source: 'test' }),
    describe: async () => ({ configured: true, source: 'test', writable: true }),
  } as never)
  ctx.provide('storageDomain', {
    open: async () => ({
      global: {
        get: () => state,
        set: async (next: TelegramDurableState) => { state = next },
      },
      close: async () => {},
    }),
  } as never)
  ctx.provide('channel', {
    registerProvider: (next: ChannelProvider) => {
      provider = next
      return () => { if (provider === next) provider = undefined }
    },
    admit: admits,
  } as never)
  vi.stubGlobal('fetch', fetcher)
  await ctx.plugin(TelegramChannelService)
  const service = ctx.get('channelTelegram') as TelegramChannelService
  return {
    ctx,
    service,
    pendingPolls,
    calls,
    sentTexts,
    sentChatIds,
    admits,
    deliver: async (conversationId, text, signal = new AbortController().signal) => {
      if (provider === undefined) throw new Error('provider missing')
      const message: ChannelOutboundMessage = {
        provider: ChannelProviderId('telegram'),
        conversationId: ChannelConversationId(conversationId),
        text,
      }
      return await provider.deliver(message, signal)
    },
    readState: () => state,
    replaceState: (next) => { state = next },
    setBot: (next) => { bot = next },
    setToken: (next) => { token = next },
    setPendingUpdateCount: (next) => { pendingUpdateCount = next },
    emitCredentialUpdated: () => { ctx.emit('credentials/updated', TELEGRAM_BOT_TOKEN) },
  }
}

async function waitUntil(assertion: () => void): Promise<void> {
  await vi.waitFor(assertion, { timeout: 2_000, interval: 5 })
}

function privateTextUpdate(
  updateId: number,
  messageId: number,
  text: string,
  date = Math.floor(Date.now() / 1_000) + 1,
): TelegramApiUpdate {
  return {
    update_id: updateId,
    message: {
      message_id: messageId,
      date,
      from: { id: 3, is_bot: false, first_name: 'Mobile User', username: 'mobile_user' },
      chat: { id: 3, type: 'private' },
      text,
    },
  }
}

async function pairHarness(instance: Harness, updateId = 10): Promise<string> {
  const begun = await instance.service.beginPairing()
  if (!begun.ok) throw new Error(`begin pairing failed: ${begun.error.code}`)
  await waitUntil(() => { expect(instance.pendingPolls).toHaveLength(1) })
  const poll = instance.pendingPolls.shift()
  if (poll === undefined) throw new Error('pairing poll missing')
  poll.respond([privateTextUpdate(updateId, 101, `/start ${begun.value.token}`)])
  await waitUntil(() => { expect(instance.readState().pairing?.kind).toBe('candidate') })
  const pairing = instance.readState().pairing
  if (pairing?.kind !== 'candidate') throw new Error('candidate missing')
  const confirmed = await instance.service.confirmPairing({ candidateId: pairing.candidate.candidateId })
  if (!confirmed.ok) throw new Error(`confirm pairing failed: ${confirmed.error.code}`)
  await waitUntil(() => { expect(instance.pendingPolls).toHaveLength(1) })
  const route = instance.readState().binding?.routingEpoch
  if (route === undefined) throw new Error('routing epoch missing')
  return route
}

describe('TelegramChannelService', () => {

  describe('setProxy', () => {
    it('persists a normalized proxy override and projects it in status', async () => {
      const instance = await harness({ initialState: { enabled: false } })
      const result = await instance.service.setProxy({ proxyUrl: 'http://127.0.0.1:7890' })
      expect(result.ok).toBe(true)
      expect(instance.readState().proxyUrl).toBe('http://127.0.0.1:7890/')
      if (result.ok) expect(result.value.proxyUrl).toBe('http://127.0.0.1:7890/')
    })

    it('rejects non-http, credentialed, and malformed proxy URLs without writing state', async () => {
      const instance = await harness({ initialState: { enabled: false } })
      for (const value of ['socks5://127.0.0.1:1080', 'http://user:pass@127.0.0.1:7890', 'not a url', 'http://']) {
        const result = await instance.service.setProxy({ proxyUrl: value })
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.error.code).toBe('invalid-proxy')
        expect(instance.readState().proxyUrl).toBeUndefined()
      }
    })

    it('clears the override with an empty request and restarts a live poller after a change', async () => {
      const instance = await harness({ initialState: { enabled: false } })
      await instance.service.setProxy({ proxyUrl: 'http://127.0.0.1:7890' })
      const cleared = await instance.service.setProxy({ proxyUrl: '' })
      expect(cleared.ok).toBe(true)
      expect(instance.readState().proxyUrl).toBeUndefined()
    })

    it('retains the proxy override through revoke', async () => {
      const instance = await harness({ initialState: { enabled: false } })
      await instance.service.setProxy({ proxyUrl: 'http://127.0.0.1:7890' })
      await instance.service.revoke()
      expect(instance.readState().proxyUrl).toBe('http://127.0.0.1:7890/')
    })
  })

  it('publishes the local control Remote only', async () => {
    const { service } = await harness({ webhookUrl: 'https://example.test/active' })
    expect(service.typertRemote).toMatchObject({ serviceKey: 'channelTelegram', namespace: 'channelTelegram' })
    expect(remoteMethods(service).map(method => method.method).sort()).toEqual([
      'beginPairing', 'confirmPairing', 'disable', 'enable', 'revoke', 'setProxy', 'status',
    ])
  })

  it('fails closed on an active webhook and never calls deleteWebhook', async () => {
    const { service, calls, readState } = await harness({ webhookUrl: 'https://example.test/active' })
    const result = await service.beginPairing()

    expect(result).toMatchObject({ ok: false, error: { code: 'webhook-active' } })
    expect(readState()).toMatchObject({
      enabled: false,
      disabledBacklog: { cutoffOffset: 0 },
    })
    expect(calls).toEqual(['getMe', 'getWebhookInfo'])
    expect(calls).not.toContain('deleteWebhook')
  })

  it.each(['getMe', 'getWebhookInfo'] as const)(
    'dispose aborts and joins a hanging explicit %s connection check',
    async (blockedMethod) => {
      let observedSignal: AbortSignal | undefined
      let markStarted: (() => void) | undefined
      const started = new Promise<void>((resolve) => { markStarted = resolve })
      const instance = await harness({
        connectionRequest: (method, signal) => {
          if (method !== blockedMethod) return undefined
          if (signal === undefined || signal === null) {
            return Promise.reject(new Error('control signal missing'))
          }
          observedSignal = signal
          markStarted?.()
          return new Promise<Response>((_resolve, reject) => {
            const onAbort = (): void => {
              reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'))
            }
            if (signal.aborted) onAbort()
            else signal.addEventListener('abort', onAbort, { once: true })
          })
        },
      })
      const pairing = instance.service.beginPairing()
      await started

      const disposal = instance.ctx.fiber.dispose()
      await waitUntil(() => { expect(observedSignal?.aborted).toBe(true) })
      await expect(pairing).resolves.toMatchObject({ ok: false, error: { code: 'service-stopping' } })
      await disposal
    },
  )

  it('requires desktop confirmation and moves offset only after admission settles', async () => {
    const { service, pendingPolls, sentTexts, admits, readState } = await harness()
    const begun = await service.beginPairing()
    if (!begun.ok) throw new Error(`begin pairing failed: ${begun.error.code}`)

    await waitUntil(() => { expect(pendingPolls).toHaveLength(1) })
    const pairingPoll = pendingPolls.shift()
    if (pairingPoll === undefined) throw new Error('pairing poll missing')
    pairingPoll.respond([privateTextUpdate(10, 101, `/start ${begun.value.token}`)])
    await waitUntil(() => { expect(readState().pairing?.kind).toBe('candidate') })
    expect(readState().nextUpdateOffset).toBe(11)
    const pairing = readState().pairing
    const candidate = pairing?.kind === 'candidate' ? pairing.candidate : undefined
    if (candidate === undefined) throw new Error('candidate missing')
    expect(admits).not.toHaveBeenCalled()

    const confirmed = await service.confirmPairing({ candidateId: candidate.candidateId })
    expect(confirmed).toMatchObject({ ok: true, value: { pairing: { kind: 'paired' } } })
    await waitUntil(() => { expect(pendingPolls).toHaveLength(1) })

    let settleAdmission: ((value: { readonly kind: 'accepted' }) => void) | undefined
    const admission = new Promise<{ readonly kind: 'accepted' }>((resolve) => { settleAdmission = resolve })
    admits.mockReturnValueOnce(admission)
    const messagePoll = pendingPolls.shift()
    if (messagePoll === undefined) throw new Error('message poll missing')
    messagePoll.respond([privateTextUpdate(11, 102, 'run the desktop task')])
    await waitUntil(() => { expect(admits).toHaveBeenCalledOnce() })
    expect(readState().nextUpdateOffset).toBe(11)
    expect(sentTexts).not.toContain('Task received. The result will be sent here when it is ready.')

    if (settleAdmission === undefined) throw new Error('admission settlement missing')
    settleAdmission({ kind: 'accepted' })
    await waitUntil(() => { expect(readState().nextUpdateOffset).toBe(12) })
    await waitUntil(() => {
      expect(sentTexts).toContain('Task received. The result will be sent here when it is ready.')
    })
    const route = readState().binding?.routingEpoch
    expect(route).toMatch(/^[A-Za-z0-9_-]{22}$/u)
    expect(admits).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'telegram',
      conversationId: route,
      senderId: '3',
      externalMessageId: '102',
      text: 'run the desktop task',
    }), expect.any(AbortSignal))
  })

  it('keeps binding on disable but revoke lets a new bot begin with a fresh offset', async () => {
    const { service, pendingPolls, readState, replaceState, setBot, setToken } = await harness()
    const first = await service.beginPairing()
    expect(first.ok).toBe(true)
    replaceState({
      ...readState(),
      nextUpdateOffset: 88,
      pairing: undefined,
      binding: {
        userId: '3', chatId: '3', firstName: 'Mobile User', confirmedAt: 1,
        routingEpoch: 'AAAAAAAAAAAAAAAAAAAAAA',
      },
    })

    const disabled = await service.disable()
    expect(disabled).toMatchObject({ enabled: false, pairing: { kind: 'paired' } })
    expect(readState()).toMatchObject({ enabled: false, nextUpdateOffset: 88, bot: { id: '70' } })

    await service.revoke()
    expect(readState()).toMatchObject({ enabled: false, disabledBacklog: { cutoffOffset: 0 } })
    setToken(TOKEN_B)
    setBot({ id: 71, first_name: 'Harness B', username: 'HarnessBBot' })
    const second = await service.beginPairing()
    if (!second.ok) throw new Error(`second begin failed: ${second.error.code}`)
    expect(second.value.deepLink).toContain('HarnessBBot')
    expect(readState()).toMatchObject({ enabled: true, bot: { id: '71' } })
    expect(readState().nextUpdateOffset).toBeUndefined()

    // Both begin calls can leave an abortable getUpdates request; cleanup joins it.
    expect(pendingPolls.length).toBeLessThanOrEqual(1)
  })

  it('does not roll back or re-admit when the post-commit acknowledgement fails', async () => {
    const { service, pendingPolls, sentTexts, admits, readState } = await harness({
      failTaskAcknowledgement: true,
    })
    const begun = await service.beginPairing()
    if (!begun.ok) throw new Error(`begin pairing failed: ${begun.error.code}`)
    await waitUntil(() => { expect(pendingPolls).toHaveLength(1) })
    const pairingPoll = pendingPolls.shift()
    if (pairingPoll === undefined) throw new Error('pairing poll missing')
    pairingPoll.respond([privateTextUpdate(20, 201, `/start ${begun.value.token}`)])
    await waitUntil(() => { expect(readState().pairing?.kind).toBe('candidate') })
    const pairing = readState().pairing
    if (pairing?.kind !== 'candidate') throw new Error('candidate missing')
    await service.confirmPairing({ candidateId: pairing.candidate.candidateId })

    await waitUntil(() => { expect(pendingPolls).toHaveLength(1) })
    const taskPoll = pendingPolls.shift()
    if (taskPoll === undefined) throw new Error('task poll missing')
    taskPoll.respond([privateTextUpdate(21, 202, 'one durable task')])
    await waitUntil(() => { expect(readState().nextUpdateOffset).toBe(22) })
    await waitUntil(() => {
      expect(sentTexts).toContain('Task received. The result will be sent here when it is ready.')
    })

    // Even if Telegram repeats a stale update, the committed offset suppresses admission.
    await waitUntil(() => { expect(pendingPolls).toHaveLength(1) })
    const stalePoll = pendingPolls.shift()
    if (stalePoll === undefined) throw new Error('stale-update poll missing')
    stalePoll.respond([privateTextUpdate(21, 202, 'one durable task')])
    await waitUntil(() => { expect(pendingPolls).toHaveLength(1) })
    expect(admits).toHaveBeenCalledOnce()
    expect(readState().nextUpdateOffset).toBe(22)
  })

  it('migrates a legacy binding to an opaque route without exposing it in status', async () => {
    const instance = await harness({
      initialState: {
        enabled: true,
        bot: BOT_A,
        binding: { userId: '3', chatId: '3', firstName: 'Mobile User', confirmedAt: 1 },
      },
    })
    await waitUntil(() => { expect(instance.pendingPolls).toHaveLength(1) })
    const route = instance.readState().binding?.routingEpoch
    expect(route).toMatch(/^[A-Za-z0-9_-]{22}$/u)

    const status = await instance.service.status()
    expect(status).toMatchObject({
      pairing: { kind: 'paired', account: { userId: '3', chatId: '3' } },
    })
    expect(JSON.stringify(status)).not.toContain('routingEpoch')
    await expect(instance.deliver('3', 'legacy outbox')).rejects.toMatchObject({
      code: 'CHANNEL_TELEGRAM_ROUTE_EXPIRED',
    })
    expect(instance.sentTexts).toEqual([])
  })

  it('isolates identical Telegram ids across bot revocation and rebinding', async () => {
    const instance = await harness()
    const firstRoute = await pairHarness(instance, 30)
    await instance.service.revoke()
    instance.setToken(TOKEN_B)
    instance.setBot({ id: 71, first_name: 'Harness B', username: 'HarnessBBot' })
    const secondRoute = await pairHarness(instance, 30)

    expect(firstRoute).not.toBe(secondRoute)
    const sentBefore = instance.sentTexts.length
    await expect(instance.deliver(firstRoute, 'stale result')).rejects.toMatchObject({
      code: 'CHANNEL_TELEGRAM_ROUTE_EXPIRED',
    })
    expect(instance.sentTexts).toHaveLength(sentBefore)
    const status = await instance.service.status()
    expect(JSON.stringify(status)).not.toContain(secondRoute)
  })

  it('fails closed when Telegram reports updates queued during disablement', async () => {
    const instance = await harness({ initialState: { ...activeState(), nextUpdateOffset: 41 } })
    await waitUntil(() => { expect(instance.pendingPolls).toHaveLength(1) })
    await instance.service.disable()
    expect(instance.readState().disabledBacklog).toMatchObject({ cutoffOffset: 41 })
    instance.setPendingUpdateCount(2)

    const blocked = await instance.service.enable()
    expect(blocked).toMatchObject({
      ok: false,
      error: { code: 'backlog-pending' },
      status: { enabled: false, runtime: 'backlog-pending', pendingUpdateCount: 2 },
    })
    expect(instance.readState()).toMatchObject({ enabled: false, nextUpdateOffset: 41 })
    expect(instance.pendingPolls).toHaveLength(0)
    expect(instance.admits).not.toHaveBeenCalled()

    instance.setPendingUpdateCount(0)
    const resumed = await instance.service.enable()
    expect(resumed).toMatchObject({ ok: true, value: { enabled: true } })
    expect(instance.readState().disabledBacklog).toBeUndefined()
    await waitUntil(() => { expect(instance.pendingPolls).toHaveLength(1) })
  })

  it('rolls activation back before admitting a same-second text and command race', async () => {
    const instance = await harness({
      initialState: {
        enabled: false,
        bot: BOT_A,
        nextUpdateOffset: 55,
        binding: activeState().binding,
        disabledBacklog: { generation: ROUTE_A, cutoffOffset: 55 },
      },
    })
    const enabled = await instance.service.enable()
    if (!enabled.ok) throw new Error(`enable failed: ${enabled.error.code}`)
    const cutoff = instance.readState().activationBarrier?.messageDateCutoff
    if (cutoff === undefined) throw new Error('activation barrier missing')
    await waitUntil(() => { expect(instance.pendingPolls).toHaveLength(1) })
    const poll = instance.pendingPolls.shift()
    if (poll === undefined) throw new Error('poll missing')
    poll.respond([
      privateTextUpdate(55, 551, 'race task', cutoff),
      privateTextUpdate(56, 552, '/new', cutoff),
    ])

    await waitUntil(() => { expect(instance.readState().enabled).toBe(false) })
    expect(instance.readState().nextUpdateOffset).toBe(55)
    expect(instance.readState().activationBarrier).toBeUndefined()
    expect(instance.readState().disabledBacklog).toMatchObject({
      generation: ROUTE_A,
      cutoffOffset: 55,
    })
    expect(instance.admits).not.toHaveBeenCalled()
    expect(instance.sentTexts).toEqual([])
    expect(await instance.service.status()).toMatchObject({
      enabled: false,
      runtime: 'backlog-pending',
      pendingUpdateCount: 2,
    })
  })

  it('allows the correct unbound pairing token through a same-second activation barrier', async () => {
    const instance = await harness()
    const begun = await instance.service.beginPairing()
    if (!begun.ok) throw new Error(`begin pairing failed: ${begun.error.code}`)
    const cutoff = instance.readState().activationBarrier?.messageDateCutoff
    if (cutoff === undefined) throw new Error('activation barrier missing')
    await waitUntil(() => { expect(instance.pendingPolls).toHaveLength(1) })
    const poll = instance.pendingPolls.shift()
    if (poll === undefined) throw new Error('poll missing')
    poll.respond([privateTextUpdate(1, 101, `/start ${begun.value.token}`, cutoff)])

    await waitUntil(() => { expect(instance.readState().pairing?.kind).toBe('candidate') })
    expect(instance.readState()).toMatchObject({ enabled: true, nextUpdateOffset: 2 })
    expect(instance.admits).not.toHaveBeenCalled()
  })

  it.each([
    ['missing', undefined],
    ['negative', -1],
    ['non-numeric', 'invalid'],
  ] as const)('fails activation closed when an admissible message has a %s date', async (_label, badDate) => {
    const instance = await harness({
      initialState: {
        enabled: false,
        bot: BOT_A,
        binding: activeState().binding,
        disabledBacklog: { generation: ROUTE_A, cutoffOffset: 0 },
      },
    })
    const enabled = await instance.service.enable()
    if (!enabled.ok) throw new Error(`enable failed: ${enabled.error.code}`)
    await waitUntil(() => { expect(instance.pendingPolls).toHaveLength(1) })
    const dated = privateTextUpdate(1, 101, 'missing date')
    if (dated.message === undefined) throw new Error('message missing')
    const { date: ignoredDate, ...baseMessage } = dated.message
    void ignoredDate
    const malformed: TelegramApiMessage = {
      ...baseMessage,
      ...(badDate === undefined ? {} : { date: badDate }),
    }
    const poll = instance.pendingPolls.shift()
    if (poll === undefined) throw new Error('poll missing')
    poll.respond([{ update_id: dated.update_id, message: malformed }])

    await waitUntil(() => { expect(instance.readState().enabled).toBe(false) })
    expect(instance.readState().nextUpdateOffset).toBeUndefined()
    expect(instance.admits).not.toHaveBeenCalled()
  })

  it('removes expired candidates durably from both status and update processing', async () => {
    const instance = await harness()
    const disabled = instance.readState().disabledBacklog
    instance.replaceState({
      enabled: false,
      bot: BOT_A,
      disabledBacklog: disabled,
      pairing: {
        kind: 'candidate',
        candidate: {
          candidateId: '00000000-0000-4000-8000-000000000000',
          userId: '3',
          chatId: '3',
          firstName: 'Expired',
          receivedAt: 1,
          expiresAt: 2,
        },
      },
    })
    expect((await instance.service.status()).pairing).toEqual({ kind: 'unpaired' })
    expect(instance.readState().pairing).toBeUndefined()

    const begun = await instance.service.beginPairing()
    if (!begun.ok) throw new Error(`begin pairing failed: ${begun.error.code}`)
    await waitUntil(() => { expect(instance.pendingPolls).toHaveLength(1) })
    instance.replaceState({
      ...instance.readState(),
      pairing: {
        kind: 'candidate',
        candidate: {
          candidateId: '00000000-0000-4000-8000-000000000001',
          userId: '3',
          chatId: '3',
          firstName: 'Expired',
          receivedAt: 1,
          expiresAt: 2,
        },
      },
    })
    const poll = instance.pendingPolls.shift()
    if (poll === undefined) throw new Error('poll missing')
    poll.respond([privateTextUpdate(50, 501, 'must not run')])
    await waitUntil(() => { expect(instance.readState().nextUpdateOffset).toBe(51) })
    expect(instance.readState().pairing).toBeUndefined()
    expect(instance.admits).not.toHaveBeenCalled()
  })

  it.each(['disable', 'revoke', 'dispose'] as const)(
    '%s aborts and joins a started multi-chunk outbound generation',
    async (action) => {
      let blockedBody: TelegramRequestBody | undefined
      let blockedSignal: AbortSignal | null | undefined
      let release: ((response: Response) => void) | undefined
      const instance = await harness({
        initialState: activeState(),
        sendMessage: async (body, signal) => {
          blockedBody = body
          blockedSignal = signal
          return await new Promise<Response>((resolve) => { release = resolve })
        },
      })
      await waitUntil(() => { expect(instance.pendingPolls).toHaveLength(1) })
      const delivery = instance.deliver(ROUTE_A, 'X'.repeat(TELEGRAM_TEXT_LIMIT + 8))
      const deliveryOutcome = delivery.then(
        () => undefined,
        (error: unknown) => error,
      )
      await waitUntil(() => { expect(blockedBody?.text).toHaveLength(TELEGRAM_TEXT_LIMIT) })

      const stopping: Promise<unknown> = action === 'disable'
        ? instance.service.disable()
        : action === 'revoke'
          ? instance.service.revoke()
          : instance.ctx.fiber.dispose()
      let stopped = false
      void stopping.then(() => { stopped = true })
      await waitUntil(() => { expect(blockedSignal?.aborted).toBe(true) })
      expect(stopped).toBe(false)
      if (release === undefined || blockedBody === undefined) throw new Error('blocked send missing')
      release(sentMessageResponse(blockedBody))
      await stopping
      expect(await deliveryOutcome).toBeDefined()
      expect(instance.sentTexts.filter(text => text.startsWith('X'))).toHaveLength(1)
    },
  )

  it('credential rotation quiesces the old outbound generation before reconnecting', async () => {
    let blockedBody: TelegramRequestBody | undefined
    let blockedSignal: AbortSignal | null | undefined
    let release: ((response: Response) => void) | undefined
    const instance = await harness({
      initialState: activeState(),
      sendMessage: async (body, signal) => {
        blockedBody = body
        blockedSignal = signal
        return await new Promise<Response>((resolve) => { release = resolve })
      },
    })
    await waitUntil(() => { expect(instance.pendingPolls).toHaveLength(1) })
    const deliveryOutcome = instance.deliver(
      ROUTE_A,
      'Y'.repeat(TELEGRAM_TEXT_LIMIT + 8),
    ).then(() => undefined, (error: unknown) => error)
    await waitUntil(() => { expect(blockedBody?.text).toHaveLength(TELEGRAM_TEXT_LIMIT) })
    instance.setToken(TOKEN_B)
    instance.emitCredentialUpdated()
    await waitUntil(() => { expect(blockedSignal?.aborted).toBe(true) })
    if (release === undefined || blockedBody === undefined) throw new Error('blocked send missing')
    release(sentMessageResponse(blockedBody))
    expect(await deliveryOutcome).toBeDefined()
    await waitUntil(() => { expect(instance.calls.filter(call => call === 'getMe').length).toBeGreaterThan(1) })
    expect(instance.sentTexts.filter(text => text.startsWith('Y'))).toHaveLength(1)
  })

  it('rejects more than three Telegram chunks without sending', async () => {
    const instance = await harness({ initialState: activeState() })
    await waitUntil(() => { expect(instance.pendingPolls).toHaveLength(1) })
    await expect(instance.deliver(
      ROUTE_A,
      'Z'.repeat((TELEGRAM_TEXT_LIMIT * 3) + 1),
    )).rejects.toMatchObject({ code: 'CHANNEL_TELEGRAM_TEXT_TOO_LONG' })
    expect(instance.sentTexts).toEqual([])
  })

  it.each([400, 403])('treats a deterministic Telegram %i as a permanent one-attempt route failure', async (status) => {
    const instance = await harness({
      initialState: activeState(),
      sendMessage: async () => telegramError(status),
    })
    await waitUntil(() => { expect(instance.pendingPolls).toHaveLength(1) })

    await expect(instance.deliver(ROUTE_A, `rejected ${status}`)).rejects.toMatchObject({
      code: 'CHANNEL_TELEGRAM_ROUTE_EXPIRED',
    })
    expect(instance.sentTexts).toEqual([`rejected ${status}`])
    expect(instance.calls.filter(call => call === 'sendMessage')).toHaveLength(1)
  })

  it('serializes sends and spaces one private chat by one second', async () => {
    vi.useFakeTimers({ now: 10_000 })
    const instance = await harness({ initialState: activeState() })
    await vi.advanceTimersByTimeAsync(0)
    const first = instance.deliver(ROUTE_A, 'first')
    const second = instance.deliver(ROUTE_A, 'second')
    await vi.advanceTimersByTimeAsync(0)
    expect(instance.sentTexts).toEqual(['first'])
    await vi.advanceTimersByTimeAsync(999)
    expect(instance.sentTexts).toEqual(['first'])
    await vi.advanceTimersByTimeAsync(1)
    await Promise.all([first, second])
    expect(instance.sentTexts).toEqual(['first', 'second'])
  })

  it('does not reset getUpdates backoff after a successful getMe reconnect', async () => {
    vi.useFakeTimers({ now: 20_000 })
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const failureTimes: number[] = []
    await harness({
      initialState: activeState(),
      getUpdates: (_body, _signal, ordinal) => {
        if (ordinal > 3) return undefined
        failureTimes.push(Date.now())
        return Promise.resolve(telegramError(500))
      },
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(failureTimes).toEqual([20_000])
    await vi.advanceTimersByTimeAsync(999)
    expect(failureTimes).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(failureTimes).toEqual([20_000, 21_000])
    await vi.advanceTimersByTimeAsync(1_999)
    expect(failureTimes).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(failureTimes).toEqual([20_000, 21_000, 23_000])
  })
})
