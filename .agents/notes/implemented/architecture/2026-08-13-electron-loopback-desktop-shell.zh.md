# Agent Note: Electron 桌面外壳监管回环 Web 传输层

Status: implemented

[English](2026-08-13-electron-loopback-desktop-shell.md) | 中文

## Problem

Harness 已经拥有完整的浏览器工作区和 Host 运行时，但没有桌面应用生命周期。Web UI 依赖注入的启动清单、HTTP RPC、WebSocket 下行流和动态提供的客户端 Bundle，因此通过 `file://` 加载其构建后索引无法形成可用应用。源码把 Electron IPC 传输层描述为原生传输的预期方向，但客户端连接和模块注册表仍然直接实例化 Web 传输和 Web Server 路由。

## Decision

`apps/desktop` 提供 Electron 主进程，通过以 Node 模式运行的 Electron 子进程监管构建后的 `dsh web` 入口。子进程会带上当前 Web Profile 的 HMR 服务所需的 `--expose-internals`。Harness 绑定到操作系统分配的回环端口，并继续独占现有 HTTP、WebSocket、模块、目录选择、设置、凭据和会话协议。Electron 只加载从 Host 就绪日志行中解析出的精确来源。

子进程使用应用专属的 `DSH_HOME`，桌面状态因此与命令行 Profile 隔离。桌面应用在普通 macOS 窗口关闭后保留子进程，从 Dock 激活时重建窗口，并在明确退出时执行有时限的进程组清理；启动过程中退出会取消待完成的启动。应用把标准输出和标准错误写入仅所有者可读写的日志，并通过原生错误对话框报告启动失败或意外退出。

渲染器没有 Preload 桥接。Node 集成关闭，上下文隔离、Chromium 沙箱和 Web 安全开启；同源导航允许，HTTP 和 HTTPS 链接交给操作系统浏览器，其他导航协议全部拒绝。

打包流程使用 Electron Builder 处理由 pnpm Deploy 生成的无符号链接 Stage。部署根显式提供所有必需 Workspace Peer；准备步骤会恢复 Legacy Hoist，并实体化 vendored `link:` 包。首个安装包不使用 ASAR，因为 Harness 会为已安装包目录创建 Profile 回退链接，并从真实路径加载插件、Worker、原生模块和 `node-pty` Spawn Helper。

## Alternatives considered

- **通过 `file://` 加载当前 Vite 输出并只桥接 `fetch`**：拒绝，因为 Web Server 会注入启动清单并管理插件 Bundle 路由和 WebSocket 流；单独的 Fetch 桥接会绕过连接拦截器，客户端模块加载也仍未解决。
- **在 Electron 主进程中直接导入 `runProfile`**：首个安装包拒绝该方案，因为 CLI 没有把这一生命周期导出为包子路径，而且它会安装进程级信号和致命错误处理器。受监管子进程可以保留已发布入口，同时让 Electron 拥有明确的进程所有权。
- **使用 Tauri 和 Node Sidecar**：拒绝，因为 Harness 本来就需要 Node；Sidecar 会保留同样的运行时和进程生命周期工作，同时再增加一个桌面框架。
- **把运行时打包进 ASAR**：拒绝，因为虚拟归档路径会与安装回退、动态模块解析、Worker、原生模块和可执行 Helper 冲突。

## Consequences

- 桌面应用复用已经组装并经过测试的 Web 体验，不会分叉 UI 行为或 Wire Contract。
- 每次启动使用随机回环端口，不产生局域网监听；但第一版传输仍然信任同一登录用户下运行的其他原生进程，不具备进程内 IPC 的认证边界。
- 明确退出会等待正常清理，同时保留强制终止兜底；macOS 窗口关闭会让后台状态继续存活。
- 未来的无端口桌面传输仍是独立架构变更：必须提供完整连接分发器、普通调用与流传输、取消处理和客户端模块加载，才能移除 Web 传输层。
