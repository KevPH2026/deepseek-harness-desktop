/** Durable, secret-free Telegram provider state. */

import { z } from 'zod'
import { defineDomain } from '@deepseek-ai/dsh-storage-domain'
import { normalizeTelegramProxyUrl } from './proxy.ts'
import type {
  TelegramBotIdentity,
  TelegramBoundAccount,
  TelegramPairingCandidate,
} from './types.ts'

const safeTime = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const decimalId = z.string().regex(/^[0-9]+$/u)
const opaqueEpoch = z.string().regex(/^[A-Za-z0-9_-]{22}$/u)

/** Durable-boundary schema for the authenticated bot identity. */
export const telegramBotIdentitySchema = z.object({
  id: decimalId,
  username: z.string().min(1),
  firstName: z.string().min(1),
}) satisfies z.ZodType<TelegramBotIdentity>

/** Durable-boundary schema for the exact confirmed Telegram private chat. */
export const telegramBoundAccountSchema = z.object({
  userId: decimalId,
  chatId: decimalId,
  firstName: z.string().min(1),
  lastName: z.string().min(1).optional(),
  username: z.string().min(1).optional(),
  confirmedAt: safeTime,
}) satisfies z.ZodType<TelegramBoundAccount>

/** Internal binding record. Legacy records omit the route until service initialization migrates them. */
export interface TelegramDurableBinding extends TelegramBoundAccount {
  readonly routingEpoch?: string | undefined
}

const telegramDurableBindingSchema = telegramBoundAccountSchema.extend({
  routingEpoch: opaqueEpoch.optional(),
}) satisfies z.ZodType<TelegramDurableBinding>

/** One disabled interval whose queued updates must be denied before polling resumes. */
export interface TelegramDisabledBacklog {
  readonly generation: string
  readonly cutoffOffset: number
}

const telegramDisabledBacklogSchema = z.object({
  generation: opaqueEpoch,
  cutoffOffset: safeTime,
}) satisfies z.ZodType<TelegramDisabledBacklog>

/** Durable timestamp barrier separating disabled-period tasks from a committed activation. */
export interface TelegramActivationBarrier {
  readonly generation: string
  readonly messageDateCutoff: number
}

const telegramActivationBarrierSchema = z.object({
  generation: opaqueEpoch,
  messageDateCutoff: safeTime,
}) satisfies z.ZodType<TelegramActivationBarrier>

/** Durable-boundary schema for one unconfirmed, expiring pairing candidate. */
export const telegramPairingCandidateSchema = z.object({
  candidateId: z.uuid(),
  userId: decimalId,
  chatId: decimalId,
  firstName: z.string().min(1),
  lastName: z.string().min(1).optional(),
  username: z.string().min(1).optional(),
  receivedAt: safeTime,
  expiresAt: safeTime,
}).refine(candidate => candidate.expiresAt > candidate.receivedAt, {
  path: ['expiresAt'],
  message: 'pairing candidate must expire after receipt',
}) satisfies z.ZodType<TelegramPairingCandidate>

/** Hash-only durable pairing state; the raw one-time capability is never stored. */
export type TelegramDurablePairing =
  | {
    readonly kind: 'waiting'
    readonly tokenHash: string
    readonly issuedAt: number
    readonly expiresAt: number
  }
  | {
    readonly kind: 'candidate'
    readonly candidate: TelegramPairingCandidate
  }

const durablePairingSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('waiting'),
    tokenHash: z.string().regex(/^[0-9a-f]{64}$/u),
    issuedAt: safeTime,
    expiresAt: safeTime,
  }).refine(pairing => pairing.expiresAt > pairing.issuedAt, {
    path: ['expiresAt'],
    message: 'pairing capability must expire after issue',
  }),
  z.object({
    kind: z.literal('candidate'),
    candidate: telegramPairingCandidateSchema,
  }),
]) satisfies z.ZodType<TelegramDurablePairing>

/** Whole provider state written atomically after each admitted Telegram update. */
export interface TelegramDurableState {
  readonly enabled: boolean
  readonly bot?: TelegramBotIdentity | undefined
  readonly nextUpdateOffset?: number | undefined
  readonly pairing?: TelegramDurablePairing | undefined
  readonly binding?: TelegramDurableBinding | undefined
  readonly disabledBacklog?: TelegramDisabledBacklog | undefined
  readonly activationBarrier?: TelegramActivationBarrier | undefined
  /** Optional Bot API proxy override retained across revoke; absent means direct connection. */
  readonly proxyUrl?: string | undefined
}

/** Durable-boundary schema for the complete secret-free provider state. */
export const telegramDurableStateSchema = z.object({
  enabled: z.boolean(),
  bot: telegramBotIdentitySchema.optional(),
  nextUpdateOffset: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  pairing: durablePairingSchema.optional(),
  binding: telegramDurableBindingSchema.optional(),
  disabledBacklog: telegramDisabledBacklogSchema.optional(),
  activationBarrier: telegramActivationBarrierSchema.optional(),
  proxyUrl: z.string().max(200)
    .refine(value => normalizeTelegramProxyUrl(value) === value, {
      message: 'proxyUrl must be a normalized host-addressed http(s) URL',
    })
    .optional(),
}).superRefine((state, ctx) => {
  if (state.pairing !== undefined && state.binding !== undefined) {
    ctx.addIssue({ code: 'custom', path: ['pairing'], message: 'pairing and binding are mutually exclusive' })
  }
  if ((state.pairing !== undefined || state.binding !== undefined) && state.bot === undefined) {
    ctx.addIssue({ code: 'custom', path: ['bot'], message: 'pairing and binding require a bot identity' })
  }
  if (state.enabled && state.disabledBacklog !== undefined) {
    ctx.addIssue({ code: 'custom', path: ['disabledBacklog'], message: 'enabled state cannot retain a disabled backlog' })
  }
  if (!state.enabled && state.activationBarrier !== undefined) {
    ctx.addIssue({ code: 'custom', path: ['activationBarrier'], message: 'disabled state cannot retain an activation barrier' })
  }
}) as z.ZodType<TelegramDurableState>

const INITIAL_TELEGRAM_STATE: TelegramDurableState = Object.freeze({ enabled: false })

/** One secret-free global record; disabled state may retain pairing/binding for an explicit resume. */
export const telegramChannelDomainSpec = defineDomain({
  name: 'channel_telegram',
  version: 0,
  global: {
    schema: telegramDurableStateSchema,
    initial: INITIAL_TELEGRAM_STATE,
  },
  tables: {},
})
