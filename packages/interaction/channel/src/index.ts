/**
 * Provider-neutral channel Service Definition: authenticated text admission and outbound delivery.
 * @module @deepseek-ai/dsh-channel
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type {
  ChannelAdmissionResult,
  ChannelConsumer,
  ChannelDeliveryReceipt,
  ChannelInboundMessage,
  ChannelOutboundMessage,
  ChannelProvider,
} from './types.ts'

export {
  ChannelConversationId,
  ChannelExternalMessageId,
  ChannelProviderId,
  ChannelSenderId,
} from './brand.ts'
export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    channel: ChannelService
  }
}

/** Machine-routable failure from provider registration, admission, or delivery. */
export class ChannelError extends Error {
  /** @param message - Human-readable failure. @param code - Stable channel error code. */
  constructor(message: string, readonly code: string) {
    super(message)
    this.name = 'ChannelError'
  }
}

const NEVER_ABORTED = new AbortController().signal

/** One-consumer, many-provider channel capability. */
export class ChannelService extends Service {
  private readonly providers = new Map<string, ChannelProvider>()
  private consumer: ChannelConsumer | undefined

  constructor(ctx: Context) {
    super(ctx, 'channel')
  }

  /**
   * Register one transport provider.
   * @param provider - Provider implementation keyed by its stable id.
   * @returns effect-owned disposer that removes this exact provider.
   */
  registerProvider(provider: ChannelProvider): () => void {
    if (this.providers.has(provider.id)) {
      throw new ChannelError(`channel provider "${provider.id}" is already registered`, 'CHANNEL_PROVIDER_DUPLICATE')
    }
    const dispose = this.ctx.effect(function* (this: ChannelService) {
      this.providers.set(provider.id, provider)
      yield () => { this.providers.delete(provider.id) }
    }.bind(this), 'channel.registerProvider()')
    return () => { void dispose() }
  }

  /**
   * Register the sole product consumer of admitted messages.
   * @param consumer - Consumer that owns application admission and idempotency.
   * @returns effect-owned disposer that removes this exact consumer.
   */
  registerConsumer(consumer: ChannelConsumer): () => void {
    if (this.consumer !== undefined) {
      throw new ChannelError('a channel consumer is already registered', 'CHANNEL_CONSUMER_DUPLICATE')
    }
    const dispose = this.ctx.effect(function* (this: ChannelService) {
      this.consumer = consumer
      yield () => {
        if (this.consumer === consumer) this.consumer = undefined
      }
    }.bind(this), 'channel.registerConsumer()')
    return () => { void dispose() }
  }

  /**
   * Admit one authenticated provider message to the product consumer.
   * @param message - Normalized text and complete external identity.
   * @param signal - Optional provider-operation cancellation.
   * @returns whether the message was newly accepted or already admitted.
   */
  async admit(message: ChannelInboundMessage, signal: AbortSignal = NEVER_ABORTED): Promise<ChannelAdmissionResult> {
    if (!this.providers.has(message.provider)) {
      throw new ChannelError(`channel provider "${message.provider}" is not registered`, 'CHANNEL_PROVIDER_MISSING')
    }
    if (this.consumer === undefined) {
      throw new ChannelError('no channel consumer is registered', 'CHANNEL_CONSUMER_MISSING')
    }
    signal.throwIfAborted()
    return await this.consumer.admit(message, signal)
  }

  /**
   * Deliver one outbound text through its matching provider.
   * @param message - Provider-qualified target and text.
   * @param signal - Optional caller cancellation.
   * @returns the provider receipt after delivery settles.
   */
  async deliver(message: ChannelOutboundMessage, signal: AbortSignal = NEVER_ABORTED): Promise<ChannelDeliveryReceipt> {
    const provider = this.providers.get(message.provider)
    if (provider === undefined) {
      throw new ChannelError(`channel provider "${message.provider}" is not registered`, 'CHANNEL_PROVIDER_MISSING')
    }
    signal.throwIfAborted()
    return await provider.deliver(message, signal)
  }
}

export default ChannelService
