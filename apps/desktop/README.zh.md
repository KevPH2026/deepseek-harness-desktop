# DeepSeek Harness Desktop

[English](README.md) | 中文

> **非官方社区桌面封装。** 本项目不是 DeepSeek 官方桌面产品。桌面封装由 [@KevPH2026](https://github.com/KevPH2026) 维护，基于上游 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 项目。

这是现有 DeepSeek Harness Web 工作区的 Electron 桌面外壳。桌面进程在操作系统分配的 `127.0.0.1` 端口启动一个受监管的 Harness 子进程，在限制严格的渲染器中打开该精确来源，并在应用退出前停止子进程。

DeepSeek Harness 保留原始的 `Copyright (c) 2026 DeepSeek` 版权声明。本社区封装按上游 [MIT 许可证](../../LICENSE) 分发；捆绑依赖及其许可证见[第三方声明](../../THIRD_PARTY_NOTICES.md)。

社区源码、反馈与桌面版本发布位于
[`KevPH2026/deepseek-harness-desktop`](https://github.com/KevPH2026/deepseek-harness-desktop)。
About 与帮助菜单仍单独保留上游 DeepSeek Harness 链接。

## 开发

在仓库根目录构建 Harness Host 包、客户端 Bundle、Web 前端和桌面主进程：

```sh
pnpm install
pnpm run desktop:dev
```

安装工作区依赖或执行打包时会获取 Electron 运行时；已打包 App 第一次启动时不会再下载 Electron。桌面数据隔离存放在 Electron 的 `userData` 目录中，不复用命令行版 Harness Home。

macOS 图标不改变图形，直接从仓库官方 `apps/web/public/favicon.svg` 资产生成：

```sh
npm run desktop:icon:mac
```

该命令把同一个 SVG 光栅化为 Apple 要求的各级尺寸，并写入
`apps/desktop/build/icon.icns`。

## macOS 打包

创建本地未签名的 Apple Silicon 应用目录：

```sh
npm run desktop:pack:mac
```

应用会生成在
`apps/desktop/release/mac-arm64/DeepSeek Harness Desktop.app`。
随后该命令会启动打包后的运行时，在三秒稳定窗口前后分别请求一次 Web 入口，
并要求进程正常退出。

创建已签名、已公证的 DMG 和 ZIP 发布产物：

```sh
npm run desktop:dist:mac
```

发布打包需要 Developer ID Application 身份和 Apple 公证凭据。本地打包命令会显式关闭身份选择和 Hardened Runtime；其产物仅用于验证，不能作为正式分发版本。

Builder 已预设到上述公开 GitHub 仓库。已签名 Release 必须附带 DMG、ZIP、
ZIP blockmap 及生成的 `latest-mac.yml`；macOS 自动更新需要 ZIP 和更新元数据。
当前 workflow 会公证并钉票 App，但外层 DMG 仍须单独上传 Apple、公证并钉票，
这是发布前置条件。钉票会改变容器字节，因此不生成钉票前的 DMG blockmap。
本地命令始终传入 `--publish never`；在外层 DMG、公证、运行时 smoke 和产物检查
全部通过前，不应创建二进制 Release。

## 更新与反馈

通过 Developer ID 签名安装的 App 会在启动时及每六小时检查一次 GitHub Release
通道。发现版本后先询问是否下载，下载完成后再次询问是否重启安装。原生更新器会在安装前
验证 macOS 代码签名要求，现有桌面 shutdown 协调器会在 App 退出前停止 Harness
进程树。

开发版本与本地 ad-hoc beta 包不会访问更新源。已签名 beta 版本会跟随 beta 通道，
可升级到更新的 beta 或稳定版本；稳定版本不会主动接收预发布版本。降级始终禁用。
下载确认框会显示纯文本且有长度上限的版本说明摘要。原生菜单会显示当前版本，并提供
“检查更新”、
[版本说明](https://github.com/KevPH2026/deepseek-harness-desktop/releases)与
[反馈问题](https://github.com/KevPH2026/deepseek-harness-desktop/issues/new/choose)入口。

首个桌面版本的双语说明以 [CHANGELOG.md](CHANGELOG.md) 为单一真源。

## 安全与生命周期

渲染器关闭 Node 集成，开启上下文隔离、Chromium 沙箱和 Web 安全。页面只能在分配给 Harness 的来源内导航；HTTP 和 HTTPS 链接交给操作系统浏览器打开，其他协议全部拒绝。

Web 传输层只监听回环地址。桌面进程不会向渲染器暴露通用文件系统、Shell、Fetch 或 IPC 能力。原生目录选择和路径打开继续使用现有的不携带路径参数的 Host API。

最终 macOS Bundle 会关闭任意 App Transport Security 加载，同时保留本地网络和
显式的 `localhost`／`127.0.0.1` 例外。

回环传输层采用同一用户信任边界，并不用于认证同一登录账户下运行的其他原生进程。
处理敏感 Harness 会话时，不要同时运行不受信任的本机进程。

在 macOS 上关闭最后一个窗口后，Harness 进程会继续运行，便于从 Dock 重新激活。明确退出应用时先发送 `SIGTERM`，等待最多八秒确认子进程完全退出；只有正常清理未完成时才发送 `SIGKILL`。
在启动过程中提前退出也会取消正在进行的启动；POSIX 系统会对应用拥有的进程组发信号，
避免工具子进程在桌面应用退出后继续残留。

受监管的 Node 模式子进程会带上 `--expose-internals`；当前 Harness Web Profile
在 macOS 上加载 HMR 服务时需要这个参数。

桌面 manifest 同时显式拥有对等依赖闭合的 Harness 运行时根目录。部署前必须通过
`npm run desktop:verify-runtime`；自动安装对等依赖保持关闭，让缺失的打包依赖在构建时失败，
不会等到用户机器上才暴露。Staging 步骤还会恢复 pnpm legacy deploy 遗漏的提升依赖，
并把 vendored `link:` 包实体化，最终不留下指向源码 checkout 的包软链接。

首个安装包让 Harness 运行时保持在 ASAR 之外，因为 Profile 回退链接、动态插件、Worker、原生模块和 `node-pty` Helper 需要真实文件系统路径。未来的 `file://` 渲染器需要为普通调用、流、客户端模块和取消操作实现完整 IPC 传输层；在该传输层完成前继续使用 Web 传输层。
