import { describe, expect, it } from 'vitest'
import { normalizeTelegramProxyUrl, TELEGRAM_PROXY_URL_LIMIT } from '../src/proxy.ts'

describe('normalizeTelegramProxyUrl', () => {
  it('normalizes plain host-and-port proxies', () => {
    expect(normalizeTelegramProxyUrl('http://127.0.0.1:7890')).toBe('http://127.0.0.1:7890/')
    expect(normalizeTelegramProxyUrl('  http://proxy.lan:8080  ')).toBe('http://proxy.lan:8080/')
    expect(normalizeTelegramProxyUrl('https://proxy.example.test:8443/')).toBe('https://proxy.example.test:8443/')
  })

  it('treats an empty or whitespace-only input as a clear request', () => {
    expect(normalizeTelegramProxyUrl('')).toBeUndefined()
    expect(normalizeTelegramProxyUrl('   ')).toBeUndefined()
  })

  it('rejects schemes other than http and https', () => {
    expect(normalizeTelegramProxyUrl('socks5://127.0.0.1:1080')).toBeNull()
    expect(normalizeTelegramProxyUrl('file:///etc/hosts')).toBeNull()
  })

  it('rejects embedded credentials, paths, queries, and fragments', () => {
    expect(normalizeTelegramProxyUrl('http://user:pass@127.0.0.1:7890')).toBeNull()
    expect(normalizeTelegramProxyUrl('http://127.0.0.1:7890/path')).toBeNull()
    expect(normalizeTelegramProxyUrl('http://127.0.0.1:7890?x=1')).toBeNull()
    expect(normalizeTelegramProxyUrl('http://127.0.0.1:7890#frag')).toBeNull()
  })

  it('rejects unparseable input and overlong values', () => {
    expect(normalizeTelegramProxyUrl('not a url')).toBeNull()
    expect(normalizeTelegramProxyUrl('http://')).toBeNull()
    expect(normalizeTelegramProxyUrl(`http://${'a'.repeat(TELEGRAM_PROXY_URL_LIMIT)}.test/`)).toBeNull()
  })
})
