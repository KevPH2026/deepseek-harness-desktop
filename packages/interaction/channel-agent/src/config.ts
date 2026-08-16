/** Deployment policy for the channel Agent consumer. @module @deepseek-ai/dsh-channel-agent/src/config */

import z from '@deepseek-ai/schemastery'

const MAX_TIMER_DELAY_MS = 2_147_483_647

/** Local-only policy; channel messages cannot change any field. */
export interface Config {
  /** Existing workspace assigned to channel sessions; omitted selects the first registered workspace at admission time. */
  readonly workspaceId?: string
  /** Fixed remote-safe Agent preset. Other presets are rejected at configuration validation. */
  readonly agentPreset?: 'telegram-safe'
  /** Fixed read-only permission preset pinned before every channel prompt. */
  readonly permissionPreset?: 'read-only'
  /** Maximum UTF-8 bytes accepted in one model prompt. */
  readonly maxInputBytes?: number
  /** Maximum sessions retained by one provider/conversation/sender identity. */
  readonly maxSessionsPerConversation?: number
  /** Delay before retrying a temporarily unavailable outbound delivery. */
  readonly deliveryRetryInitialMs?: number
  /** Maximum retained interval for temporarily unavailable outbound deliveries. */
  readonly deliveryRetryMaxMs?: number
}

/** Loader schema for local channel Agent policy. */
export const Config: z<Config> = z.object({
  workspaceId: z.string(),
  agentPreset: z.const('telegram-safe').default('telegram-safe'),
  permissionPreset: z.const('read-only').default('read-only'),
  maxInputBytes: z.number().step(1).min(1).default(8192),
  maxSessionsPerConversation: z.number().step(1).min(1).default(20),
  deliveryRetryInitialMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).default(1000),
  deliveryRetryMaxMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).default(30_000),
})

/** Fully resolved policy used by the runtime. */
export interface ResolvedConfig {
  readonly workspaceId?: string
  readonly agentPreset: 'telegram-safe'
  readonly permissionPreset: 'read-only'
  readonly maxInputBytes: number
  readonly maxSessionsPerConversation: number
  readonly deliveryRetryInitialMs: number
  readonly deliveryRetryMaxMs: number
}

/**
 * Resolve local policy while pinning security-critical fields to their
 * fail-closed constants, including for direct callers that bypass Loader.
 * @param config - Loader-validated policy.
 * @returns A complete detached policy.
 */
export function resolveConfig(config: Config): ResolvedConfig {
  const deliveryRetryInitialMs = config.deliveryRetryInitialMs ?? 1000
  const deliveryRetryMaxMs = config.deliveryRetryMaxMs ?? 30_000
  if (deliveryRetryInitialMs > deliveryRetryMaxMs) {
    throw new Error('deliveryRetryInitialMs must be less than or equal to deliveryRetryMaxMs')
  }
  return {
    ...(config.workspaceId === undefined ? {} : { workspaceId: config.workspaceId }),
    agentPreset: 'telegram-safe',
    permissionPreset: 'read-only',
    maxInputBytes: config.maxInputBytes ?? 8192,
    maxSessionsPerConversation: config.maxSessionsPerConversation ?? 20,
    deliveryRetryInitialMs,
    deliveryRetryMaxMs,
  }
}
