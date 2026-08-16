/**
 * Provider-neutral identifiers owned by the channel capability.
 * @module @deepseek-ai/dsh-channel/brand
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Stable id of one registered channel provider. */
export type ChannelProviderId = Branded<'ChannelProviderId'>

/** Provider-owned conversation id, meaningful only with its provider id. */
export type ChannelConversationId = Branded<'ChannelConversationId'>

/** Provider-owned sender id, meaningful only with its provider id. */
export type ChannelSenderId = Branded<'ChannelSenderId'>

/** Provider-owned external message id, meaningful only within one conversation. */
export type ChannelExternalMessageId = Branded<'ChannelExternalMessageId'>

/**
 * Brand one provider id without changing its runtime value.
 * @param value - Provider id.
 * @returns The same string with its channel-provider brand.
 */
export function ChannelProviderId(value: string): ChannelProviderId {
  return value as ChannelProviderId
}

/**
 * Brand one provider-owned conversation id without changing its runtime value.
 * @param value - Conversation id.
 * @returns The same string with its channel-conversation brand.
 */
export function ChannelConversationId(value: string): ChannelConversationId {
  return value as ChannelConversationId
}

/**
 * Brand one provider-owned sender id without changing its runtime value.
 * @param value - Sender id.
 * @returns The same string with its channel-sender brand.
 */
export function ChannelSenderId(value: string): ChannelSenderId {
  return value as ChannelSenderId
}

/**
 * Brand one provider-owned external message id without changing its runtime value.
 * @param value - External message id.
 * @returns The same string with its external-message brand.
 */
export function ChannelExternalMessageId(value: string): ChannelExternalMessageId {
  return value as ChannelExternalMessageId
}
