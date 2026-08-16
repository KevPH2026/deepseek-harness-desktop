/** Exact durable prompt-to-turn settlement projection. */

import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { SessionEvent, TurnEndReason } from '@deepseek-ai/dsh-session/types'

/** Terminal facts belonging to the exact turn that admitted one prompt message. */
export interface ChannelPromptSettlement {
  readonly turn: number
  readonly reason: TurnEndReason
  readonly text?: string
}

/** Extract visible text blocks without exposing reasoning or tool payloads. */
function assistantText(event: SessionEvent): string | undefined {
  if (event.type !== 'assistant/message') return undefined
  const text = event.data.message.content
    .filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('')
    .trim()
  return text.length === 0 ? undefined : text
}

/**
 * Project the exact turn/end paired with a channel prompt's MessageId.
 * @param events - One session's ordered durable events.
 * @param messageId - Prompt identity returned by `createUserMessage`.
 * @returns terminal reason and final assistant text, or undefined until the turn ends.
 */
export function channelPromptSettlement(
  events: readonly SessionEvent[],
  messageId: MessageId,
): ChannelPromptSettlement | undefined {
  let openTurn: number | undefined
  let promptTurn: number | undefined
  let promptSeq: number | undefined
  for (const event of events) {
    if (event.type === 'turn/start') openTurn = event.data.turn
    if (event.type === 'user/message' && event.data.id === messageId) {
      promptTurn = openTurn
      promptSeq = event.seq
      break
    }
    if (event.type === 'turn/end') openTurn = undefined
  }
  if (promptTurn === undefined || promptSeq === undefined) return undefined

  let finalText: string | undefined
  for (const event of events) {
    if (event.seq <= promptSeq) continue
    if (event.type === 'assistant/message' && event.data.turn === promptTurn) {
      finalText = assistantText(event) ?? finalText
    }
    if (event.type === 'turn/end' && event.data.turn === promptTurn) {
      return {
        turn: promptTurn,
        reason: event.data.reason,
        ...(finalText === undefined ? {} : { text: finalText }),
      }
    }
  }
  return undefined
}

/**
 * Render one exact terminal prompt projection without exposing internal errors or tool payloads.
 * @param settlement - Exact terminal prompt projection.
 * @returns Safe outbound text.
 */
export function renderChannelPromptSettlement(settlement: ChannelPromptSettlement): string {
  const { reason, text } = settlement
  switch (reason.kind) {
    case 'completed': return text ?? 'Task completed.'
    case 'max-tokens': return text === undefined ? 'Task reached its output limit.' : `${text}\n\n[Output limit reached]`
    case 'blocked': return 'Task needs attention in the desktop app.'
    case 'error': return 'Task failed. Open the desktop app for details.'
    case 'interrupted': return 'Task stopped because the desktop process restarted.'
    case 'aborted': return reason.reason.kind === 'user' ? 'Task stopped.' : 'Task stopped in the desktop app.'
    default: return 'Task ended. Open the desktop app for details.'
  }
}
