/**
 * Durable storage-domain declaration for channel session selection and admission idempotency.
 * @module @deepseek-ai/dsh-channel-agent/spec
 */

import { z } from 'zod'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type {
  ChannelAgentAdmissionKey,
  ChannelAgentAdmissionRow,
  ChannelAgentConversationKey,
  ChannelAgentConversationRow,
} from './types.ts'

const brandedString = z.string().min(1)
const sessionId = brandedString.transform(value => value as SessionId)
const messageId = brandedString.transform(value => value as MessageId)
const identity = {
  provider: brandedString,
  conversationId: brandedString,
  senderId: brandedString,
}
const admissionIdentity = {
  ...identity,
  externalMessageId: brandedString,
  textDigest: z.string().regex(/^[0-9a-f]{64}$/u),
  admittedAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
}
const deliveryAbandoned = z.enum([
  'CHANNEL_TELEGRAM_ROUTE_EXPIRED',
  'CHANNEL_TELEGRAM_TEXT_TOO_LONG',
]).optional()

/** Validated persisted session selection. */
export const channelAgentConversationRowSchema = z.object({
  ...identity,
  sessionIds: z.array(sessionId),
  activeSessionId: sessionId.optional(),
}).superRefine((row, ctx) => {
  if (new Set(row.sessionIds).size !== row.sessionIds.length) {
    ctx.addIssue({ code: 'custom', path: ['sessionIds'], message: 'channel session ids must be unique' })
  }
  if (row.activeSessionId !== undefined && !row.sessionIds.includes(row.activeSessionId)) {
    ctx.addIssue({ code: 'custom', path: ['activeSessionId'], message: 'active channel session must be retained' })
  }
}) as unknown as z.ZodType<ChannelAgentConversationRow>

/** Validated persisted external admission. */
export const channelAgentAdmissionRowSchema = z.discriminatedUnion('kind', [
  z.object({ ...admissionIdentity, kind: z.literal('processing') }),
  z.object({
    ...admissionIdentity,
    kind: z.literal('prompt'),
    sessionId,
    messageId,
    turn: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
    failureText: z.string().min(1).optional(),
    delivered: z.boolean(),
    deliveryAbandoned,
  }),
  z.object({
    ...admissionIdentity,
    kind: z.literal('reply'),
    replyText: z.string(),
    delivered: z.boolean(),
    deliveryAbandoned,
  }),
]) as unknown as z.ZodType<ChannelAgentAdmissionRow>

/** Persistent sidecar owned by the channel Agent consumer. */
export const channelAgentDomainSpec = defineDomain({
  name: 'channel_agent',
  version: 0,
  tables: {
    conversations: domainTable<ChannelAgentConversationKey, ChannelAgentConversationRow>(channelAgentConversationRowSchema),
    admissions: domainTable<ChannelAgentAdmissionKey, ChannelAgentAdmissionRow>(channelAgentAdmissionRowSchema),
  },
})
