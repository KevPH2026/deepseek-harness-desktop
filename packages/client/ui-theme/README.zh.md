# @deepseek-ai/dsh-client-ui-theme

[English](README.md) | 中文

主题插件：基于 --dsw-* token 基础样式表（静态尺度 + 别名语义层）的 ThemeRuntime。该服务拥有实时外观偏好：`light`、`dark` 与 `system` 仍是基础显示模式，`deep-sea`、`aurora-night` 与 `warm-paper` 则选择具有固定配色模式的产品内置皮肤。它会通过 `prefers-color-scheme` 解析 `system`，并发布不可变的 `ThemeSnapshot`，通过 `theme/change` 事件通知变化；它绝不接触 DOM：ui-layout 的呈现器会应用解析后的快照（`html { color-scheme }`、`body[data-ds-dark-theme]`，以及主题的别名 token 内联变量）。来自回环地址的浏览器会先以 `system` 立即提供该服务，随后在后台加载 `ui-theme.preference`，并将每次内置主题选择通过 Host settings API 写入；其本地提供方默认将设置存入 `$DSH_HOME/settings.yaml`。收到推送的 settings 变更时或重连后，浏览器都会重新拉取该设置；连续快速选择会按操作顺序携带 namespace revision 串行写入，最新写入被拒时则重新加载持久化值。远程浏览器无法访问特权 settings API，因此它的选择仅保留在进程内。已注册的第三方主题 id 仍是进程内扩展，不会跨越内置 settings schema；移除其中任意一个都绝不会覆盖最后一个持久化的内置偏好。该持久化边界由[Host settings 支撑的偏好决策](../../../.agents/notes/implemented/bug-fix/2026-08-06-host-backed-web-preferences.md)拥有。

当主机组合包含 HTTP 服务器时，主机侧紧接 `<body>` 起始标签注入同步引导代码。每份 index 响应会嵌入已注册的 Host 设置 `ui-theme.preference`，没有 settings provider 时则嵌入 `system`；浏览器会解析配色模式，并在外壳加载页面渲染前一并应用所选内置皮肤的全部 token、`color-scheme` 和 `body[data-ds-dark-theme]`。因此首帧会直接使用已保存的皮肤，不会先闪过基础配色。不含 HTTP 服务器的组合不受影响，插件树激活后，ThemeRuntime 与 ui-layout 仍分别是客户端状态和后续 DOM 更新的权威来源。

## 内置皮肤与安全边界

「外观」设置把三种基础显示模式与三张可选调色板卡片分开呈现：

| 皮肤 | 偏好 id | 配色 | 设计方向 |
| --- | --- | --- | --- |
| 深海蓝 | `deep-sea` | 深色 | 沉静的海洋蓝表面，搭配清晰的青色强调色 |
| 极光夜 | `aurora-night` | 深色 | 墨蓝表面，搭配克制的极光绿色强调色 |
| 暖纸 | `warm-paper` | 浅色 | 温暖的中性纸张表面，搭配大地红强调色 |

三套调色板均在本包内原创，只包含语义化 CSS token 值，不会加入 DOM 代码、网络请求、字体、图片或可执行资产。运行时与插件启动前的引导代码读取同一组冻结定义；聚焦测试要求皮肤提供完整的表面 token 集，拒绝绕出 token 边界的资产引用，并检查主文字、次要文字和强调色组合的可读对比度。

我们核对了官方仓库、官方 [Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions) 与社区 [dsh-plugin topic](https://github.com/topics/dsh-plugin)，没有找到能够验证为可安装且兼容当前主题约定的独立主题或皮肤包。加入 topic 只代表便于发现，不代表官方认证。因此，本实现没有复制任何社区包、调色板、美术素材或依赖。受信任的组合仍可使用公开的 `register()` 与 `overrideTokens()` API，但本包不会把未经审核的社区主题直接做成可安装市场。

`src/styles/` 下有五张样式表，由 ui-theme 的动态客户端 entry 依次导入：`base.css`、`design-platform.css`、`scrollbar.css`、`gradient-shadow-text.css` 与 `shiki.css`。客户端 bundle 将其编译并注入为插件持有的全局样式，因此卸载与 HMR 会随 ui-theme 一同移除这些样式，而不会把主题 CSS 留在静态 Web 外壳中。`scrollbar.css` 是 `--dsw-alias-scrollbar-*` token 的唯一消费方，必须排在声明这些 token 的 `design-platform.css` 之后。

滚动条重新绑定约定：`scrollbar.css` 在 `body` 上把 `--dsh-scrollbar-thumb` 与 `--dsh-scrollbar-thumb-hover` 绑定到 l1（基础表面）token，两条渲染路径都读取这一组变量。高层级表面（菜单、浮层、对话框）在自己的容器上设置 `--dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2)` 与 `--dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2)`；一次重新绑定即可为引擎实际走的那条路径换色。这组变量的另一个合法目标是 `transparent`，即完全不绘制滑块——[ui-sidebar](../ui-sidebar/README.md) 在指针不在栏内时就这样重新绑定自己的列。绑回 l1 那组不算重新绑定，它只是重述基础表面的默认值。`--dsh-scrollbar-width` 镜像 WebKit 滚动条的布局宽度，供需要与占布局宽度的滚动条对齐的表面使用——[ui-conversation](../ui-conversation/README.md) 用它作为覆盖 composer 座位 `right` 偏移——scrollbar-styles 规格把它与镜像规则及消费者配对检查。

两条路径在构造上互斥。`scrollbar-width`／`scrollbar-color` 写在 `@supports not selector(::-webkit-scrollbar)` 之内，因为这两个属性中的任一个只要取非 `auto` 值，Chromium 与 Safari 就会丢弃该元素上的全部 `::-webkit-scrollbar*` 规则，`::-webkit-scrollbar-thumb:hover` 也在其中——若无条件地同时声明，`--dsh-scrollbar-thumb-hover` 在任何引擎上都不会被渲染。因此 Firefox 走标准属性，WebKit 系引擎走伪元素，hover token 只经由伪元素这条路径渲染。相关原理与实测计算值见[滚动条 Agent Note](../../../.agents/notes/implemented/bug-fix/2026-07-28-themed-scrollbars-and-reserved-gutter.md)。

## 模型体验

无。主题服务管理浏览器偏好；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **第三方主题是扩展点，不是产品**：内置皮肤具备完整性与对比度检查；通过 `register()` 提供的主题仍没有包完整性、沙箱、来源或 token 完整性保证。
- **token 样式表是颜色值的唯一权威来源**：会有意不补入 cssdesign 中缺失的值（例如设计中的 #4176E6 标签页蓝色）；一律采用最接近的语义 token。设计负责人批准的新增值是例外：须在同一变更中以一个静态尺度层级与一个语义别名的形式进入（`--dsw-static-blue-900` / `--dsw-alias-label-primary-bluish`）。
