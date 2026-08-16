import { describe, expect, it } from 'vitest'
import { channelAgentAdmissionRowSchema } from '@deepseek-ai/dsh-channel-agent/src/spec.ts'

const reply = {
  provider: 'telegram',
  conversationId: 'conversation',
  senderId: 'sender',
  externalMessageId: 'message',
  textDigest: '0'.repeat(64),
  admittedAt: 1,
  kind: 'reply' as const,
  replyText: 'reply',
  delivered: false,
}

describe('channel Agent durable admission schema', () => {
  it('accepts rows written before abandonment markers and only the closed permanent-code set', () => {
    expect(channelAgentAdmissionRowSchema.parse(reply)).toEqual(reply)
    expect(channelAgentAdmissionRowSchema.parse({
      ...reply,
      deliveryAbandoned: 'CHANNEL_TELEGRAM_ROUTE_EXPIRED',
    })).toMatchObject({ deliveryAbandoned: 'CHANNEL_TELEGRAM_ROUTE_EXPIRED' })
    expect(() => channelAgentAdmissionRowSchema.parse({
      ...reply,
      deliveryAbandoned: 'CHANNEL_TELEGRAM_UNAVAILABLE',
    })).toThrow()
  })
})
