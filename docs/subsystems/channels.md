# Remote Text Channels

English | [中文](channels.zh.md)

The Channel subsystem lets an authenticated text transport submit bounded work without exposing the Harness Web API. The provider-neutral [`@deepseek-ai/dsh-channel`](../../packages/interaction/channel) service owns transport registration and delivery. The [`@deepseek-ai/dsh-channel-agent`](../../packages/interaction/channel-agent) consumer owns durable Agent admission, session selection, permission pinning, idempotency, and exact-turn result projection. Concrete transports such as [`@deepseek-ai/dsh-channel-telegram`](../../packages/interaction/channel-telegram) authenticate their own external identities before admission.

## Trust boundary

- A transport registers a provider and authenticates the complete external conversation, sender, and message identity before calling `ctx.channel.admit`.
- Exactly one consumer turns admitted text into product behavior. Providers do not receive Agent, Session, settings, credential, shell, or filesystem APIs.
- Model-visible channel prompts are durably logged before a provider confirms the external update. Stable opaque hashes preserve provenance without writing raw Telegram account IDs into the Session log.
- Local policy selects the workspace, Agent preset, model, and permission. Telegram text and commands cannot change them or approve a dangerous action.
- The desktop composition fixes channel sessions to the complete `telegram-safe` persona. It suppresses runtime context and inherited prompt sections, exposes only `web_search`, and installs a monotonic execution guard that denies local files, Shell, code, credentials, settings, media, subagents, workflows, approvals, and future Host tools.
- Outbound delivery contains final assistant text or stable safe status. It does not forward reasoning, tool arguments, internal errors, or raw Host events.

## Telegram provider

The Telegram provider resolves `TELEGRAM_BOT_TOKEN` for every Bot API operation, uses outbound `getUpdates` long polling, and fails closed when the Bot already has a webhook. Pairing uses a ten-minute, single-use capability whose raw value is returned only to the loopback settings page; only its SHA-256 hash is stored. A private-chat `/start` creates a candidate, and the exact numeric user and chat IDs become authorized only after a second confirmation on the desktop.

The provider advances its durable update offset only after the Agent consumer has committed idempotency state and flushed the prompt. A process restart can recover the original inbox message from a still-processing sidecar row without executing the same phone instruction again. Bot replies are plain text and are split within Telegram's length limit without cutting UTF-16 surrogate pairs. Every confirmed binding receives a new opaque routing epoch, so changing Bots or pairing again cannot collide with an old conversation or receive an old pending result. Explicit Disable stops and joins outbound delivery, and messages received while disabled never reach the Agent. If Telegram reports a backlog during enable validation, the provider remains disabled without admitting, acknowledging, or clearing those updates. The user must wait for Telegram's retention window of up to 24 hours to expire them, or revoke the binding, remove the credential, and pair a new dedicated Bot.

The Agent consumer persists completed final text in a durable outbox. Transient provider unavailability retries with exponential backoff until delivery succeeds without running the model turn again. A changed Bot routing epoch and a reply requiring more than three Telegram chunks are terminal delivery failures. Delivery is at least once: if Telegram accepts `sendMessage` but the process fails before the durable delivered marker is saved, recovery can repeat that chunk.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxchannel--channelservice"></a>

### `ctx.channel` — `ChannelService`

One-consumer, many-provider channel capability.

```ts cordis-catalog
/**
 * Register one transport provider.
 * @param provider - Provider implementation keyed by its stable id.
 * @returns effect-owned disposer that removes this exact provider.
 */
registerProvider(provider: ChannelProvider): () => void

/**
 * Register the sole product consumer of admitted messages.
 * @param consumer - Consumer that owns application admission and idempotency.
 * @returns effect-owned disposer that removes this exact consumer.
 */
registerConsumer(consumer: ChannelConsumer): () => void

/**
 * Admit one authenticated provider message to the product consumer.
 * @param message - Normalized text and complete external identity.
 * @param signal - Optional provider-operation cancellation.
 * @returns whether the message was newly accepted or already admitted.
 */
async admit(message: ChannelInboundMessage, signal: AbortSignal = NEVER_ABORTED): Promise<ChannelAdmissionResult>

/**
 * Deliver one outbound text through its matching provider.
 * @param message - Provider-qualified target and text.
 * @param signal - Optional caller cancellation.
 * @returns the provider receipt after delivery settles.
 */
async deliver(message: ChannelOutboundMessage, signal: AbortSignal = NEVER_ABORTED): Promise<ChannelDeliveryReceipt>
```

Source: [`packages/interaction/channel/src/index.ts:42`](../../packages/interaction/channel/src/index.ts)

<a id="ctxchanneltelegram--telegramchannelservice"></a>

### `ctx.channelTelegram` — `TelegramChannelService`

Telegram provider. Pairing Remotes change only local pairing state; they never submit tasks.

```ts cordis-catalog
/**
 * Read the current safe configuration and runtime projection.
 * @returns Secret-free status for the loopback settings UI.
 */
@Remote async status(): Promise<TelegramChannelStatus>

/**
 * Enable polling and issue one new 128-bit, ten-minute, single-use pairing capability.
 * @returns Capability once issued, or a stable fail-closed error and safe status.
 */
@Remote beginPairing(): Promise<TelegramBeginPairingResult>

/**
 * Bind exactly the pending candidate after a local desktop confirmation.
 * @param request - Candidate id displayed and confirmed by the desktop user.
 * @returns Updated safe status or a stable candidate-validation failure.
 */
@Remote confirmPairing(request: TelegramConfirmPairingRequest): Promise<TelegramConfirmPairingResult>

/**
 * Validate the configured bot and resume polling without changing pairing or binding.
 * @returns Updated safe status or a stable connection-validation failure.
 */
@Remote enable(): Promise<TelegramEnableResult>

/**
 * Stop polling while retaining pending pairing and the confirmed account.
 * @returns Disabled safe status after the poller has stopped.
 */
@Remote disable(): Promise<TelegramChannelStatus>

/**
 * Disable the provider and remove every bot-specific durable identity and offset.
 * @returns Revoked safe status after the poller has stopped.
 */
@Remote revoke(): Promise<TelegramChannelStatus>
```

Source: [`packages/interaction/channel-telegram/src/index.ts:252`](../../packages/interaction/channel-telegram/src/index.ts)
<!-- END GENERATED cordis-surface -->
