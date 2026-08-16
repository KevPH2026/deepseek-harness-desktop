# @deepseek-ai/dsh-client-ui-settings-channel-telegram

English | [中文](README.zh.md)

Local-desktop **Telegram Remote Control** Settings page for DeepSeek Harness Desktop. The browser plugin contributes `settings.section` id `remote-channels` at order `30`, but only when the active connection is loopback. Remote browser clients do not receive the page or its actions.

The page guides the user from BotFather through a fail-closed pairing flow:

1. Create a dedicated bot with [`@BotFather`](https://t.me/BotFather).
2. Save its Bot Token through the Host Credentials API. The password draft exists only inside the mounted React component; the controller stores only `configured` and `writable` metadata, never the token value.
3. Explicitly acknowledge the remote-trigger risk before enabling. The Host's `enable` Remote verifies the bot and starts ingress without changing an existing pairing.
4. Generate a short-lived, single-use Telegram deep link with `beginPairing`. Copy it when the Mac should hand the link to a phone; if Clipboard access fails, the page exposes the complete link for manual selection.
5. Open that link in a private chat. The inbound `/start <token>` request creates only a candidate; it does not authorize the sender.
6. Return to the desktop, verify the exact numeric Telegram user ID and private-chat ID, and call `confirmPairing` from the confirmation dialog.
7. Review or revoke the bound account, temporarily disable ingress without losing the binding, or remove the stored token from the same page. Messages sent while disabled never run automatically.
8. Save one optional HTTP(S) proxy URL (for example `http://127.0.0.1:7890`) when this computer cannot reach `api.telegram.org` directly. The `setProxy` Remote validates the URL host-shape, persists it in the channel state, and restarts a live poller; saving an empty value restores the direct connection. The field is not a secret — the safe status projection returns it as `proxyUrl`.

After enablement, the controller polls only the secret-free `channelTelegram.status` projection while the connection starts or recovers, then opens pairing automatically when the Host reports online. It continues polling a waiting pairing link until a candidate appears or the Host leaves the waiting state. A bound identity is keyed by the exact `userId` and `chatId`; names and usernames are display-only. The first-release remote-task allowlist contains only text-only reasoning and `web_search`. Telegram cannot access local files or invoke shell, PowerShell (`pwsh`), code execution, credentials, settings, approvals, media, subagents, or workflows.

When Telegram reports a backlog, the safe status projection carries only `pendingUpdateCount`; update bodies never enter renderer state. The page shows that count and a dedicated `backlog-pending` error instead of a generic enable or pairing failure. The activation barrier may fetch and inspect an update batch, but the client remains disabled and does not execute, acknowledge, advance the offset, or clear the pending updates. The user can wait up to 24 hours for Telegram to expire them automatically, or revoke the binding, remove the token, and save a token for a new dedicated bot.

Removing a Bot Token is ordered fail-closed: the controller first calls `revoke` to disable the channel and erase pending or bound pairing state, then calls `credentials.unset`. If revoke is uncertain, the token is left untouched and the UI reports a generic failure. Transport and Host error details are not rendered, so a provider cannot accidentally echo a submitted token into page state.

The page tells users to keep the bot in private chat, verify exact IDs, and keep the computer and desktop client online. Telegram Bot chats are not end-to-end encrypted, and Telegram processes their messages. A paired account can consume the configured model and search quota. Users are told never to send API keys, passwords, tokens, or other secrets through the bot.

## Model Experience

### Loopback Telegram settings

#### What the model sees

Nothing from this package. Token editing, risk acknowledgement, enablement, `channelTelegram.status` polling, pairing, confirmation, and revocation remain loopback UI and Host Remote operations; they add no Session message, prompt section, tool schema, or transport metadata to model context.

#### Token effect

Zero directly. These settings operations create no provider request; the page only warns that a later admitted task handled by the Channel consumer can spend configured model and search quota.

#### KV Cache effect

No provider request is created, so this package neither creates nor invalidates a reusable prefix. Cache behavior for a later admitted task belongs to its Channel consumer and Agent session.

## Known Limitations and Deferred Work

- The current Telegram Host provider authorizes one exact private-chat identity at a time. Re-pair after revoking to move access to another account.
- A one-time pairing capability exists only in memory and cannot be recovered after a page reload. Generate a new link if it is lost or expires.
- The computer and Host must stay online. This package does not add a hosted relay.
- Messages sent while the channel is disabled never run automatically. During activation the provider may fetch and inspect an update batch; if Telegram reports a backlog, the client stays disabled and does not execute, acknowledge, advance the offset, or clear it.
- Telegram may retain pending updates for up to 24 hours. The user can wait for automatic expiry, or revoke the binding, remove the token, and switch to a new dedicated bot.
- The Telegram remote-task allowlist contains only text-only reasoning and `web_search`; every listed local or high-risk capability remains blocked.
- Telegram cannot submit approval decisions. Any approval created by a desktop-originated task remains desktop-only.
- Telegram Bot chats are not end-to-end encrypted, and Telegram processes their messages.
