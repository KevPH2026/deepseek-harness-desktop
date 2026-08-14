# DeepSeek Harness Desktop release notes / 版本说明

This changelog covers the unofficial community desktop wrapper maintained at
[`KevPH2026/deepseek-harness-desktop`](https://github.com/KevPH2026/deepseek-harness-desktop).
It does not describe an official DeepSeek desktop product.

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

This beta changelog is source documentation. Only Developer ID-signed and Apple-
notarized GitHub Release artifacts are intended for distribution; local unsigned
packages are verification artifacts.

## 中文

本记录对应由
[`KevPH2026/deepseek-harness-desktop`](https://github.com/KevPH2026/deepseek-harness-desktop)
维护的非官方社区桌面封装，不代表 DeepSeek 官方桌面产品。

### 0.1.0-beta.1

- 首次提供面向 macOS Apple Silicon 的桌面外壳，承载本地 DeepSeek Harness Web
  工作区，并加入受监管的回环运行时与协调退出流程。
- 新增 Agent 可自动调用的智能图片与视频生成能力，包括服务商配置保存与生成产物处理。
- 新增社区插件列表的只读发现；本版本不会安装或执行第三方市场插件。
- 新增原生菜单入口，可查看当前版本、检查更新、打开版本说明与提交反馈。已签名 beta
  版本可跟随 GitHub Release beta 通道，并在下载与重启前分别征求用户确认。

本 beta 版本说明属于源码文档。只有经过 Developer ID 签名、Apple 公证并发布到
GitHub Release 的产物才用于分发；本地未签名包仅作为验证产物。
