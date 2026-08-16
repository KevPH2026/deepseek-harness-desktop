import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as UserProfileInvariant from '../src/invariant.ts'

describe('user-profile invariant companion', () => {
  it('registers its settings-and-context relation', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(UserProfileInvariant).await()).resolves.toBeDefined()
    await ctx.fiber.dispose()
  })
})
