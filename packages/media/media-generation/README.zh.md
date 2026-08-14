# @deepseek-ai/dsh-media-generation

[English](README.md) | 中文

为 DeepSeek Harness 提供可选的图片与视频生成功能。Host 插件根据实时 `media-generation` 设置动态注册 `generate_image` 和 `generate_video`，在每次操作开始前解析凭据引用，并让审批与执行使用同一份不可变配置快照。两个工具默认关闭；默认审批策略为 `always`，任何可能产生费用的提供方请求都需要先确认。

图片调用兼容 OpenAI Images 的接口，并要求提供方返回规范的 base64。视频调用 Google Veo 长任务接口，在前台持续轮询，直至完成、取消或达到配置的截止时间。生成的图片字节会先经过 `ctx.attachments.validateImage`，完整解码并检查像素限制，再进入发布流程。产物存储随后校验容器与字节上限，以仅限所有者读写的权限写入 `<DSH_HOME>/media/v1` 下的内容寻址文件；存在 `ctx.webServer` 时，通过 `/generated-media/<sha256>.<extension>` 提供 GET、HEAD 和单区间读取。

浏览器端提供“媒体”设置页和按工具名匹配的结果卡片。设置与凭据状态沿用 Host 的 settings 和 credentials API；API 密钥只写入凭据服务，不进入设置文档。工具成功时返回 `{ artifact: MediaArtifact }`，把可回放的卡片数据写入 `presentationMeta`，同时在文本中附带同一数据的标记，使嵌套 Code Mode 调用也能渲染产物。

## 配置

| 配置项 | 默认值 | 含义 |
|---|---:|---|
| `approval` | `always` | 每次生成均确认；`video-only` 只确认视频，`never` 让两类请求直接开始。 |
| `image.enabled` | `false` | 注册 `generate_image`。 |
| `image.baseURL` | `https://api.openai.com/v1` | Images API 基础地址；本机提供方可使用 loopback HTTP。 |
| `image.model` | `gpt-image-2` | 发送给图片提供方的模型 id。 |
| `image.apiKeyEnv` | `OPENAI_API_KEY` | 每次操作解析的凭据引用。 |
| `image.defaultSize` | `auto` | 默认可为 `auto`、`1024x1024`、`1536x1024` 或 `1024x1536`。 |
| `image.defaultQuality` | `auto` | 默认可为 `auto`、`low`、`medium` 或 `high`。 |
| `video.enabled` | `false` | 注册 `generate_video`。 |
| `video.baseURL` | `https://generativelanguage.googleapis.com/v1beta` | Google generative-language API 基础地址。 |
| `video.model` | `veo-3.1-generate-preview` | Veo 模型 id。 |
| `video.apiKeyEnv` | `GOOGLE_API_KEY` | 每次操作解析的凭据引用。 |
| `video.defaultAspectRatio` | `16:9` | 默认 `16:9` 或 `9:16`。 |
| `video.defaultDuration` | `4` | 默认 4、6 或 8 秒。 |
| `video.defaultResolution` | `720p` | 默认 `720p`、`1080p` 或 `4k`；1080p 与 4k 要求 8 秒。 |
| `maxImageBytes` | `5242880` | 图片产物字节上限；附件后端可采用同等或更严格的图片解码策略。 |
| `maxVideoBytes` | `536870912` | 视频产物字节上限。 |
| `videoPollIntervalMs` | `10000` | 两次 Veo 任务查询之间的等待时间。 |
| `videoTimeoutMs` | `1200000` | Veo 完整操作的截止时间。 |

提供方地址不能包含内嵌凭据、查询参数或片段，不接受非 HTTP(S) 协议，也不允许向非 loopback 地址发送明文 HTTP。图片与视频模型 id 不能为空；凭据引用使用环境变量命名规则。实时设置会直接增加或移除对应工具，无需重启。已经通过执行检查的调用继续使用审批时确定的地址、模型、默认参数、限制与凭据引用；凭据值会在实际请求前即时解析。

## 模型体验

### 系统提示词

#### 模型看到什么

两个工具均关闭时不提供此段。其他情况下，`<enabled-tools>` 是一个已启用工具名，或用 ` and ` 连接的两个工具名。

##### 条件式媒体生成指引

```markdown
Use <enabled-tools> only when the user's requested deliverable genuinely needs a new image or video; do not call them merely to discuss or analyze media. Generate one artifact at a time by default. The result is already displayed in a media card, so do not repeat its internal URL. Provider calls may incur charges and require approval.
```

#### Token 影响

至少启用一个工具时，每次请求增加固定的条件式指引。

#### KV Cache 影响

工具启用状态与插件生命周期不变时，前缀保持稳定。启用或关闭任一工具可能从该段和变化后的工具 schema 列表起失去复用。

### 工具 schema

#### 模型看到什么

仅在对应提供方启用时，模型才能看到生成的 [`generate_image` 与 `generate_video` schema](../../../docs/tool-catalog.md#deepseek-aidsh-media-generation)。提供方地址、模型 id、凭据、字节限制、轮询、截止时间和审批策略都属于部署设置；调用只能覆盖 schema 中列出的媒体格式默认值。

#### Token 影响

每个已启用工具产生固定的 schema 成本。提示词、可选格式参数和保留结果的数据量随调用而变。

#### KV Cache 影响

工具启用状态和可见性不变时，前缀保持稳定。设置启用状态、插件生命周期或作用域工具限制可能从第一个变化的 schema token 起失去复用。

### 生成结果

#### 模型看到什么

成功结果先显示 `Generated <kind> with <model>.`，再显示 `Open: <internal-url>`，最后显示包含规范产物数据的 `<dsh-media-artifact>` JSON 标记。审批拒绝以及提供方、校验、大小、取消或超时错误都会成为普通工具错误结果，并且不会发布新产物。

#### Token 影响

一段简短的动态结果及其产物标记会保留，并在压缩前随上下文再次发送。生成的二进制字节不会进入模型上下文。

#### KV Cache 影响

追加式；新的调用与结果位于可复用请求前缀之后。

## 已知限制与延后工作

- **视频生成占用前台工具调用** — 当前不会发布后台任务，进程重启后也无法恢复尚未完成的 Veo 操作。取消、超时或退出只会停止本地轮询与下载；已经提交给提供方的任务仍可能在远端继续运行并产生费用。
- **生成产物会无限期保留** — 内容寻址可以去重相同字节，基于引用关系的垃圾回收仍待实现。
- **产物授权覆盖整个 loopback 同源应用** — 路由只接受 loopback Host 与同源浏览器标记，要求准确且难以猜测的哈希文件名，并发送同源与禁止嗅探响应头，但没有按会话划分的访问控制列表。
- **凭据界面只写，不等于进程隔离** — API 密钥不会进入设置文档或浏览器响应，但当前本地凭据提供方与 Agent 工具使用同一个操作系统用户。请使用权限受限、额度较低的专用密钥，不要把凭据文件视为对不受信任 Shell 进程不可见。
- **提供方重试需要人工判断** — 生成请求目前没有自动重试或跨重启幂等键。失败或中断后应先检查提供方状态，再决定是否重试，避免意外启动第二次付费生成。
- **提供方响应支持范围保持收敛** — 图片提供方必须返回规范的 `b64_json`，仅返回 URL 的图片结果会被拒绝；Veo 跨域下载只允许经过批准的 Google 媒体主机。
