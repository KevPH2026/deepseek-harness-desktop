# DeepSeek Harness Desktop release notes / 版本说明

This changelog covers the unofficial community desktop wrapper maintained at
[`KevPH2026/deepseek-harness-desktop`](https://github.com/KevPH2026/deepseek-harness-desktop).
It does not describe an official DeepSeek desktop product.

## 0.1.0-beta.3

- Adds a curated one-click community pack to the plugin marketplace: git
  graph, the right-side file/change panel, skin center with extra skins,
  image understanding, the liangshen preset, and the whale pet — an
  Apache-2.0 subset of dsh-web-ui by @linxin666, installed through the
  official profile mechanism with explicit risk acknowledgement and one-click
  uninstall. SSH ops, the task board, the community-plugin center, mobile
  remote, and live token estimation are deliberately excluded.
- The composer stats strip is now clickable and expands a full usage panel:
  uncached input, cache-read, cache-write, output, billed input, total
  tokens, cache-hit rate, context occupancy, and speed metrics for the
  session.
- Distribution: signed-release candidates continue on the GitHub Release
  channel; this beta also publishes the unsigned Apple Silicon ZIP for early
  adopters who accept the Gatekeeper confirmation step.

## 0.1.0-beta.2

- Completes private Telegram phone control with one-time pairing, explicit
  desktop confirmation, durable task delivery, a remote-safe capability fence,
  and fail-closed lifecycle handling. The desktop service remains loopback-only.
- Carries the tray-owned desktop lifecycle into this beta: closing the window
  keeps the active Harness session available, while Quit performs a coordinated
  shutdown.
- Added three persisted built-in desktop skins—Deep Sea Blue, Aurora Night,
  and Warm Paper—with first-paint token application, palette previews, reset,
  and contrast and resource-safety coverage.
- Added loopback-only, optional three-step public-profile onboarding and a
  Profile settings page. Every field starts hidden from Agents and joins
  supported local Agent context only after explicit per-field consent; the
  `telegram-safe` preset suppresses the profile context entirely.
- Telegram Remote Control now accepts an optional local HTTP(S) proxy for Bot
  API requests, for networks that cannot reach api.telegram.org directly. The
  override is validated and persisted in channel settings, restarts a live
  poller on change, and restores the direct connection when cleared.
- Release hygiene: client bundles now identify workspace stylesheets by
  repository-relative ids, and the packaging pipeline rewrites the pnpm
  records' absolute paths and fails the build if the staged app still embeds
  the build machine's checkout or home directory.

## 0.1.0-beta.1

- Added the first macOS Apple Silicon desktop shell around the local DeepSeek
  Harness Web workspace, with a supervised loopback runtime and coordinated
  shutdown.
- Added agent-accessible image and video generation, including saved-provider
  settings and generated-artifact handling.
- Added read-only discovery for community plugin listings; this release does
  not install or execute third-party marketplace plugins.
- Added native current-version, update-check, release-notes, and feedback menu
  entries. Signed beta builds can follow the beta GitHub Release channel and
  ask before download and restart.
- Added a localized system tray backed by the official Harness artwork. Closing
  the main window now keeps the current session alive; the tray restores the
  window, exposes update and support actions, and performs a graceful quit.

This beta changelog is source documentation. Only Developer ID-signed and Apple-
notarized GitHub Release artifacts are intended for distribution; local unsigned
packages are verification artifacts.

## 中文

本记录对应由
[`KevPH2026/deepseek-harness-desktop`](https://github.com/KevPH2026/deepseek-harness-desktop)
维护的非官方社区桌面封装，不代表 DeepSeek 官方桌面产品。

### 0.1.0-beta.3

- 插件市场新增"精选全家桶"一键安装：Git 图谱、右侧文件/变更面板、皮肤中心（含
  多款皮肤）、图像理解、梁神模式预设和鲸鱼娘桌面宠物。精选自 @linxin666 的
  dsh-web-ui（Apache-2.0），通过官方 profile 机制安装，需明确的风险确认，支持一键
  卸载；SSH 运维、任务看板、社区插件中心、移动端远程与实时令牌估算被刻意排除。
- 输入框下方统计条现在可以点击，展开完整用量面板：未缓存输入、缓存读取、缓存
  写入、输出、计费输入合计、总 Token、缓存命中率、上下文占用与本会话速度指标。
- 分发：继续沿 GitHub Release 通道提供候选版本；本 beta 同步发布未签名 Apple
  Silicon ZIP，供接受 Gatekeeper 手动确认的早期用户直接下载。

### 0.1.0-beta.2

- 完成 Telegram 私聊手机控制：包含单次绑定、电脑端明确确认、任务可靠投递、
  远程安全能力边界和默认拒绝的生命周期处理；桌面服务仍然只监听本机回环地址。
- 本 beta 延续由系统托盘管理的桌面生命周期：关闭窗口后 Harness 会话继续可用，
  选择“退出”时则执行协调停止。
- 新增三款可持久保存的内置桌面皮肤：深海蓝、极光夜和暖纸；支持首屏直接应用、
  真实配色预览、恢复默认，并通过对比度与资源安全检查。
- 新增仅限本机访问的可选三步公开资料首次使用引导和“个人资料”设置页。每个字段
  默认不向 Agent 提供，只有逐项明确授权后才会进入支持该能力的本地 Agent 上下文；
  `telegram-safe` 预设会完全屏蔽这份资料上下文。
- Telegram 远程控制新增可选的本机 HTTP(S) 代理设置，适用于无法直连
  api.telegram.org 的网络。代理配置经过校验并保存在通道设置中，修改后立即重启
  运行中的轮询器，清空即恢复直连。
- 发行卫生：客户端产物改用仓库相对的样式表标识；打包管线会重写 pnpm 记录中的
  绝对路径，并在暂存产物仍嵌入构建机器的源码目录或用户主目录时使构建失败。

### 0.1.0-beta.1

- 首次提供面向 macOS Apple Silicon 的桌面外壳，承载本地 DeepSeek Harness Web
  工作区，并加入受监管的回环运行时与协调退出流程。
- 新增 Agent 可自动调用的智能图片与视频生成能力，包括服务商配置保存与生成产物处理。
- 新增社区插件列表的只读发现；本版本不会安装或执行第三方市场插件。
- 新增原生菜单入口，可查看当前版本、检查更新、打开版本说明与提交反馈。已签名 beta
  版本可跟随 GitHub Release beta 通道，并在下载与重启前分别征求用户确认。
- 新增使用 Harness 官方图形的中英文系统托盘。关闭主窗口后当前会话继续运行；
  可从托盘恢复窗口、检查更新、打开帮助入口，或在安全停止 Harness 后完全退出。

本 beta 版本说明属于源码文档。只有经过 Developer ID 签名、Apple 公证并发布到
GitHub Release 的产物才用于分发；本地未签名包仅作为验证产物。
