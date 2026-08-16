import { describe, expect, it } from 'vitest'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  ChannelConversationId,
  ChannelExternalMessageId,
  ChannelProviderId,
  ChannelSenderId,
} from '@deepseek-ai/dsh-channel'
import { channelPromptSettlement } from '@deepseek-ai/dsh-channel-agent'

const source = {
  kind: 'user' as const,
  channel: 'external' as const,
  provider: ChannelProviderId('telegram'),
  conversationId: ChannelConversationId('chat'),
  senderId: ChannelSenderId('user'),
  externalMessageId: ChannelExternalMessageId('message'),
}

function event<T extends SessionEvent['type']>(
  seq: number,
  type: T,
  data: Extract<SessionEvent, { type: T }>['data'],
): SessionEvent {
  return { seq, time: seq + 1, type, data } as SessionEvent
}

describe('channelPromptSettlement()', () => {
  it('does not treat an idle or unrelated completed turn as this prompt completion', () => {
    const prompt = createUserMessage({ content: [{ type: 'text', text: 'work' }], source })
    const events: SessionEvent[] = [
      event(0, 'turn/start', { turn: 1 }),
      event(1, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
      event(2, 'agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [prompt] }),
    ]
    expect(channelPromptSettlement(events, prompt.id)).toBeUndefined()
  })

  it('returns only the exact turn/end and its final assistant text', () => {
    const first = createUserMessage({ content: [{ type: 'text', text: 'first' }], source })
    const second = createUserMessage({
      content: [{ type: 'text', text: 'second' }],
      source: { ...source, externalMessageId: ChannelExternalMessageId('message-2') },
    })
    const events: SessionEvent[] = [
      event(0, 'turn/start', { turn: 1 }),
      event(1, 'step/start', { turn: 1, step: 1 }),
      event(2, 'user/message', first),
      event(3, 'assistant/message', {
        turn: 1,
        step: 1,
        message: createAssistantMessage({
          content: [{ type: 'text', text: 'first result' }],
          source: { provider: 'test', model: 'test' },
        }),
      }),
      event(4, 'step/end', { turn: 1, step: 1 }),
      event(5, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
      event(6, 'turn/start', { turn: 2 }),
      event(7, 'step/start', { turn: 2, step: 1 }),
      event(8, 'user/message', second),
      event(9, 'assistant/message', {
        turn: 2,
        step: 1,
        message: createAssistantMessage({
          content: [{ type: 'text', text: 'second result' }],
          source: { provider: 'test', model: 'test' },
        }),
      }),
      event(10, 'step/end', { turn: 2, step: 1 }),
      event(11, 'turn/end', { turn: 2, reason: { kind: 'aborted', reason: { kind: 'user' } } }),
    ]
    expect(channelPromptSettlement(events, second.id)).toEqual({
      turn: 2,
      reason: { kind: 'aborted', reason: { kind: 'user' } },
      text: 'second result',
    })
  })
})
