import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import ChannelService, {
  ChannelConversationId,
  ChannelExternalMessageId,
  ChannelProviderId,
  ChannelSenderId,
  type ChannelInboundMessage,
  type ChannelProvider,
} from '@deepseek-ai/dsh-channel'

const inbound: ChannelInboundMessage = {
  provider: ChannelProviderId('test'),
  conversationId: ChannelConversationId('conversation'),
  senderId: ChannelSenderId('sender'),
  externalMessageId: ChannelExternalMessageId('message'),
  text: 'hello',
}

async function mount(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(ChannelService)
  return ctx
}

describe('ChannelService', () => {
  it('routes admission and delivery through matching registrations', async () => {
    const ctx = await mount()
    const deliver = vi.fn<ChannelProvider['deliver']>(async () => ({
      externalMessageId: ChannelExternalMessageId('outbound'),
    }))
    ctx.channel.registerProvider({ id: inbound.provider, deliver })
    const admit = vi.fn(async () => ({ kind: 'accepted' as const }))
    ctx.channel.registerConsumer({ admit })

    await expect(ctx.channel.admit(inbound)).resolves.toEqual({ kind: 'accepted' })
    await expect(ctx.channel.deliver({
      provider: inbound.provider,
      conversationId: inbound.conversationId,
      replyTo: inbound.externalMessageId,
      text: 'done',
    })).resolves.toEqual({ externalMessageId: 'outbound' })
    expect(admit).toHaveBeenCalledWith(inbound, expect.any(AbortSignal))
    expect(deliver).toHaveBeenCalledOnce()
  })

  it('rejects missing and duplicate registrations', async () => {
    const ctx = await mount()
    await expect(ctx.channel.admit(inbound)).rejects.toMatchObject({ code: 'CHANNEL_PROVIDER_MISSING' })
    const provider: ChannelProvider = { id: inbound.provider, deliver: async () => ({}) }
    ctx.channel.registerProvider(provider)
    expect(() => ctx.channel.registerProvider(provider)).toThrow(expect.objectContaining({
      code: 'CHANNEL_PROVIDER_DUPLICATE',
    }))
    await expect(ctx.channel.admit(inbound)).rejects.toMatchObject({ code: 'CHANNEL_CONSUMER_MISSING' })
    ctx.channel.registerConsumer({ admit: async () => ({ kind: 'accepted' }) })
    expect(() => ctx.channel.registerConsumer({ admit: async () => ({ kind: 'accepted' }) })).toThrow(
      expect.objectContaining({ code: 'CHANNEL_CONSUMER_DUPLICATE' }),
    )
  })

  it('removes provider and consumer registrations with their fibers', async () => {
    const ctx = await mount()
    const providerFiber = await ctx.plugin(Object.assign((child: Context) => {
      child.channel.registerProvider({ id: inbound.provider, deliver: async () => ({}) })
    }, { inject: ['channel'] }))
    const consumerFiber = await ctx.plugin(Object.assign((child: Context) => {
      child.channel.registerConsumer({ admit: async () => ({ kind: 'accepted' }) })
    }, { inject: ['channel'] }))
    await expect(ctx.channel.admit(inbound)).resolves.toEqual({ kind: 'accepted' })

    await consumerFiber.dispose()
    await expect(ctx.channel.admit(inbound)).rejects.toMatchObject({ code: 'CHANNEL_CONSUMER_MISSING' })
    await providerFiber.dispose()
    await expect(ctx.channel.admit(inbound)).rejects.toMatchObject({ code: 'CHANNEL_PROVIDER_MISSING' })
  })

  it('honors caller cancellation before crossing either registration', async () => {
    const ctx = await mount()
    const deliver = vi.fn(async () => ({}))
    const admit = vi.fn(async () => ({ kind: 'accepted' as const }))
    ctx.channel.registerProvider({ id: inbound.provider, deliver })
    ctx.channel.registerConsumer({ admit })
    const controller = new AbortController()
    controller.abort(new Error('closed'))

    await expect(ctx.channel.admit(inbound, controller.signal)).rejects.toThrow('closed')
    await expect(ctx.channel.deliver({
      provider: inbound.provider,
      conversationId: inbound.conversationId,
      text: 'late',
    }, controller.signal)).rejects.toThrow('closed')
    expect(admit).not.toHaveBeenCalled()
    expect(deliver).not.toHaveBeenCalled()
  })
})
