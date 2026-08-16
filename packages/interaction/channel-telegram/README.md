# Telegram remote channel

English | [中文](README.zh.md)

`@deepseek-ai/dsh-channel-telegram` lets one explicitly paired Telegram private chat submit text to DeepSeek Harness through the provider-neutral `@deepseek-ai/dsh-channel` service. It is disabled by default.

## Setup

1. Create a bot with [BotFather](https://t.me/BotFather) and put its token in the Host credential named `TELEGRAM_BOT_TOKEN`. The token is never part of settings, durable channel state, logs, or Remote payloads.
2. In the desktop settings, choose **Begin pairing**. The Host checks `getMe` and `getWebhookInfo` before it exposes a ten-minute `t.me` link.
3. Open that link and send `/start <token>` from a Telegram private chat.
4. Verify the shown Telegram identity on the desktop and choose **Confirm**. Messages are rejected until this local confirmation succeeds.
5. **Disable** stops polling but keeps the pairing/bound account so it can be resumed after the Bot credential and webhook state are revalidated. **Revoke** disables polling and clears the pending pairing, bound account, remembered bot identity, and update offset. It does not delete the credential.
6. When this computer cannot reach `api.telegram.org` directly, the desktop settings accept one optional HTTP(S) proxy URL (for example `http://127.0.0.1:7890`) that routes only Bot API requests. The override is validated (no credentials, paths, queries, or fragments), stored in the durable state, projected in the safe status, and retained across **Revoke**; saving or clearing it restarts a live poller. An empty value restores the direct connection.

## Fail-closed behavior

- Only one exact `(userId, chatId)` pair in a `private` chat is admitted.
- A non-empty webhook URL blocks long polling. The provider never calls `deleteWebhook` and never guesses what caused a Bot API `409` conflict.
- The 128-bit base64url pairing capability is single-use, expires after ten minutes, and is stored only as a SHA-256 digest.
- `getUpdates` always sends `allowed_updates: ['message']`. Its offset advances only after the channel consumer settles admission (including durable duplicate acknowledgement) or after a deliberately ignored update is durably recorded.
- After admission and the offset are durable, the bot sends a best-effort “task received” acknowledgement. A failed acknowledgement never rolls back admission or causes the task to be enqueued again.
- The poller is single-instance and abortable. `429 retry_after` is honored; other recoverable errors use bounded backoff. `401`, changed credentials, changed bot identity, and active webhooks stop fail closed.
- Outbound plain text is split into Telegram-safe 4096-unit chunks without cutting UTF-16 surrogate pairs.

The storage domain is `channel_telegram`. It contains desired enablement, bot identity, exact bound identity, offset, and a pairing digest/candidate only; it contains no Bot API token, webhook URL, or credential fingerprint.

## Model Experience

### Authenticated Telegram text

#### What the model sees

Nothing directly from this provider. After desktop confirmation, it passes normalized private-chat text and opaque transport identity from `getUpdates` to the registered Channel consumer; Bot credentials, Telegram profile fields, pairing commands, and Bot API metadata do not become model context here.

#### Token effect

Zero directly. A registered consumer may conditionally add admitted text to its own model request; pairing, status checks, acknowledgements, and outbound replies do not spend model tokens in this package.

#### KV Cache effect

This provider creates no model request and does not alter an existing reusable prefix. The selected Channel consumer and Agent session own cache behavior for admitted text.

## Known Limitations and Deferred Work

- The provider accepts text from one exact paired private-chat identity. Group chats, media, edits, and reactions are not admitted.
- Long polling cannot run while the Bot has a webhook, and the provider never deletes that webhook automatically.
- The Host and network must remain available for polling and delivery. During activation the provider may fetch and inspect an update batch, but a reported backlog keeps the channel disabled and does not execute, acknowledge, advance the offset, or clear those updates.
