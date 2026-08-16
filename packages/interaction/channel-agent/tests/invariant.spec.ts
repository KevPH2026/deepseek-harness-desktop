import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import {
  ChannelConversationId,
  ChannelExternalMessageId,
  ChannelProviderId,
  ChannelSenderId,
} from '@deepseek-ai/dsh-channel'
import * as ChannelAgentInvariant from '@deepseek-ai/dsh-channel-agent/invariant'

const source = {
  kind: 'user' as const,
  channel: 'external' as const,
  provider: ChannelProviderId('telegram'),
  conversationId: ChannelConversationId('chat'),
  senderId: ChannelSenderId('user'),
  externalMessageId: ChannelExternalMessageId('message'),
}

describe('channel Agent invariant', () => {
  it('accepts a channel user message admitted through the Agent inbox', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(InvariantRegistry, { enabled: true })
    const invariant = await ctx.plugin(ChannelAgentInvariant)
    const session = ctx.sessions.create(SessionId('channel-valid'))
    const message = createUserMessage({ content: [{ type: 'text', text: 'work' }], source })
    session.append('agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [message] })
    expect(() => session.append('user/message', message, { surfaceOp: 'append' })).not.toThrow()
    await invariant.dispose()
  })

  it('rejects model-visible channel text that bypassed the inbox', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(InvariantRegistry, { enabled: true })
    const invariant = await ctx.plugin(ChannelAgentInvariant)
    const session = ctx.sessions.create(SessionId('channel-invalid'))
    const message = createUserMessage({ content: [{ type: 'text', text: 'work' }], source })
    expect(() => session.append('user/message', message, { surfaceOp: 'append' }))
      .toThrow(/no prior Agent inbox admission/)
    await invariant.dispose()
  })
})
