# @deepseek-ai/dsh-client-ui-settings-channel-telegram

[English](README.md) | 中文

DeepSeek Harness Desktop 的本机 **Telegram 远程控制**设置页。浏览器插件以 `remote-channels` 为 id、`30` 为顺序注册 `settings.section`，但只在当前连接为 loopback 时注册。远程浏览器客户端不会看到这个页面，也拿不到页面里的操作入口。

页面从 BotFather 开始，引导用户完成一套默认拒绝的配对流程：

1. 使用 [`@BotFather`](https://t.me/BotFather) 创建一个专用 Bot。
2. 通过 Host Credentials API 保存 Bot Token。密码草稿只存在于当前挂载的 React 组件里；控制器只保存 `configured` 和 `writable` 元数据，永远不保存 Token 值。
3. 启用前必须明确勾选远程触发风险确认。Host 的 `enable` Remote 会核验 Bot 并启动消息入口，同时保留已有配对状态。
4. 使用 `beginPairing` 生成一个短时、单次有效的 Telegram 深链。需要从 Mac 转到手机时可以复制链接；如果剪贴板不可用，页面会展示可手动选中的完整链接。
5. 在 Bot 私聊中打开链接。Telegram 发来的 `/start <token>` 只会生成候选账号，不会直接授权发送者。
6. 回到桌面端，核对精确的 Telegram 用户数字 ID 和私聊数字 ID，再从确认弹窗调用 `confirmPairing`。
7. 在同一页面查看或撤销已绑定账号、临时停用消息入口且保留绑定，或移除本机保存的 Token。停用期间发送的消息绝不会自动执行。
8. 当本机无法直连 `api.telegram.org` 时，可以保存一个可选的 HTTP(S) 代理地址（例如 `http://127.0.0.1:7890`）。`setProxy` 远程接口会校验地址格式，把配置持久化到通道状态并重启运行中的轮询器；留空保存即恢复直连。代理地址不是机密信息，安全状态会以 `proxyUrl` 字段返回。

启用后，控制器只轮询不含密钥的 `channelTelegram.status` 投影，在连接启动或恢复期间自动更新状态；Host 报告在线后，配对按钮会自动开放。一次性配对链接等待期间，控制器会继续轮询，直到出现候选账号，或 Host 离开等待状态。绑定身份以精确的 `userId` 与 `chatId` 为准；姓名和用户名只用于展示。首版远程任务白名单只包含纯文本推理和 `web_search`。Telegram 不能访问本地文件，也不能调用 Shell、PowerShell（`pwsh`）、代码执行、凭据、设置、审批、媒体、subagent 或 workflow。

Telegram 报告积压时，安全状态投影只携带 `pendingUpdateCount`；更新内容不会进入渲染状态。页面只显示数量，并使用专用 `backlog-pending` 错误，不会把它归入通用的启用或配对失败。激活屏障可能拉取并检查一批更新，但客户端会保持停用，不执行、不确认、不推进 offset，也不清空积压更新。用户可以等待 Telegram 最多 24 小时让积压自动过期，或撤销绑定、移除 Token，再保存一个新的专用 Bot Token。

移除 Bot Token 采用默认拒绝的执行顺序：控制器先调用 `revoke` 停用通道并清除待配对或已绑定状态，再调用 `credentials.unset`。如果无法确认 revoke 是否成功，Token 会保留，页面只显示通用失败提示。传输层和 Host 的原始错误细节不会渲染到页面，因此凭据提供方即使意外回显提交值，也不会把 Token 带进页面状态。

页面会明确提醒用户：只在 Bot 私聊中使用、核对精确数字 ID，并保持电脑和桌面客户端在线。Telegram Bot 聊天不是端到端加密，消息会由 Telegram 处理。已绑定账号发起任务会消耗用户配置的模型和搜索额度。页面还会提醒用户不要通过 Bot 发送 API Key、密码、Token 或其他密钥。

## 模型体验

### 本机 Telegram 设置

#### 模型看到的内容

本包不会向模型提供内容。Token 编辑、风险确认、启用、`channelTelegram.status` 轮询、配对、身份确认和撤销都属于 loopback UI 与 Host Remote 操作，不会向模型上下文添加 Session 消息、提示词段落、工具 schema 或传输元数据。

#### Token 影响

本包直接增加的 Token 为零。这些设置操作不会创建模型提供方请求；页面只会提醒用户，后续由 Channel 消费者处理的已接纳任务可能消耗已配置的模型和搜索额度。

#### KV Cache 影响

本包不会创建模型提供方请求，因此既不会建立，也不会使可复用前缀失效。后续已接纳任务的缓存行为由其 Channel 消费者和 Agent 会话负责。

## 已知限制与暂缓事项

- 当前 Telegram Host 提供方一次只授权一个精确私聊身份。需要更换账号时，请先撤销，再重新配对。
- 一次性配对能力只存在于内存，页面刷新后无法恢复；丢失或过期时请重新生成。
- 电脑和 Host 必须保持在线。本包不提供云端中继。
- 停用期间发送的消息绝不会自动执行。激活期间提供方可能拉取并检查一批更新；Telegram 报告积压时，客户端会保持停用，不执行、不确认、不推进 offset，也不清空。
- Telegram 最多可能保留积压更新 24 小时。用户可以等待自动过期，或撤销绑定、移除 Token，再换一个新的专用 Bot。
- Telegram 远程任务白名单只包含纯文本推理和 `web_search`；列出的本地或高风险能力全部保持禁用。
- Telegram 不能提交审批决定。由桌面任务产生的审批仍然只能在桌面端处理。
- Telegram Bot 聊天不是端到端加密，消息会由 Telegram 处理。
