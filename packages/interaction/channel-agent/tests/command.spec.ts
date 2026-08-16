import { describe, expect, it } from 'vitest'
import { parseChannelInput } from '@deepseek-ai/dsh-channel-agent'

describe('parseChannelInput()', () => {
  it('keeps free text as an Agent prompt', () => {
    expect(parseChannelInput('research this')).toEqual({ kind: 'prompt', text: 'research this' })
  })

  it.each([
    ['/new', 'new', ''],
    ['/new research this', 'new', 'research this'],
    ['/sessions', 'sessions', ''],
    ['/use 2', 'use', '2'],
    ['/status', 'status', ''],
    ['/stop', 'stop', ''],
    ['/help', 'help', ''],
  ] as const)('parses supported command %s', (text, name, input) => {
    expect(parseChannelInput(text)).toEqual({ kind: 'command', name, input })
  })

  it.each(['/shell whoami', '/rpc sessions.cancel', '/permission full-access', '/approve'])(
    'rejects unsupported command %s without prompt fallback',
    (text) => {
      expect(parseChannelInput(text)).toMatchObject({ kind: 'unknown-command' })
    },
  )
})
