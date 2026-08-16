/** Fail-closed model-tool policy for remote channel Agents. @module @deepseek-ai/dsh-channel-agent/src/tool-policy */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-tools'

/** The only model-facing capability remote channel Agents may execute. */
const REMOTE_SAFE_TOOL = 'web_search'

/** Stable denial text that never reflects tool names or arguments. */
const REMOTE_TOOL_DENIAL = 'Remote channel sessions cannot run this tool.'

/**
 * Hide every inherited Host tool except the preset's search capability and
 * install a monotonic execution guard in one unpublished Agent scope. The
 * guard is the authority boundary and rejects every scoped or future
 * capability except `web_search`.
 * @param agentCtx - Unpublished Agent scope receiving the channel preset.
 */
export function applyRemoteChannelToolPolicy(agentCtx: Context): void {
  agentCtx.tools.restrict({ allow: [REMOTE_SAFE_TOOL] })
  agentCtx.tools.guard(execution => execution.name === REMOTE_SAFE_TOOL
    ? undefined
    : REMOTE_TOOL_DENIAL)
}
