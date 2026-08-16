import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as ChannelInvariant from '@deepseek-ai/dsh-channel/invariant'

describe('channel invariant companion', () => {
  it('registers its package ownership', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(ChannelInvariant)).resolves.toBeDefined()
  })
})
