/** Provider-neutral text admission and delivery types. @module @deepseek-ai/dsh-channel/types */

import type {
  ChannelConversationId,
  ChannelExternalMessageId,
  ChannelProviderId,
  ChannelSenderId,
} from './brand.ts'

/** One text message admitted by a registered channel provider. */
export interface ChannelInboundMessage {
  /** Provider that authenticated and normalized the message. */
  readonly provider: ChannelProviderId
  /** Provider-owned conversation containing the message. */
  readonly conversationId: ChannelConversationId
  /** Provider-owned identity that sent the message. */
  readonly senderId: ChannelSenderId
  /** Provider-owned id used for durable admission idempotency. */
  readonly externalMessageId: ChannelExternalMessageId
  /** Exact normalized UTF-8 text admitted by the provider. */
  readonly text: string
}

/** Text sent through one registered provider. */
export interface ChannelOutboundMessage {
  /** Provider that owns the target conversation. */
  readonly provider: ChannelProviderId
  /** Provider-owned target conversation. */
  readonly conversationId: ChannelConversationId
  /** Text to deliver. */
  readonly text: string
  /** Optional external message to reply to. */
  readonly replyTo?: ChannelExternalMessageId
}

/** Provider receipt for one settled outbound delivery. */
export interface ChannelDeliveryReceipt {
  /** Provider-owned id of the delivered message, when the provider returns one. */
  readonly externalMessageId?: ChannelExternalMessageId
}

/** Result of admitting one inbound message to the sole registered consumer. */
export type ChannelAdmissionResult =
  | { readonly kind: 'accepted' }
  | { readonly kind: 'duplicate' }

/** A transport provider registered with the channel service. */
export interface ChannelProvider {
  /** Stable provider registry id. */
  readonly id: ChannelProviderId
  /**
   * Deliver text to one conversation owned by this provider.
   * @param message - Provider-matched outbound text.
   * @param signal - Cancellation owned by the initiating operation or service teardown.
   * @returns the provider receipt after the remote send settles.
   */
  deliver(message: ChannelOutboundMessage, signal: AbortSignal): Promise<ChannelDeliveryReceipt>
}

/** The product consumer that turns admitted text into application behavior. */
export interface ChannelConsumer {
  /**
   * Admit one authenticated provider message.
   * @param message - Normalized inbound text and its complete external identity.
   * @param signal - Cancellation owned by the provider request or service teardown.
   * @returns whether this identity was newly accepted or already admitted.
   */
  admit(message: ChannelInboundMessage, signal: AbortSignal): Promise<ChannelAdmissionResult>
}
