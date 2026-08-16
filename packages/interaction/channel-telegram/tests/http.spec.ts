import { describe, expect, it, vi } from 'vitest'
import {
  splitTelegramPlainText,
  TelegramBotApiClient,
  TelegramBotApiError,
} from '../src/http.ts'

const TOKEN = ['123456', 'test_only_token_never_use'].join(':')

function telegramResponse(result: unknown, status = 200): Response {
  return new Response(JSON.stringify({ ok: true, result }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function requestUrl(input: string | URL | Request): string {
  if (typeof input === 'string') return input
  return input instanceof URL ? input.href : input.url
}

function requestBody(init: RequestInit | undefined): Record<string, unknown> {
  if (typeof init?.body !== 'string') throw new TypeError('expected a JSON string request body')
  return JSON.parse(init.body) as Record<string, unknown>
}

describe('TelegramBotApiClient', () => {
  it('uses POST for getMe/getWebhookInfo and pins long polling to message updates', async () => {
    const calls: Array<{
      readonly url: string
      readonly body: Record<string, unknown>
      readonly redirect: RequestRedirect | undefined
    }> = []
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = requestUrl(input)
      calls.push({ url, body: requestBody(init), redirect: init?.redirect })
      if (url.endsWith('/getMe')) {
        return telegramResponse({ id: 7, is_bot: true, first_name: 'Harness', username: 'HarnessBot' })
      }
      if (url.endsWith('/getWebhookInfo')) return telegramResponse({ url: '', pending_update_count: 0 })
      return telegramResponse([])
    }) as unknown as typeof fetch
    const client = new TelegramBotApiClient(async () => TOKEN, fetcher)

    const authenticated = await client.getMe()
    await client.getWebhookInfo(authenticated.credentialFingerprint)
    await client.getUpdates(42, 30, authenticated.credentialFingerprint)

    expect(calls.map(call => call.url.split('/').at(-1))).toEqual(['getMe', 'getWebhookInfo', 'getUpdates'])
    expect(calls.every(call => call.redirect === 'error')).toBe(true)
    expect(calls[2]?.body).toEqual({ offset: 42, limit: 100, timeout: 30, allowed_updates: ['message'] })
    expect(calls[0]?.body).toEqual({})
  })

  it('sends plain text without parse mode and only a valid reply id', async () => {
    const bodies: Record<string, unknown>[] = []
    const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      bodies.push(requestBody(init))
      if (bodies.length === 1) {
        return telegramResponse({ id: 7, is_bot: true, first_name: 'Harness', username: 'HarnessBot' })
      }
      return telegramResponse({ message_id: 9, chat: { id: 8, type: 'private' }, text: 'hello' })
    }) as unknown as typeof fetch
    const client = new TelegramBotApiClient(async () => TOKEN, fetcher)
    const auth = await client.getMe()

    await client.sendMessage('8', 'hello', auth.credentialFingerprint, '7')
    expect(bodies[1]).toEqual({
      chat_id: '8',
      text: 'hello',
      reply_parameters: { message_id: 7, allow_sending_without_reply: true },
    })
    expect(bodies[1]).not.toHaveProperty('parse_mode')
  })

  it('fails before fetch when the credential changes between operations', async () => {
    let token = TOKEN
    const fetcher = vi.fn(async () => telegramResponse({
      id: 7, is_bot: true, first_name: 'Harness', username: 'HarnessBot',
    })) as unknown as typeof fetch
    const client = new TelegramBotApiClient(async () => token, fetcher)
    const auth = await client.getMe()
    token = ['999999', 'different_test_only_token'].join(':')

    await expect(client.getWebhookInfo(auth.credentialFingerprint)).rejects.toMatchObject({
      kind: 'credential-changed',
    })
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('honors safe API status/retry metadata without retaining Telegram descriptions or secrets', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      ok: false,
      error_code: 429,
      description: `secret ${TOKEN}`,
      parameters: { retry_after: 4 },
    }), { status: 429 })) as unknown as typeof fetch
    const client = new TelegramBotApiClient(async () => TOKEN, fetcher)

    const error = await client.getMe().catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(TelegramBotApiError)
    expect(error).toMatchObject({ kind: 'api', status: 429, retryAfter: 4 })
    expect(String(error)).not.toContain(TOKEN)
    expect(String(error)).not.toContain('description')
    expect(error).not.toHaveProperty('cause')
  })

  it('collapses resolver and network exceptions to secret-safe errors', async () => {
    const resolverClient = new TelegramBotApiClient(async () => {
      throw new Error(`credential backend leaked ${TOKEN}`)
    }, vi.fn() as typeof fetch)
    await expect(resolverClient.getMe()).rejects.toMatchObject({ kind: 'credential-missing' })

    const networkClient = new TelegramBotApiClient(async () => TOKEN, vi.fn(async () => {
      throw new Error(`failed URL contains ${TOKEN}`)
    }))
    const error = await networkClient.getMe().catch((caught: unknown) => caught)
    expect(error).toMatchObject({ kind: 'network' })
    expect(String(error)).not.toContain(TOKEN)
  })
})

describe('splitTelegramPlainText', () => {
  it('keeps every chunk at 4096 units and never cuts a surrogate pair', () => {
    const text = `${'a'.repeat(4095)}😀${'b'.repeat(4095)}`
    const chunks = splitTelegramPlainText(text)
    expect(chunks.join('')).toBe(text)
    expect(chunks.every(chunk => chunk.length <= 4096)).toBe(true)
    expect(chunks[0]?.endsWith('\uD83D')).toBe(false)
    expect(chunks[1]?.startsWith('\uDE00')).toBe(false)
  })

  it('rejects a limit too small to preserve an astral code point', () => {
    expect(() => splitTelegramPlainText('😀', 1)).toThrow(/at least two/)
  })
})
