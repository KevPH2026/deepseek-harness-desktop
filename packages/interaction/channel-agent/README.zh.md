# @deepseek-ai/dsh-channel-agent

[English](README.md) | 中文

这个 Consumer 会把已认证的 `@deepseek-ai/dsh-channel` 文本转成持久 Agent 会话。普通文本会新建或继续当前会话；`/new`、`/sessions`、`/use`、`/status`、`/stop` 与 `/help` 在本地执行。未知斜杠命令不会进入模型。

每条模型提示都会先进入 Agent inbox。`kind: 'user'` 的 source 保存供应商，以及按供应商作用域稳定计算的 `conversationId`、`senderId` 与 `externalMessageId` SHA-256 摘要；传输层原始 id 只保留在回传所需的 sidecar 中，绝不进入会话日志。消费者在接纳完成前 flush inbox 事件，并写入不透明接纳键，因此供应商重发同一消息时不会再次创建提示。如果进程恰好在这两次提交之间退出，重启恢复只会在找到身份匹配的持久 inbox source 后提升 `processing` sidecar，并复用原始 `MessageId`。完成回传会从该提示追踪到准确的持久 `turn/end`；普通 idle 状态不会被当成完成。

## 配置

- `workspaceId` 可固定一个已注册工作区。省略时，每次接纳会选择第一个已注册工作区；没有工作区时，渠道会收到安全设置提示，桌面仍可正常启动。
- `agentPreset` 固定为 `telegram-safe`。完整 persona 会屏蔽运行时上下文和其他继承提示；预设只装配 `web_search`，并关闭网页抓取。没有可用搜索供应商时，Agent 仍可直接根据对话回答。
- `permissionPreset` 固定为 `read-only`。每条提示进入 inbox 前都会重新固定该权限，渠道命令不能修改。
- `maxInputBytes` 默认允许 8192 个 UTF-8 字节。
- `maxSessionsPerConversation` 默认最多保留 20 个会话。
- `deliveryRetryInitialMs` 默认 1000 毫秒，`deliveryRetryMaxMs` 默认 30000 毫秒。供应商暂时不可用或尚未注册时，会在达到封顶间隔后持续重试。

同一供应商、会话与发送者身份一次只允许运行一个任务。`/stop` 会使用 `keepInbox: false` 取消任务；任务结算前，新提示会被拒绝。关闭时会先停止接纳，取消完成观察与出站投递，等待全部后台操作结束，再释放本包创建的 Agent 并关闭 storage domain。

这个 Consumer 不提供远程审批、权限、Shell、设置、凭证、媒体、子代理、工作流或原始 RPC 操作。每个尚未发布的渠道 Agent 都会安装作用域内的继承工具白名单和单调执行 Guard：只有名称完全匹配的 `web_search` 可以执行。宿主之后新增的生图、代码运行时或未知工具，即使被其他插件放进可见列表，也仍会被拒绝。Guard 才是权限边界，预设与提示词用于加固。传输插件必须在调用 `ctx.channel.admit()` 前认证发送者。

使用旧版或其他 Agent 预设保存的会话绝不会恢复运行。此类会话若还有未回传结果，客户端只发送固定的安全提示；下一条新任务会新建 `telegram-safe` 会话，不会把旧消息或工具结果重新送入模型。Telegram 路由过期或输出超过三条消息上限时，会持久标记为已放弃，重启后不再重试；其他投递失败会保留持久结果，等待供应商恢复。

## 模型体验

### 远程渠道轮次

#### 模型看到的内容

已接纳的普通文本和 `/new` 后可选的任务文本，会按裁剪并限制长度后的原样内容进入当前 `telegram-safe` 会话。该预设提供完整的远程研究 persona 和 `web_search` schema；本地斜杠命令与传输标识不会进入模型。

#### Token 影响

每条已接纳任务都会增加长度随输入变化的文本，并产生一个普通 Agent 轮次。本地命令不产生模型请求；搜索不可用时，模型仍可直接输出文本回答。

#### KV Cache 影响

只要提示继续进入同一个安全会话且固定预设不变，缓存前缀就保持仅追加。使用 `/new`、从不安全旧预设自动迁移，或预设生命周期发生变化时，会开始使用另一段可复用前缀。

## 已知限制与后续工作

- 如果供应商发送成功后、落盘 delivered 标记前进程退出，出站投递无法保证严格 exactly-once。发送与落盘标记属于同一个 outbox 重试单元，因此这个崩溃窗口可能产生重复消息；持久结算仍会阻止模型提示再次运行。
- 媒体、本地文件访问、代码执行、远程审批、权限修改、任意会话 id 与 transcript 导出均有意不支持。
