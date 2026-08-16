/** Durable channel-origin and sidecar types. @module @deepseek-ai/dsh-channel-agent/types */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type {
  ChannelConversationId,
  ChannelExternalMessageId,
  ChannelProviderId,
  ChannelSenderId,
} from '@deepseek-ai/dsh-channel/brand'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Hash key for one provider/conversation/sender state row. */
export type ChannelAgentConversationKey = Branded<'ChannelAgentConversationKey'>

/** Hash key for one externally idempotent admission row. */
export type ChannelAgentAdmissionKey = Branded<'ChannelAgentAdmissionKey'>

/** Durable provenance written on every channel-origin model-visible message. */
export interface ChannelUserMessageSource {
  readonly kind: 'user'
  readonly channel: 'external'
  /** Non-secret provider registry id retained for source classification. */
  readonly provider: ChannelProviderId
  /** Provider-scoped opaque digest; never the provider's raw conversation id. */
  readonly conversationId: ChannelConversationId
  /** Provider-scoped opaque digest; never the provider's raw sender id. */
  readonly senderId: ChannelSenderId
  /** Identity-scoped opaque digest; never the provider's raw message id. */
  readonly externalMessageId: ChannelExternalMessageId
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'channel-user': ChannelUserMessageSource
  }
}

/** Session selection retained for one authenticated external identity. */
export interface ChannelAgentConversationRow {
  readonly provider: ChannelProviderId
  readonly conversationId: ChannelConversationId
  readonly senderId: ChannelSenderId
  readonly sessionIds: readonly SessionId[]
  readonly activeSessionId?: SessionId
}

/** Shared durable identity of an admitted external message. */
export interface ChannelAgentAdmissionIdentity {
  readonly provider: ChannelProviderId
  readonly conversationId: ChannelConversationId
  readonly senderId: ChannelSenderId
  readonly externalMessageId: ChannelExternalMessageId
  /** SHA-256 of the admitted text, detecting provider id reuse with different content. */
  readonly textDigest: string
  readonly admittedAt: number
}

/** Provider failures that make one durable result permanently unroutable. */
export type ChannelAgentDeliveryAbandonment =
  | 'CHANNEL_TELEGRAM_ROUTE_EXPIRED'
  | 'CHANNEL_TELEGRAM_TEXT_TOO_LONG'

/** Reserved admission whose idempotent operation has not committed yet. */
export interface ChannelAgentProcessingAdmission extends ChannelAgentAdmissionIdentity {
  readonly kind: 'processing'
}

/** Prompt durably admitted through one Agent inbox. */
export interface ChannelAgentPromptAdmission extends ChannelAgentAdmissionIdentity {
  readonly kind: 'prompt'
  readonly sessionId: SessionId
  readonly messageId: MessageId
  readonly turn?: number
  /** Stable safe response used when the persisted task cannot be resumed. */
  readonly failureText?: string
  readonly delivered: boolean
  /** Permanent provider failure recorded so restart recovery never retries this result. */
  readonly deliveryAbandoned?: ChannelAgentDeliveryAbandonment
}

/** Non-model command whose exact response is durable for retry. */
export interface ChannelAgentReplyAdmission extends ChannelAgentAdmissionIdentity {
  readonly kind: 'reply'
  readonly replyText: string
  readonly delivered: boolean
  /** Permanent provider failure recorded so restart recovery never retries this result. */
  readonly deliveryAbandoned?: ChannelAgentDeliveryAbandonment
}

/** Every persisted external admission state. */
export type ChannelAgentAdmissionRow =
  | ChannelAgentProcessingAdmission
  | ChannelAgentPromptAdmission
  | ChannelAgentReplyAdmission
