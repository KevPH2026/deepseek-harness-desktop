import { describe, expect, it, vi } from 'vitest'
import type {
  IApiClient,
  RpcResponse,
  TelegramBeginPairingResult,
  TelegramChannelStatus,
  TelegramConfirmPairingResult,
  TelegramEnableResult,
} from '@deepseek-ai/dsh-api-remotes/client'
import {
  TELEGRAM_BOT_TOKEN_REF,
  TelegramSettingsController,
  type TelegramRemotePort,
} from '../src/client/settings-store.ts'

let rpc = 0
function ok<T>(value: T): RpcResponse<T> {
  return { rpcId: `telegram-${rpc++}` as never, result: { ok: true, value } }
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function rejected<T>(): RpcResponse<T> {
  return {
    rpcId: `telegram-${rpc++}` as never,
    result: { ok: false, error: { code: 'internal', message: 'secret-shaped host detail', details: {} } },
  }
}

function channel(overrides: Partial<TelegramChannelStatus> = {}): TelegramChannelStatus {
  return {
    enabled: false,
    credentialConfigured: true,
    runtime: 'disabled',
    pairing: { kind: 'unpaired' },
    ...overrides,
  }
}

function waiting(): TelegramChannelStatus {
  return channel({
    enabled: true,
    runtime: 'polling',
    bot: { id: '42', username: 'desktop_bot', firstName: 'Desktop' },
    pairing: { kind: 'waiting', expiresAt: 2_000_000 },
  })
}

function backlog(pendingUpdateCount: number): TelegramChannelStatus {
  return channel({
    enabled: false,
    runtime: 'backlog-pending',
    pendingUpdateCount,
  })
}

function candidate(): TelegramChannelStatus {
  return channel({
    enabled: true,
    runtime: 'polling',
    pairing: {
      kind: 'candidate',
      candidate: {
        candidateId: '00000000-0000-4000-8000-000000000001',
        userId: '9007199254740993',
        chatId: '9007199254740994',
        firstName: 'Exact',
        lastName: 'Owner',
        username: 'exact_owner',
        receivedAt: 1_000_000,
        expiresAt: 2_000_000,
      },
    },
  })
}

function paired(): TelegramChannelStatus {
  return channel({
    enabled: true,
    runtime: 'polling',
    pairing: {
      kind: 'paired',
      account: {
        userId: '9007199254740993',
        chatId: '9007199254740994',
        firstName: 'Exact',
        lastName: 'Owner',
        username: 'exact_owner',
        confirmedAt: 1_500_000,
      },
    },
  })
}

function beginSuccess(status = waiting()): TelegramBeginPairingResult {
  return {
    ok: true,
    value: {
      token: 'one-time-pair-capability',
      deepLink: 'https://t.me/desktop_bot?start=one-time-pair-capability',
      expiresAt: 2_000_000,
      status,
    },
  }
}

function enableSuccess(status = channel({ enabled: true, runtime: 'polling' })): TelegramEnableResult {
  return { ok: true, value: status }
}

function api(overrides: {
  configured?: boolean
  writable?: boolean
  set?: (value: string) => Promise<RpcResponse<Record<string, never>>>
  unset?: () => Promise<RpcResponse<Record<string, never>>>
  describe?: () => Promise<RpcResponse<{ credentials: Record<string, { configured: boolean; writable: boolean }> }>>
} = {}) {
  const writes: string[] = []
  const unsets: string[] = []
  const describe = vi.fn(overrides.describe ?? (async () => ok({
    credentials: {
      [TELEGRAM_BOT_TOKEN_REF]: {
        configured: overrides.configured ?? true,
        writable: overrides.writable ?? true,
      },
    },
  })))
  return {
    writes,
    unsets,
    describe,
    face: {
      credentials: {
        describe,
        set: async ({ value }: { ref: string; value: string }) => {
          writes.push(value)
          return (overrides.set ?? (async () => ok({})))(value)
        },
        unset: async ({ ref }: { ref: string }) => {
          unsets.push(ref)
          return (overrides.unset ?? (async () => ok({})))()
        },
      },
    } as Pick<IApiClient, 'credentials'>,
  }
}

function remote(overrides: Partial<TelegramRemotePort> = {}) {
  const calls: string[] = []
  const face: TelegramRemotePort = {
    status: overrides.status ?? (async () => { calls.push('status'); return channel() }),
    enable: overrides.enable ?? (async () => { calls.push('enable'); return enableSuccess() }),
    disable: overrides.disable ?? (async () => { calls.push('disable'); return channel() }),
    beginPairing: overrides.beginPairing ?? (async () => { calls.push('begin'); return beginSuccess() }),
    confirmPairing: overrides.confirmPairing ?? (async () => { calls.push('confirm'); return { ok: true, value: paired() } }),
    revoke: overrides.revoke ?? (async () => { calls.push('revoke'); return channel() }),
    setProxy: overrides.setProxy ?? (async () => {
      calls.push('setProxy')
      return { ok: true, value: channel({ proxyUrl: 'http://127.0.0.1:7890/' }) }
    }),
  }
  return { face, calls }
}

describe('TelegramSettingsController', () => {
  it('starts disabled and joins safe status with write-only credential metadata', async () => {
    const credentials = api()
    const telegram = remote({ status: async () => waiting() })
    const controller = new TelegramSettingsController(credentials.face, telegram.face, 60_000)
    expect(controller.store.getSnapshot()).toMatchObject({ enabled: false, runtime: 'disabled' })
    await controller.load()
    expect(credentials.describe).toHaveBeenCalledWith({ refs: [TELEGRAM_BOT_TOKEN_REF] })
    expect(controller.store.getSnapshot()).toMatchObject({
      status: 'ready',
      enabled: true,
      runtime: 'online',
      botUsername: 'desktop_bot',
      pairingPhase: 'waiting',
      pairing: null,
      credential: { ref: TELEGRAM_BOT_TOKEN_REF, configured: true, writable: true },
    })
    controller.dispose()
  })

  it('writes a trimmed token without ever publishing its value', async () => {
    const credentials = api({ configured: false })
    const telegram = remote({ status: async () => channel({ credentialConfigured: false }) })
    const controller = new TelegramSettingsController(credentials.face, telegram.face)
    await controller.load()
    await expect(controller.saveToken('  123456:private-value  ')).resolves.toBe(true)
    expect(credentials.writes).toEqual(['123456:private-value'])
    expect(JSON.stringify(controller.store.getSnapshot())).not.toContain('123456:private-value')
    expect(controller.store.getSnapshot()).toMatchObject({
      action: 'idle', success: 'token-saved', credential: { configured: true },
    })
    await expect(controller.saveToken('   ')).resolves.toBe(false)
    controller.dispose()
  })

  it('enables through the dedicated Remote without replacing pairing state', async () => {
    const credentials = api()
    const disabledBinding = paired()
    const telegram = remote({
      status: async () => ({ ...disabledBinding, enabled: false, runtime: 'disabled' }),
      enable: async () => enableSuccess(disabledBinding),
    })
    const controller = new TelegramSettingsController(credentials.face, telegram.face, 60_000)
    await controller.load()
    await expect(controller.setEnabled(true)).resolves.toBe(true)
    expect(controller.store.getSnapshot()).toMatchObject({ enabled: true, pairingPhase: 'paired' })
    expect(controller.store.getSnapshot().bindings).toHaveLength(1)
    controller.dispose()
  })

  it('polls an enabled startup to online so first pairing needs no manual refresh', async () => {
    vi.useFakeTimers()
    const beginPairing = vi.fn(async () => beginSuccess())
    let statusReads = 0
    const status = vi.fn(async () => {
      statusReads += 1
      return statusReads === 1
        ? channel()
        : channel({ enabled: true, runtime: 'polling' })
    })
    const controller = new TelegramSettingsController(
      api().face,
      remote({
        status,
        enable: async () => enableSuccess(channel({ enabled: true, runtime: 'starting' })),
        beginPairing,
      }).face,
      25,
    )

    await controller.load()
    await expect(controller.setEnabled(true)).resolves.toBe(true)
    expect(controller.store.getSnapshot()).toMatchObject({
      enabled: true,
      runtime: 'starting',
      pairingPhase: 'unpaired',
    })

    await vi.advanceTimersByTimeAsync(25)
    expect(status).toHaveBeenCalledTimes(2)
    expect(controller.store.getSnapshot()).toMatchObject({
      enabled: true,
      runtime: 'online',
      pairingPhase: 'unpaired',
    })
    await expect(controller.beginPairing()).resolves.toBe(true)
    expect(beginPairing).toHaveBeenCalledTimes(1)

    controller.dispose()
    vi.useRealTimers()
  })

  it('generates a one-time pairing capability only through beginPairing', async () => {
    const credentials = api()
    const telegram = remote()
    const controller = new TelegramSettingsController(credentials.face, telegram.face, 60_000)
    await controller.load()
    await expect(controller.beginPairing()).resolves.toBe(true)
    expect(controller.store.getSnapshot()).toMatchObject({
      enabled: true,
      runtime: 'online',
      pairingPhase: 'waiting',
      pairing: {
        code: 'one-time-pair-capability',
        url: 'https://t.me/desktop_bot?start=one-time-pair-capability',
        expiresAt: 2_000_000,
      },
    })
    controller.dispose()
  })

  it('disables ingress without revoking the retained binding', async () => {
    const credentials = api()
    const live = paired()
    const disabled = { ...live, enabled: false, runtime: 'disabled' as const }
    const telegram = remote({ status: async () => live, disable: async () => disabled })
    const controller = new TelegramSettingsController(credentials.face, telegram.face)
    await controller.load()
    await expect(controller.setEnabled(false)).resolves.toBe(true)
    expect(controller.store.getSnapshot()).toMatchObject({
      enabled: false, runtime: 'disabled', pairingPhase: 'paired',
      bindings: [{ userId: '9007199254740993', chatId: '9007199254740994' }],
    })
    controller.dispose()
  })

  it('keeps business failures generic while accepting the latest fail-closed status', async () => {
    const credentials = api()
    const telegram = remote({
      beginPairing: async () => ({
        ok: false,
        error: { code: 'unauthorized' },
        status: channel({ runtime: 'unauthorized' }),
      }),
    })
    const controller = new TelegramSettingsController(credentials.face, telegram.face)
    await controller.load()
    await expect(controller.beginPairing()).resolves.toBe(false)
    expect(controller.store.getSnapshot()).toMatchObject({
      action: 'idle', error: 'pairing', enabled: false, runtime: 'error',
    })
    expect(JSON.stringify(controller.store.getSnapshot())).not.toContain('unauthorized')
    controller.dispose()
  })

  it('preserves only the backlog count and categorizes enable and pairing backlog failures', async () => {
    let currentStatus = channel()
    const enableController = new TelegramSettingsController(
      api().face,
      remote({
        status: async () => currentStatus,
        enable: async () => ({
          ok: false,
          error: { code: 'backlog-pending' },
          status: backlog(17),
        }),
      }).face,
    )
    await enableController.load()
    await expect(enableController.setEnabled(true)).resolves.toBe(false)
    expect(enableController.store.getSnapshot()).toMatchObject({
      enabled: false,
      runtime: 'backlog-pending',
      pendingUpdateCount: 17,
      error: 'backlog-pending',
    })
    expect(JSON.stringify(enableController.store.getSnapshot())).not.toContain('update body')
    currentStatus = channel()
    await enableController.refresh()
    expect('pendingUpdateCount' in enableController.store.getSnapshot()).toBe(false)
    enableController.dispose()

    const pairingController = new TelegramSettingsController(
      api().face,
      remote({
        beginPairing: async () => ({
          ok: false,
          error: { code: 'backlog-pending' },
          status: backlog(3),
        }),
      }).face,
    )
    await pairingController.load()
    await expect(pairingController.beginPairing()).resolves.toBe(false)
    expect(pairingController.store.getSnapshot()).toMatchObject({
      runtime: 'backlog-pending',
      pendingUpdateCount: 3,
      error: 'backlog-pending',
    })
    pairingController.dispose()
  })

  it('polls a waiting capability until the Host exposes a desktop-confirmable candidate', async () => {
    vi.useFakeTimers()
    let reads = 0
    const credentials = api()
    const telegram = remote({
      status: async () => reads++ === 0 ? channel() : candidate(),
      beginPairing: async () => beginSuccess(),
    })
    const controller = new TelegramSettingsController(credentials.face, telegram.face, 25)
    await controller.load()
    await controller.beginPairing()
    await vi.advanceTimersByTimeAsync(25)
    expect(controller.store.getSnapshot()).toMatchObject({
      pairingPhase: 'candidate',
      pairing: null,
      candidate: {
        id: '00000000-0000-4000-8000-000000000001',
        userId: '9007199254740993',
        chatId: '9007199254740994',
        displayName: 'Exact Owner',
      },
    })
    controller.dispose()
    vi.useRealTimers()
  })

  it('confirms only the exact current candidate and projects the resulting binding', async () => {
    const credentials = api()
    const confirmations: string[] = []
    const result: TelegramConfirmPairingResult = { ok: true, value: paired() }
    const telegram = remote({
      status: async () => candidate(),
      confirmPairing: async ({ candidateId }) => { confirmations.push(candidateId); return result },
    })
    const controller = new TelegramSettingsController(credentials.face, telegram.face)
    await controller.load()
    await expect(controller.confirmPairing('wrong-candidate')).resolves.toBe(false)
    await expect(controller.confirmPairing('00000000-0000-4000-8000-000000000001')).resolves.toBe(true)
    expect(confirmations).toEqual(['00000000-0000-4000-8000-000000000001'])
    expect(controller.store.getSnapshot()).toMatchObject({
      pairingPhase: 'paired',
      candidate: null,
      bindings: [{
        id: 'telegram:9007199254740993:9007199254740994',
        userId: '9007199254740993',
        chatId: '9007199254740994',
        displayName: 'Exact Owner',
      }],
    })
    controller.dispose()
  })

  it('rejects a stale revoke id and disables the exact current binding', async () => {
    const credentials = api()
    const telegram = remote({ status: async () => paired() })
    const controller = new TelegramSettingsController(credentials.face, telegram.face)
    await controller.load()
    await expect(controller.revokeBinding('another-binding')).resolves.toBe(false)
    await expect(controller.revokeBinding('telegram:9007199254740993:9007199254740994')).resolves.toBe(true)
    expect(controller.store.getSnapshot()).toMatchObject({ enabled: false, bindings: [], pairingPhase: 'unpaired' })
    controller.dispose()
  })

  it('revokes before removing a token and never unsets when fail-closed revoke is uncertain', async () => {
    const events: string[] = []
    const credentials = api({ unset: async () => { events.push('unset'); return ok({}) } })
    const telegram = remote({ revoke: async () => { events.push('revoke'); return channel() } })
    const controller = new TelegramSettingsController(credentials.face, telegram.face)
    await controller.load()
    await expect(controller.removeToken()).resolves.toBe(true)
    expect(events).toEqual(['revoke', 'unset'])
    expect(credentials.unsets).toEqual([TELEGRAM_BOT_TOKEN_REF])
    expect(controller.store.getSnapshot()).toMatchObject({
      enabled: false, success: 'token-removed', credential: { configured: false },
    })
    controller.dispose()

    const blockedCredentials = api()
    const blockedRemote = remote({ revoke: async () => { throw new Error('connection lost') } })
    const blocked = new TelegramSettingsController(blockedCredentials.face, blockedRemote.face)
    await blocked.load()
    await expect(blocked.removeToken()).resolves.toBe(false)
    expect(blockedCredentials.unsets).toEqual([])
    expect(blocked.store.getSnapshot().error).toBe('token-remove')
    blocked.dispose()
  })

  it('surfaces credential failures without retaining Host details and scopes invalidation by ref', async () => {
    const credentials = api({
      set: async () => rejected(),
    })
    const telegram = remote()
    const controller = new TelegramSettingsController(credentials.face, telegram.face)
    await controller.load()
    await expect(controller.saveToken('another-private-value')).resolves.toBe(false)
    expect(controller.store.getSnapshot().error).toBe('token-save')
    expect(JSON.stringify(controller.store.getSnapshot())).not.toContain('secret-shaped host detail')
    const before = credentials.describe.mock.calls.length
    controller.refreshCredential('ANOTHER_SECRET')
    await Promise.resolve()
    expect(credentials.describe).toHaveBeenCalledTimes(before)
    controller.refreshCredential(TELEGRAM_BOT_TOKEN_REF)
    await vi.waitFor(() => { expect(credentials.describe).toHaveBeenCalledTimes(before + 1) })
    controller.dispose()
  })

  it('maps every runtime family and preserves exact identities with optional profile fields absent', async () => {
    const statuses: TelegramChannelStatus[] = [
      channel({ runtime: 'stopping' }),
      channel({ runtime: 'backing-off' }),
      channel({
        enabled: true,
        runtime: 'polling',
        pairing: {
          kind: 'candidate',
          candidate: {
            candidateId: 'candidate-without-profile',
            userId: '9007199254740995',
            chatId: '9007199254740996',
            firstName: 'Solo',
            receivedAt: 1_000_000,
            expiresAt: 2_000_000,
          },
        },
      }),
      channel({
        enabled: true,
        runtime: 'polling',
        pairing: {
          kind: 'paired',
          account: {
            userId: '9007199254740995',
            chatId: '9007199254740996',
            firstName: 'Solo',
            confirmedAt: 1_500_000,
          },
        },
      }),
    ]
    const credentials = api({ describe: async () => ok({ credentials: {} }) })
    const telegram = remote({ status: async () => statuses.shift()! })
    const controller = new TelegramSettingsController(credentials.face, telegram.face)

    await controller.load()
    expect(controller.store.getSnapshot()).toMatchObject({
      runtime: 'starting',
      credential: { configured: true, writable: true },
    })
    await controller.refresh()
    expect(controller.store.getSnapshot().runtime).toBe('offline')
    await controller.refresh()
    expect(controller.store.getSnapshot().candidate).toEqual({
      id: 'candidate-without-profile',
      userId: '9007199254740995',
      chatId: '9007199254740996',
      displayName: 'Solo',
    })
    await controller.refresh()
    expect(controller.store.getSnapshot().bindings).toEqual([{
      id: 'telegram:9007199254740995:9007199254740996',
      userId: '9007199254740995',
      chatId: '9007199254740996',
      displayName: 'Solo',
      pairedAt: 1_500_000,
    }])
    controller.dispose()
  })

  it('distinguishes an initial load failure, a refresh failure, and a stale disposed failure', async () => {
    const rejectedCredentials = api({ describe: async () => rejected() })
    const first = new TelegramSettingsController(rejectedCredentials.face, remote().face)
    await first.load()
    expect(first.store.getSnapshot()).toMatchObject({
      status: 'error', error: 'load', credential: { status: 'error' },
    })
    first.dispose()
    await expect(first.load()).resolves.toBeUndefined()

    let failRefresh = false
    const refreshRemote = remote({
      status: async () => {
        if (failRefresh) throw new Error('refresh unavailable')
        return channel()
      },
    })
    const refreshed = new TelegramSettingsController(api().face, refreshRemote.face)
    await refreshed.load()
    failRefresh = true
    await refreshed.refresh()
    expect(refreshed.store.getSnapshot()).toMatchObject({
      status: 'ready', error: 'refresh', credential: { status: 'error' },
    })
    refreshed.dispose()

    const pendingStatus = deferred<TelegramChannelStatus>()
    const stale = new TelegramSettingsController(
      api().face,
      remote({ status: () => pendingStatus.promise }).face,
    )
    const load = stale.load()
    stale.dispose()
    pendingStatus.reject(new Error('late failure'))
    await expect(load).resolves.toBeUndefined()
    expect(stale.store.getSnapshot().status).toBe('loading')
  })

  it('keeps every write unavailable until its exact preconditions are present', async () => {
    const controller = new TelegramSettingsController(api().face, remote().face)
    await expect(controller.removeToken()).resolves.toBe(false)
    await expect(controller.setEnabled(false)).resolves.toBe(false)
    await expect(controller.beginPairing()).resolves.toBe(false)
    await expect(controller.setEnabled(true)).resolves.toBe(false)
    controller.dispose()
  })

  it('keeps Host mutation and business failures categorical', async () => {
    const disable = new TelegramSettingsController(
      api().face,
      remote({
        status: async () => paired(),
        disable: async () => { throw new Error('private disable detail') },
      }).face,
    )
    await disable.load()
    await expect(disable.setEnabled(false)).resolves.toBe(false)
    expect(disable.store.getSnapshot().error).toBe('disable')
    disable.dispose()

    const confirmRejected = new TelegramSettingsController(
      api().face,
      remote({
        status: async () => candidate(),
        confirmPairing: async () => ({
          ok: false,
          error: { code: 'candidate-expired' },
          status: channel(),
        }),
      }).face,
    )
    await confirmRejected.load()
    await expect(confirmRejected.confirmPairing('00000000-0000-4000-8000-000000000001')).resolves.toBe(false)
    expect(confirmRejected.store.getSnapshot()).toMatchObject({ error: 'confirm', pairingPhase: 'unpaired' })
    confirmRejected.dispose()

    const confirmThrown = new TelegramSettingsController(
      api().face,
      remote({
        status: async () => candidate(),
        confirmPairing: async () => { throw new Error('private confirm detail') },
      }).face,
    )
    await confirmThrown.load()
    await expect(confirmThrown.confirmPairing('00000000-0000-4000-8000-000000000001')).resolves.toBe(false)
    expect(confirmThrown.store.getSnapshot().error).toBe('confirm')
    confirmThrown.dispose()

    const revoke = new TelegramSettingsController(
      api().face,
      remote({
        status: async () => paired(),
        revoke: async () => { throw new Error('private revoke detail') },
      }).face,
    )
    await revoke.load()
    await expect(revoke.revokeBinding('telegram:9007199254740993:9007199254740994')).resolves.toBe(false)
    expect(revoke.store.getSnapshot().error).toBe('revoke')
    revoke.dispose()

    const pairing = new TelegramSettingsController(
      api().face,
      remote({ beginPairing: async () => { throw new Error('private pairing detail') } }).face,
    )
    await pairing.load()
    await expect(pairing.beginPairing()).resolves.toBe(false)
    expect(pairing.store.getSnapshot().error).toBe('pairing')
    pairing.dispose()

    const enableRejected = new TelegramSettingsController(
      api().face,
      remote({
        enable: async () => ({
          ok: false,
          error: { code: 'unauthorized' },
          status: channel({ runtime: 'unauthorized' }),
        }),
      }).face,
    )
    await enableRejected.load()
    await expect(enableRejected.setEnabled(true)).resolves.toBe(false)
    expect(enableRejected.store.getSnapshot()).toMatchObject({ error: 'enable', runtime: 'error' })
    enableRejected.dispose()

    const enableThrown = new TelegramSettingsController(
      api().face,
      remote({ enable: async () => { throw new Error('private enable detail') } }).face,
    )
    await enableThrown.load()
    await expect(enableThrown.setEnabled(true)).resolves.toBe(false)
    expect(enableThrown.store.getSnapshot().error).toBe('enable')
    enableThrown.dispose()
  })

  it('drops every successful Host mutation that resolves after disposal', async () => {
    const saveResult = deferred<RpcResponse<Record<string, never>>>()
    const save = new TelegramSettingsController(
      api({ set: () => saveResult.promise }).face,
      remote().face,
    )
    await save.load()
    const saving = save.saveToken('late-token')
    save.dispose()
    saveResult.resolve(ok({}))
    await expect(saving).resolves.toBe(false)

    const unsetResult = deferred<RpcResponse<Record<string, never>>>()
    const removeCredentials = api({ unset: () => unsetResult.promise })
    const remove = new TelegramSettingsController(removeCredentials.face, remote().face)
    await remove.load()
    const removing = remove.removeToken()
    await vi.waitFor(() => { expect(removeCredentials.unsets).toHaveLength(1) })
    remove.dispose()
    unsetResult.resolve(ok({}))
    await expect(removing).resolves.toBe(false)

    const disableResult = deferred<TelegramChannelStatus>()
    const disable = new TelegramSettingsController(
      api().face,
      remote({ status: async () => paired(), disable: () => disableResult.promise }).face,
    )
    await disable.load()
    const disabling = disable.setEnabled(false)
    disable.dispose()
    disableResult.resolve(channel())
    await expect(disabling).resolves.toBe(false)

    const confirmResult = deferred<TelegramConfirmPairingResult>()
    const confirm = new TelegramSettingsController(
      api().face,
      remote({ status: async () => candidate(), confirmPairing: () => confirmResult.promise }).face,
    )
    await confirm.load()
    const confirming = confirm.confirmPairing('00000000-0000-4000-8000-000000000001')
    confirm.dispose()
    confirmResult.resolve({ ok: true, value: paired() })
    await expect(confirming).resolves.toBe(false)

    const revokeResult = deferred<TelegramChannelStatus>()
    const revoke = new TelegramSettingsController(
      api().face,
      remote({ status: async () => paired(), revoke: () => revokeResult.promise }).face,
    )
    await revoke.load()
    const revoking = revoke.revokeBinding('telegram:9007199254740993:9007199254740994')
    revoke.dispose()
    revokeResult.resolve(channel())
    await expect(revoking).resolves.toBe(false)

    const pairingResult = deferred<TelegramBeginPairingResult>()
    const pairing = new TelegramSettingsController(
      api().face,
      remote({ beginPairing: () => pairingResult.promise }).face,
    )
    await pairing.load()
    const beginning = pairing.beginPairing()
    pairing.dispose()
    pairingResult.resolve(beginSuccess())
    await expect(beginning).resolves.toBe(false)

    const enableResult = deferred<TelegramEnableResult>()
    const enable = new TelegramSettingsController(
      api().face,
      remote({ enable: () => enableResult.promise }).face,
    )
    await enable.load()
    const enabling = enable.setEnabled(true)
    enable.dispose()
    enableResult.resolve(enableSuccess())
    await expect(enabling).resolves.toBe(false)
  })

  it('does not publish a failure that arrives after disposal', async () => {
    const enableResult = deferred<TelegramEnableResult>()
    const controller = new TelegramSettingsController(
      api().face,
      remote({ enable: () => enableResult.promise }).face,
    )
    await controller.load()
    const enabling = controller.setEnabled(true)
    controller.dispose()
    enableResult.reject(new Error('late private failure'))
    await expect(enabling).resolves.toBe(false)
    expect(controller.store.getSnapshot()).toMatchObject({ action: 'enabling', error: null })
  })

  it('defers a credential-triggered refresh until the active write completes', async () => {
    const saveResult = deferred<RpcResponse<Record<string, never>>>()
    const credentials = api({ set: () => saveResult.promise })
    const controller = new TelegramSettingsController(credentials.face, remote().face)
    await controller.load()
    const before = credentials.describe.mock.calls.length
    const saving = controller.saveToken('short-lived-draft')
    controller.refreshCredential(TELEGRAM_BOT_TOKEN_REF)
    expect(credentials.describe).toHaveBeenCalledTimes(before)
    saveResult.resolve(ok({}))
    await expect(saving).resolves.toBe(true)
    await vi.waitFor(() => { expect(credentials.describe).toHaveBeenCalledTimes(before + 1) })
    controller.dispose()
  })

  it('retains a live one-time link across matching refreshes and replaces its poll timer', async () => {
    vi.useFakeTimers()
    let status = channel()
    const controller = new TelegramSettingsController(
      api().face,
      remote({ status: async () => status }).face,
      60_000,
    )
    await controller.load()
    await controller.beginPairing()
    const link = controller.store.getSnapshot().pairing
    status = waiting()
    await controller.refresh()
    expect(controller.store.getSnapshot().pairing).toBe(link)
    controller.dispose()
    vi.useRealTimers()
  })

  it('cancels a candidate poll while an action is busy and leaves a disabled state stopped', async () => {
    vi.useFakeTimers()
    const controller = new TelegramSettingsController(
      api().face,
      remote({ status: async () => waiting() }).face,
      25,
    )
    await controller.load()
    controller.store.update((state) => { state.action = 'saving-token' })
    await vi.advanceTimersByTimeAsync(25)
    controller.store.update((state) => {
      state.action = 'idle'
      state.enabled = false
    })
    await vi.advanceTimersByTimeAsync(25)
    controller.dispose()
    vi.useRealTimers()
  })

  it('stops recovery polling after a stable error, disable, or disposal', async () => {
    vi.useFakeTimers()

    let errorReads = 0
    const errorStatus = vi.fn(async () => {
      errorReads += 1
      return errorReads === 1
        ? channel()
        : channel({ enabled: true, runtime: 'unauthorized' })
    })
    const errored = new TelegramSettingsController(
      api().face,
      remote({
        status: errorStatus,
        enable: async () => enableSuccess(channel({ enabled: true, runtime: 'starting' })),
      }).face,
      25,
    )
    await errored.load()
    await errored.setEnabled(true)
    await vi.advanceTimersByTimeAsync(25)
    expect(errored.store.getSnapshot().runtime).toBe('error')
    await vi.advanceTimersByTimeAsync(100)
    expect(errorStatus).toHaveBeenCalledTimes(2)
    errored.dispose()

    const disabledStatus = vi.fn(async () => channel())
    const disabled = new TelegramSettingsController(
      api().face,
      remote({
        status: disabledStatus,
        enable: async () => enableSuccess(channel({ enabled: true, runtime: 'backing-off' })),
      }).face,
      25,
    )
    await disabled.load()
    await disabled.setEnabled(true)
    expect(disabled.store.getSnapshot().runtime).toBe('offline')
    await vi.advanceTimersByTimeAsync(25)
    expect(disabled.store.getSnapshot()).toMatchObject({ enabled: false, runtime: 'disabled' })
    await vi.advanceTimersByTimeAsync(100)
    expect(disabledStatus).toHaveBeenCalledTimes(2)
    disabled.dispose()

    const disposedStatus = vi.fn(async () => channel())
    const disposed = new TelegramSettingsController(
      api().face,
      remote({
        status: disposedStatus,
        enable: async () => enableSuccess(channel({ enabled: true, runtime: 'starting' })),
      }).face,
      25,
    )
    await disposed.load()
    await disposed.setEnabled(true)
    disposed.dispose()
    await vi.advanceTimersByTimeAsync(100)
    expect(disposedStatus).toHaveBeenCalledTimes(1)

    vi.useRealTimers()
  })

  it('invalidates an in-flight recovery poll and never overlaps its replacement', async () => {
    vi.useFakeTimers()
    const lateStatus = deferred<TelegramChannelStatus>()
    let activePolls = 0
    let maxActivePolls = 0
    let statusReads = 0
    const status = vi.fn(async () => {
      statusReads += 1
      if (statusReads === 1) return channel()
      activePolls += 1
      maxActivePolls = Math.max(maxActivePolls, activePolls)
      try {
        return statusReads === 2
          ? await lateStatus.promise
          : channel({ enabled: true, runtime: 'polling' })
      } finally {
        activePolls -= 1
      }
    })
    const controller = new TelegramSettingsController(
      api().face,
      remote({
        status,
        enable: async () => enableSuccess(channel({ enabled: true, runtime: 'starting' })),
      }).face,
      25,
    )

    await controller.load()
    await controller.setEnabled(true)
    await vi.advanceTimersByTimeAsync(25)
    expect(status).toHaveBeenCalledTimes(2)

    await expect(controller.saveToken('replacement-token')).resolves.toBe(true)
    await controller.refresh()
    await vi.advanceTimersByTimeAsync(100)
    expect(status).toHaveBeenCalledTimes(2)

    lateStatus.resolve(channel({ enabled: true, runtime: 'starting' }))
    await vi.advanceTimersByTimeAsync(0)
    expect(status).toHaveBeenCalledTimes(3)
    expect(maxActivePolls).toBe(1)
    expect(controller.store.getSnapshot().runtime).toBe('online')

    controller.dispose()
    vi.useRealTimers()
  })

  it('reports current poll failures and drops stale poll responses and failures', async () => {
    vi.useFakeTimers()
    let calls = 0
    const lateStatus = deferred<TelegramChannelStatus>()
    const current = new TelegramSettingsController(
      api().face,
      remote({
        status: async () => {
          calls += 1
          if (calls === 1) return waiting()
          if (calls === 2) throw new Error('poll unavailable')
          return lateStatus.promise
        },
      }).face,
      25,
    )
    await current.load()
    await vi.advanceTimersByTimeAsync(25)
    expect(current.store.getSnapshot().error).toBe('refresh')
    await vi.advanceTimersByTimeAsync(25)
    expect(calls).toBe(3)
    current.dispose()
    lateStatus.resolve(candidate())
    await Promise.resolve()
    await Promise.resolve()
    expect(current.store.getSnapshot().pairingPhase).toBe('waiting')

    const lateFailure = deferred<TelegramChannelStatus>()
    let failureCalls = 0
    const staleFailure = new TelegramSettingsController(
      api().face,
      remote({
        status: async () => {
          failureCalls += 1
          return failureCalls === 1 ? waiting() : lateFailure.promise
        },
      }).face,
      25,
    )
    await staleFailure.load()
    await vi.advanceTimersByTimeAsync(25)
    expect(failureCalls).toBe(2)
    staleFailure.dispose()
    lateFailure.reject(new Error('late poll failure'))
    await Promise.resolve()
    await Promise.resolve()
    expect(staleFailure.store.getSnapshot().error).toBeNull()
    vi.useRealTimers()
  })
})

describe('TelegramSettingsController proxy override', () => {
  it('saves the trimmed proxy override and absorbs the projected status', async () => {
    const { face } = remote()
    const controller = new TelegramSettingsController(api().face, face)
    await controller.load()
    expect(await controller.saveProxy('  http://127.0.0.1:7890  ')).toBe(true)
    const snapshot = controller.store.getSnapshot()
    expect(snapshot.action).toBe('idle')
    expect(snapshot.error).toBeNull()
    expect(snapshot.success).toBe('proxy-saved')
    expect(snapshot.proxyUrl).toBe('http://127.0.0.1:7890/')
  })

  it('maps a rejected proxy write to the proxy-save error and keeps the previous value', async () => {
    const { face } = remote({
      setProxy: async () => ({ ok: false, error: { code: 'invalid-proxy' as const }, status: channel() }),
    })
    const controller = new TelegramSettingsController(api().face, face)
    await controller.load()
    expect(await controller.saveProxy('socks5://127.0.0.1:1080')).toBe(false)
    const snapshot = controller.store.getSnapshot()
    expect(snapshot.action).toBe('idle')
    expect(snapshot.error).toBe('proxy-save')
    expect(snapshot.proxyUrl).toBeUndefined()
    controller.dispose()
  })

  it('ignores proxy writes unless the page is ready and idle', async () => {
    const { face } = remote()
    const controller = new TelegramSettingsController(api().face, face)
    expect(await controller.saveProxy('http://127.0.0.1:7890')).toBe(false)
    controller.dispose()
  })
})
