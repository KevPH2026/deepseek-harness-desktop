/** Closed command parser and user-facing help for the channel Agent consumer. */

/** Commands handled locally and never forwarded to a model. */
export type ChannelCommandName = 'new' | 'sessions' | 'use' | 'status' | 'stop' | 'help'

/** One parsed inbound text. */
export type ChannelInput =
  | { readonly kind: 'prompt'; readonly text: string }
  | { readonly kind: 'command'; readonly name: ChannelCommandName; readonly input: string }
  | { readonly kind: 'unknown-command'; readonly name: string }

const COMMANDS = new Set<ChannelCommandName>(['new', 'sessions', 'use', 'status', 'stop', 'help'])

/**
 * Parse a complete channel text without passing unknown slash commands onward.
 * @param text - Exact provider-normalized text.
 * @returns a prompt, supported local command, or rejected unknown command.
 */
export function parseChannelInput(text: string): ChannelInput {
  if (!text.startsWith('/')) return { kind: 'prompt', text }
  const match = /^\/([a-z]+)(?:[\t ]+([\s\S]*))?$/u.exec(text)
  if (match === null) return { kind: 'unknown-command', name: text.slice(1).split(/[\t \r\n]/u, 1)[0] ?? '' }
  const name = match[1] ?? ''
  if (!COMMANDS.has(name as ChannelCommandName)) return { kind: 'unknown-command', name }
  return { kind: 'command', name: name as ChannelCommandName, input: match[2] ?? '' }
}

/** Stable help text returned by `/help` and unknown commands. */
export const CHANNEL_HELP = [
  'Commands:',
  '/new [task] — start a new session',
  '/sessions — list sessions in this conversation',
  '/use <number> — select a listed session',
  '/status — show the selected task state',
  '/stop — stop the selected running task',
  '/help — show this help',
  '',
  'Send plain text to continue the selected session. Permissions can only be changed in the desktop app.',
].join('\n')
