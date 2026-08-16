import { describe, expect, it } from 'vitest'
import {
  resolveConfig,
  type Config,
} from '@deepseek-ai/dsh-channel-agent/src/config.ts'

describe('channel Agent configuration', () => {
  it('pins the remote-safe preset and read-only permission even when Loader is bypassed', () => {
    const bypassed = {
      agentPreset: 'standard',
      permissionPreset: 'workspace-write',
    } as unknown as Config

    expect(resolveConfig(bypassed)).toMatchObject({
      agentPreset: 'telegram-safe',
      permissionPreset: 'read-only',
      deliveryRetryInitialMs: 1000,
      deliveryRetryMaxMs: 30_000,
    })
  })

  it('rejects retry timing whose first delay exceeds its retained cap', () => {
    expect(() => resolveConfig({
      deliveryRetryInitialMs: 10,
      deliveryRetryMaxMs: 5,
    })).toThrow(/deliveryRetryInitialMs must be less than or equal to deliveryRetryMaxMs/u)
  })
})
