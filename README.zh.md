<p align="center">
  <img src="apps/web/public/favicon.svg" width="104" alt="DeepSeek Harness 图标">
</p>

# DeepSeek Harness Desktop

[English](README.md) | 中文

<p align="center"><strong>一个能够推理、编程、使用工具、生成媒体，并通过社区插件持续扩展的桌面 agent 工作区。</strong></p>

<p align="center">
  <a href="https://github.com/KevPH2026/deepseek-harness-desktop/releases"><img alt="GitHub Release" src="https://img.shields.io/github/v/release/KevPH2026/deepseek-harness-desktop?include_prereleases&style=flat-square"></a>
  <a href="LICENSE"><img alt="MIT 许可证" src="https://img.shields.io/badge/license-MIT-111827?style=flat-square"></a>
  <a href="https://github.com/KevPH2026/deepseek-harness-desktop/stargazers"><img alt="GitHub Stars" src="https://img.shields.io/github/stars/KevPH2026/deepseek-harness-desktop?style=flat-square"></a>
  <img alt="macOS Apple Silicon" src="https://img.shields.io/badge/macOS-Apple%20Silicon-111827?style=flat-square&logo=apple">
</p>

![DeepSeek Harness Desktop 展示带来源信息的第三方插件市场](docs/user/deepseek-harness-desktop-plugin-marketplace.zh.png)

> [!IMPORTANT]
>
> DeepSeek Harness Desktop 是由 [@KevPH2026](https://github.com/KevPH2026) 维护的**非官方社区版**。它基于开源 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 项目，不是 DeepSeek 官方桌面产品，也不代表官方背书。

## 一个工作区，更多完成任务的方式

DeepSeek Harness 已经提供了强大的插件化 agent harness（智能体框架）。本社区版把它带进受监管的 macOS 桌面应用，并加入更适合日常使用的产品功能：可配置的图片与视频生成、展示来源与按需 manifest 核验状态的社区插件目录、面向版本发布的更新机制、版本说明和直接反馈入口。

| 你可以做什么 | 桌面版如何提供帮助 |
|---|---|
| 构建和修改软件 | 为 agent 指定工作区，让它检查文件、运行工具、规划改动，并把会话集中保留。 |
| 制作视觉交付物 | 一次配置图片和视频提供方；当交付物确实需要视觉内容时，agent 可以调用合适的媒体工具。 |
| 扩展不同工作流 | 按场景发现社区插件、检查信任信息，并按需验证单个仓库；当前源码 Beta 尚未开放安装。 |
| 接入自己的模型体系 | 使用 DeepSeek、受支持的兼容提供方或网关，桌面外壳不会绑定单一推理后端。 |
| 持续保持更新 | 在应用内阅读版本说明、检查已签名的 GitHub Release，并自行决定何时下载与安装。 |

## 亮点功能

### 原生桌面工作流

- 围绕完整 Harness Web 工作区构建的专注型 Electron 桌面外壳。
- 在随机 `127.0.0.1` 端口运行一个受监管 Harness 进程，明确退出时有时限地清理完整进程树。
- 渲染器默认采用严格安全设置：关闭 Node 集成、开启上下文隔离和 Chromium 沙箱，并把导航锁定到当前本机来源。
- 使用桌面应用专属数据目录，提供应用日志、原生菜单、作者信息、版本说明、更新检查和反馈入口。

### 智能图片与视频生成

- 通过 OpenAI Images 兼容提供方执行 `generate_image`，初始默认模型为 `gpt-image-2`。
- 通过 Google Veo 兼容提供方执行 `generate_video`，初始默认模型为 `veo-3.1-generate-preview`。
- 媒体工具在完成配置前保持关闭，默认采用“付费前审批”。
- 只有当媒体内容能改善用户要求的交付物时，agent 才会选择媒体工具；普通编程和写作任务仍以文本为主。
- 生成产物会以专用结果卡片展示，并在会话中持续可用。

### 社区插件市场

- 从 [`dsh-plugin`](https://github.com/topics/dsh-plugin) 话题发现仓库；只有在固定提交上的 manifest 与 patch 目标验证通过后，才把所选项目标为兼容，兼容不代表已开放安装。
- 按设计、编程、文案、模型提供方、网关和其他工作流组织插件。
- 可填写 GitHub、npm 或本地路径来源草稿并查看相应风险；当前 Beta 不执行导入，同时提供创建与发布插件的引导入口。
- 在安装保持关闭时展示源码、许可证、版本、更新时间、验证状态和风险信息。加入话题本身不会被当作兼容性或可信度证明。

### 提供方优惠，不虚构赞助关系

- 只有同时具备资格条件、条款、来源链接和核验日期时，提供方专区才会列出公开免费额度或试用优惠。
- 社区合作伙伴与普通提供方优惠会被分别标注。
- 没有真实且经过核验的关系，就不会把任何提供方描述为赞助商或合作伙伴。

## 开始使用

### 安装已签名版本

完成签名和公证的 Apple Silicon 版本会发布在 [Releases 页面](https://github.com/KevPH2026/deepseek-harness-desktop/releases)。应用只检查这一发布渠道，不会跟随任意仓库提交，并且会在下载或安装更新前征求用户确认。

### 从源码运行

前置条件：Apple Silicon Mac、Node.js `^22.19.0 || >=24.0.0`、pnpm，以及一个模型提供方 API Key。

```sh
git clone https://github.com/KevPH2026/deepseek-harness-desktop.git
cd deepseek-harness-desktop
pnpm install
npm run desktop:dev
```

创建本地未签名验证版本：

```sh
npm run desktop:pack:mac
```

分发应用包前，请先阅读[桌面构建与安全指南](apps/desktop/README.md)。

## 信任与费用边界

- **插件会执行代码。** 后续版本开放安装时，安装 Git 源可能在 agent 沙箱之外运行包构建脚本。请先检查源码、固定提交版本，并且只为你信任的代码批准构建脚本。当前源码 Beta 的市场安装保持关闭。
- **回环地址是本机通信，不代表保密。** 第一版桌面传输会信任同一登录用户下运行的其他原生进程。不要让敏感会话与不受信任的本机软件同时运行。
- **媒体调用可能产生费用。** 默认审批策略会在生成前询问。价格、资格和速率限制由对应提供方负责。
- **只有已签名 Release 才会自动更新。** 本地未签名版本可以检查更新，但会安全失败，不会绕过 macOS 信任保护。

## 产品文档

- [产品介绍与文档站](docs/user/index.md)
- [Web 工作区快速入门](docs/user/guide/index.md)
- [模型提供方配置](docs/user/guide/providers.md)
- [插件开发与发布](docs/user/develop/basic/publish.md)
- [桌面构建、生命周期与安全](apps/desktop/README.md)

## 反馈与社区

- 遇到 Bug 或有功能建议？[创建反馈 Issue](https://github.com/KevPH2026/deepseek-harness-desktop/issues/new/choose)。
- 正在开发 Harness 插件？请添加 [`dsh-plugin`](https://github.com/topics/dsh-plugin) 话题，并遵循[插件发布指南](docs/user/develop/basic/publish.md)。
- 希望展示提供方优惠或讨论真实合作？仓库上线后，请使用专门的提供方申请模板。
- 与上游 Harness 相关的问题和贡献请提交到 [DeepSeek Harness 仓库](https://github.com/deepseek-ai/deepseek-harness)。

## 项目状态

桌面版处于 Beta 阶段，上游 Harness 仍处于开发者预览阶段，可能出现破坏兼容性的变更。首个打包目标是 Apple Silicon Mac；其他平台需要完成独立打包和运行时验证后才会被列为受支持平台。

## 归属与许可证

DeepSeek Harness 保留原始 `Copyright (c) 2026 DeepSeek` 版权声明。桌面封装与社区功能由 [@KevPH2026](https://github.com/KevPH2026) 维护，并按照上游 [MIT 许可证](LICENSE)分发。捆绑依赖的许可证见[第三方声明](THIRD_PARTY_NOTICES.md)。

如果这个项目帮助你把更多 agent 运行变成真正完成的工作，请为仓库 **Star**、分享你的作品，并一起建设社区插件生态。
