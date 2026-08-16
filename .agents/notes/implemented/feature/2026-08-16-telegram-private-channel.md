# Agent Note: Telegram private-channel remote work

Status: implemented

English | [中文](2026-08-16-telegram-private-channel.zh.md)

## Problem

Desktop users want to hand work to Harness from a phone while the Mac continues running in the tray. Reusing the loopback Web API, listening on a LAN address, or accepting the first Telegram sender would turn an unauthenticated local carrier into a remote execution surface. The feature therefore needs an authenticated transport, durable task admission, exact sender ownership, explicit desktop pairing, and a permission boundary that a Telegram message cannot change.

## Decision

**A provider-neutral Channel capability owns transport admission and delivery.** `@deepseek-ai/dsh-channel` registers many authenticated providers and exactly one product consumer. It exposes normalized text admission and provider-qualified delivery, not Host RPC, settings, credentials, shell, filesystem, or a public HTTP route.

**The Agent consumer owns durable work semantics.** `@deepseek-ai/dsh-channel-agent` maps one provider, conversation, and sender identity to locally selected Agent sessions. It records every model-visible Telegram prompt with durable channel provenance, flushes the session before returning admission, deduplicates the complete external-message identity, and observes the exact prompt turn before returning only final assistant text. `/new`, `/sessions`, `/use`, `/status`, `/stop`, and `/help` are handled locally and unknown slash commands never reach the model.

**Every prompt uses a remote-safe Agent capability set.** The desktop composition fixes channel sessions to `telegram-safe`: a complete persona with runtime context disabled and only `web_search` composed. Agent creation and resume install both a scoped inherited-tool allow-list and a monotonic execution guard, so local files, Shell, code, credentials, settings, media, subagents, workflows, approvals, and later Host tools remain unavailable. Every prompt also re-applies `read-only` before inbox admission. Telegram cannot select a workspace, model, preset, session ID, or permission.

**Telegram is an outbound-only provider with two-step pairing.** `@deepseek-ai/dsh-channel-telegram` uses `getUpdates` long polling and never starts a listener. A ten-minute, single-use, 128-bit capability is returned only through the loopback-only pairing Remote; only its hash is durable. Opening the deep link in a private Bot chat creates a candidate, and the candidate becomes authorized only after the desktop confirms the exact numeric user and private-chat IDs. Display names and usernames are never authorization inputs.

**Credential and replay boundaries fail closed.** The Bot token is resolved from `TELEGRAM_BOT_TOKEN` for each Bot API operation and never appears in settings, channel state, session messages, Remote projections, or logs. An active webhook, missing or rotated credential, changed Bot identity, non-private sender, or unmatched account is rejected. The next Telegram offset moves only after durable Agent admission; provider update IDs and Agent admissions are both idempotent across retries and restarts.

**Binding generations prevent cross-Bot replay.** Each desktop-confirmed account receives a fresh opaque routing epoch. Channel conversation and admission identities use that epoch, while only the provider retains the real Telegram chat id needed for delivery. Revoke and re-pair therefore create a new route even when two Bots observe the same user, chat, and message numbers. Disable, revoke, credential rotation, and teardown abort and join the active outbound generation. Messages received while disabled are not admitted. If Telegram reports a backlog during enable validation, the provider stays disabled without reading, acknowledging, or clearing those updates; the user waits for Telegram's retention window of up to 24 hours, or revokes the binding, removes the credential, and pairs a new dedicated Bot.

**A durable outbox separates task completion from transport recovery.** The Agent consumer stores completed final text before delivery. `CHANNEL_TELEGRAM_UNAVAILABLE` retries with exponential backoff until the provider recovers and never reruns the model turn. `CHANNEL_TELEGRAM_ROUTE_EXPIRED`, including a Bot change, and `CHANNEL_TELEGRAM_TEXT_TOO_LONG`, including a reply that requires more than three chunks, are terminal and stop retrying. Delivery is at least once: if Telegram accepts a chunk but the process fails before saving the durable delivered marker, recovery can repeat that chunk.

## Alternatives considered

**Expose the existing `/api` or listen on `0.0.0.0`.** Rejected because the Web carrier's loopback and origin checks are not remote authentication, and the generic Host surface is much broader than phone task control.

**Reuse Telegram usernames or trust the first sender.** Rejected because usernames are optional and mutable. A deep-link proof followed by desktop confirmation of exact numeric identities gives the user an explicit trust decision.

**Use a webhook for the first desktop release.** Rejected because it requires a publicly reachable authenticated endpoint and conflicts with `getUpdates`. The desktop uses outbound long polling and fails closed when the Bot already has a webhook.

**Expose coding tools under a `read-only` sandbox.** Rejected because the current read-only sandbox still permits filesystem reads, including same-user credential files. The first release uses `telegram-safe` plus an execution guard; remote local-file and Shell work requires a future isolation boundary designed for that purpose.

**Forward arbitrary slash commands into Harness.** Rejected because existing commands include capability-changing operations. The channel exposes a small closed command set and treats unknown commands as errors.

**Run multiple tasks concurrently for one paired identity.** Rejected for the initial implementation because status, stop ownership, crash recovery, and message ordering are clearer when one identity has one running task. A second task is refused until the first settles or is stopped.

**Advance past the Telegram backlog on re-enable.** Rejected because confirming queued phone commands without executing them hides data loss from the user. The provider remains disabled and leaves the updates untouched until Telegram expires them or the user replaces the binding and Bot.

## Consequences

A user can create a dedicated Bot, save its token locally, generate a one-time link, approve the candidate on the desktop, and then start or continue Agent sessions from the bound private chat. Closing the main window keeps polling alive through the tray; explicit Quit, sleep, network loss, or stopping the Mac makes the channel unavailable. A disabled channel never consumes queued updates. If Telegram reports a backlog on enable, it remains disabled until Telegram expires those updates within its retention window of up to 24 hours, or the user revokes the binding, removes the token, and pairs a new dedicated Bot.

This is a text-only private-chat beta for reasoning, writing, and public-web research. Local-file work, code execution, media generation, groups, attachments, remote approval, arbitrary session IDs, and public relay access remain out of scope. Telegram Bot chats are not end-to-end encrypted; users must not send secrets. The existing local credential provider uses owner-only files rather than an OS Keychain boundary, so same-user native processes remain inside the trust boundary. Real-phone acceptance still requires a user-owned test Bot; automated coverage uses a fake Bot API to prove pairing, binding-generation isolation, private-ID authorization, webhook refusal, offset durability, retry behavior, secret-safe failures, crash recovery, and exact result delivery.
