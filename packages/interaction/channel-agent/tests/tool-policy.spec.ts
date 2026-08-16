import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
import { applyRemoteChannelToolPolicy } from '@deepseek-ai/dsh-channel-agent/src/tool-policy.ts'

function tool(name: string, body: () => void): ToolDefinition {
  return {
    name,
    description: `test tool ${name}`,
    parameters: { type: 'object', properties: {} },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value as string }],
    },
    execute: async () => {
      body()
      return `ran:${name}`
    },
  }
}

async function execute(ctx: Context, agent: Agent, name: string) {
  return await ctx.tools.execute({
    signal: new AbortController().signal,
    callId: CallId(`call-${name}`),
    name,
    arguments: {},
    agent,
  })
}

describe('remote channel tool policy', () => {
  it('allows web_search and denies future Host or scoped capabilities at execution', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const agent = { id: SessionId('remote-safe-agent') } as Agent
    let scope!: Scope
    await ctx.plugin(Object.assign((inner: Context) => { scope = createScope(inner, agent) }, {
      inject: ['tools', 'systemPrompt'],
    }))
    const calls = { search: 0, media: 0, unknown: 0 }

    // Preset capabilities are inherited by an Agent scope in production; a
    // global registration is the smallest equivalent parent layer here.
    ctx.tools.register(tool('web_search', () => { calls.search += 1 }))
    applyRemoteChannelToolPolicy(scope.ctx)

    // These registrations happen after policy installation, matching a Host
    // plugin that is loaded or reloaded after the Telegram Agent already exists.
    ctx.tools.register(tool('generate_image', () => { calls.media += 1 }))
    scope.ctx.tools.register(tool('future_scoped_capability', () => { calls.unknown += 1 }))

    expect(ctx.tools.schemas(agent).map(schema => schema.name).sort())
      .toEqual(['future_scoped_capability', 'web_search'])

    const search = await execute(ctx, agent, 'web_search')
    expect(search).toMatchObject({ isError: false, value: 'ran:web_search' })

    for (const deniedName of ['generate_image', 'future_scoped_capability']) {
      const denied = await execute(ctx, agent, deniedName)
      expect(denied).toMatchObject({
        isError: true,
        content: [{ type: 'text', text: 'Error: Remote channel sessions cannot run this tool.' }],
      })
    }
    expect(calls).toEqual({ search: 1, media: 0, unknown: 0 })

    await scope.dispose()
    await ctx.fiber.dispose()
  })
})
