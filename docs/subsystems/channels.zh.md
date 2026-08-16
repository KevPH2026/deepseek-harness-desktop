# 远程文字通道

[English](channels.md) | 中文

Channel 子系统允许经过身份验证的文本传输在不暴露 Harness Web API 的情况下提交范围受限的任务。提供方无关的 [`@deepseek-ai/dsh-channel`](../../packages/interaction/channel) 服务负责传输注册与投递；[`@deepseek-ai/dsh-channel-agent`](../../packages/interaction/channel-agent) 消费方负责 Agent 任务的持久化接入、会话选择、权限固定、幂等和精确到轮次的结果投影。[`@deepseek-ai/dsh-channel-telegram`](../../packages/interaction/channel-telegram) 等具体传输提供方必须在接入前验证各自的外部身份。

## 信任边界

- 传输提供方注册自身，并在调用 `ctx.channel.admit` 前验证完整的外部会话、发送者和消息身份。
- 只有一个消费方能把已接入文本转化为产品行为。提供方无法使用 Agent、会话、设置、凭据、Shell 或文件系统 API。
- 模型可见的通道提示词会在提供方确认外部更新前持久写入日志。稳定的不透明哈希会保留来源信息，同时避免把原始 Telegram 账号 ID 写入会话日志。
- 本地策略选定工作区、Agent 预设、模型和权限。Telegram 文本与命令不能更改这些选项，也不能批准危险操作。
- 桌面组合把通道会话固定到完整的 `telegram-safe` persona。它屏蔽运行时上下文和继承的提示词区段，只开放 `web_search`，并安装单调执行守卫，拒绝本地文件、Shell、代码、凭据、设置、媒体、subagent、工作流、审批以及后续注册的 Host 工具。
- 出站投递只包含 assistant 最终文本或稳定的安全状态，不会转发推理、工具参数、内部错误或原始 Host 事件。

## Telegram 提供方

Telegram 提供方会为每次 Bot API 操作解析 `TELEGRAM_BOT_TOKEN`，并使用出站 `getUpdates` 长轮询；检测到 Bot 已配置 webhook 时，它会以拒绝启动的方式关闭失败。配对使用有效期十分钟且只能使用一次的能力，原始值只会返回给回环地址设置页，存储层仅保存其 SHA-256 哈希。私聊中的 `/start` 会创建候选身份；只有在桌面端完成第二次确认后，准确的用户数字 ID 和聊天数字 ID 才会获得授权。

只有在 Agent 消费方提交幂等状态并刷写提示词后，提供方才会推进持久化更新偏移量。进程重启后可以从仍处于 processing 状态的伴随记录行恢复原始入站消息，而不会再次执行同一条手机指令。Bot 回复使用纯文本，并会在 Telegram 的长度限制内分段，同时避免切断 UTF-16 代理对。每次确认绑定都会获得新的不透明路由 epoch，因此更换 Bot 或重新配对不会与旧会话冲突，也不会收到旧绑定尚未投递的结果。明确执行停用操作后，系统会停止并等待出站投递完全结束，停用期间收到的消息不会进入 Agent。如果 Telegram 在启用校验时报告积压，提供方会保持停用，不接纳、不确认也不清空这些更新。用户必须等待 Telegram 在最长 24 小时的保留期内让它们过期，或撤销绑定、移除凭据，再绑定一个新的专用 Bot。

Agent 消费方会把已完成的最终文本写入持久待发队列。提供方暂时不可用时，系统会按指数退避持续重试，直至投递成功，且不会重跑模型回合。Bot 路由 epoch 已变化，或回复需要超过三个 Telegram 分段时，会成为永久投递失败。投递采用至少一次语义：如果 Telegram 已接受 `sendMessage`，而进程在保存持久已投递标记前失败，恢复后可能重复发送该分段。

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
