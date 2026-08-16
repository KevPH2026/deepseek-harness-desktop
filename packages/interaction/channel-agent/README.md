# @deepseek-ai/dsh-channel-agent

English | [中文](README.zh.md)

This Consumer turns authenticated `@deepseek-ai/dsh-channel` text into durable Agent sessions. Plain text creates or continues the selected session; `/new`, `/sessions`, `/use`, `/status`, `/stop`, and `/help` execute locally. Unknown slash commands never reach the model.

Every model prompt enters the Agent inbox with a `kind: 'user'` source containing the provider plus stable, provider-scoped SHA-256 digests for `conversationId`, `senderId`, and `externalMessageId`; raw transport ids stay in the sidecar needed for routing and never enter the session log. The consumer flushes the inbox event before admission settles and stores an opaque admission key, so a repeated provider message does not create another prompt. After a crash between those two commits, restart recovery promotes a `processing` sidecar only when it finds the matching durable inbox source and reuses that original `MessageId`. Completion follows that prompt into its exact durable `turn/end`; an ordinary idle observation is never treated as completion.

## Configuration

- `workspaceId` optionally pins one registered workspace. When omitted, admission selects the first registered workspace; if none exists, the channel receives a safe setup prompt and the desktop keeps running.
- `agentPreset` is fixed to `telegram-safe`. The complete persona suppresses runtime context and every inherited prompt section; the preset composes only `web_search`, with fetch disabled. If no search provider is available, the Agent can still answer from the conversation without a tool.
- `permissionPreset` is fixed to `read-only`. Every prompt re-pins it before inbox admission, and channel commands cannot change it.
- `maxInputBytes` defaults to 8192 UTF-8 bytes.
- `maxSessionsPerConversation` defaults to 20.
- `deliveryRetryInitialMs` defaults to 1000 milliseconds; `deliveryRetryMaxMs` defaults to 30000 milliseconds. A temporarily unavailable or not-yet-registered provider is retried indefinitely at the capped interval.

One provider/conversation/sender identity may run one task at a time. `/stop` cancels that task with `keepInbox: false`; new prompts are rejected until it settles. Teardown stops admission, aborts completion observers and outbound deliveries, awaits every background operation, then disposes owned Agents and closes the storage domain.

The Consumer exposes no remote approval, permission, shell, settings, credential, media, subagent, workflow, or raw RPC operation. Each unpublished channel Agent receives a scoped inherited-tool allow-list and a monotonic pre-dispatch guard: only the exact `web_search` name may execute. A later Host registration such as image generation, a code runtime, or an unknown tool remains denied even if another plugin makes it visible. This guard is the authority boundary; the preset and prompt are defense in depth. A transport must authenticate the sender before calling `ctx.channel.admit()`.

Sessions stored with any older or different Agent preset are never resumed. An undelivered result from such a session is replaced by a stable safety notice, and the next prompt starts a fresh `telegram-safe` session without replaying the old messages or tool outputs. A Telegram route-expired or three-message-length failure is persisted as abandoned and is not retried after restart; other delivery failures retain their durable result until the provider recovers.

## Model Experience

### Remote channel turns

#### What the model sees

Accepted plain text and the optional task after `/new` enter the selected `telegram-safe` session exactly as trimmed and bounded. That preset supplies a complete remote-research persona and the `web_search` schema; local slash commands and transport identifiers do not reach the model.

#### Token effect

Each accepted task adds its data-dependent text and one ordinary Agent turn. Local commands spend no model request, and unavailable search does not prevent a direct text response.

#### KV Cache effect

Append-only while prompts continue the same safe session and its fixed preset is unchanged. `/new`, automatic migration away from an unsafe legacy preset, or a preset lifecycle change starts a different reusable prefix.

## Known Limitations and Deferred Work

- Outbound delivery cannot be exactly-once across a provider send succeeding immediately before the local delivered marker is persisted. The send plus marker is one outbox retry unit, so that crash window can duplicate a message; durable settlement still prevents the model prompt from running again.
- Media, local-file access, code execution, remote approval, permission changes, arbitrary session ids, and transcript export are intentionally unsupported.
