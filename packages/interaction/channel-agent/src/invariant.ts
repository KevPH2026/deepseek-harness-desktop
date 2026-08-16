/** Package-owned durable provenance invariant for `@deepseek-ai/dsh-channel-agent`. */

import type { Context } from '@deepseek-ai/cordis'
import type { MessageId, MessageSource } from '@deepseek-ai/dsh-llm'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { ChannelUserMessageSource } from './types.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-channel-agent'

/** Cordis companion plugin name. */
export const name = 'channel-agent-invariant'
/** Services required to inspect loaded and newly appended Session logs. */
export const inject = ['invariants']

function channelSource(source: MessageSource): ChannelUserMessageSource | undefined {
  return source.kind === 'user' && 'channel' in source ? source : undefined
}

function externalIdentity(source: ChannelUserMessageSource): string {
  return JSON.stringify([
    source.provider,
    source.conversationId,
    source.senderId,
    source.externalMessageId,
  ])
}

/** Install one whole-process check over channel inbox admission and model-visible use. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  const inserted = new WeakMap<Session, Set<MessageId>>()
  const visibleExternalIds = new Map<string, MessageId>()

  const validateEvent = (session: Session, event: SessionEvent): void => {
    if (event.type === 'agent/inbox/spliced') {
      const ids = inserted.get(session) ?? new Set<MessageId>()
      for (const message of event.data.inserted) {
        if (channelSource(message.source) !== undefined) ids.add(message.id)
      }
      inserted.set(session, ids)
      return
    }
    if (event.type !== 'user/message') return
    const source = channelSource(event.data.source)
    if (source === undefined) return
    const admittedIds = inserted.get(session) ?? new Set<MessageId>()
    if (!admittedIds.has(event.data.id)) {
      for (const prior of session.events) {
        if (prior.seq >= event.seq) break
        if (prior.type !== 'agent/inbox/spliced') continue
        for (const message of prior.data.inserted) {
          if (channelSource(message.source) !== undefined) admittedIds.add(message.id)
        }
      }
      inserted.set(session, admittedIds)
    }
    if (!admittedIds.has(event.data.id)) {
      fail(`channel user/message ${JSON.stringify(event.data.id)} has no prior Agent inbox admission`)
    }
    const identity = externalIdentity(source)
    const prior = visibleExternalIds.get(identity)
    if (prior !== undefined) {
      fail(`channel external message identity repeats for ${JSON.stringify(prior)} and ${JSON.stringify(event.data.id)}`)
    }
    visibleExternalIds.set(identity, event.data.id)
  }

  for (const session of ctx.sessions.list()) {
    for (const event of session.events) validateEvent(session, event)
  }
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [session, event] = args as [Session, SessionEvent]
    validateEvent(session, event)
  }, { global: true })
}, { inject: ['sessions'] })

/** @param ctx - Context carrying the invariant registry. @returns the package registration disposer. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
