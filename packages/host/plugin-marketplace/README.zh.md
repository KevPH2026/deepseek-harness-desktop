# @deepseek-ai/dsh-host-plugin-marketplace

[English](README.md) | 中文

桌面插件市场的 Host 数据层。`PluginMarketplaceGateway` 在 `pluginMarketplace` 命名空间下发布五个生成式直接 Remote：`catalog`、`validateCatalogItem`、`prepareImport`、`confirmImport` 和 `resources`。

`catalog` 通过 GitHub 仓库搜索查询公开的 `dsh-plugin` topic，保存一份经过 schema 校验的持久快照，后续检查发送 ETag，并执行一小时新鲜度窗口与一分钟最短刷新间隔。网络或限流失败时回退到最近的持久快照；没有快照时返回明确的空目录/离线状态。搜索与分类过滤在有上限的缓存上完成。topic 命中只代表发现线索，不代表仓库可安装、可信或经过审计。

分类包括 `design`、`coding`、`writing`、`model-provider`、`gateway` 和 `other`。远端条目默认使用确定性的 topic/文本启发式；只有内置人工复核目录提供可独立核验的证据时才会覆盖。Sponsor、合作伙伴、快速配置或额度声明只能来自该复核目录；目录默认为空。快照另带少量由服务商官方文档支持的 `publicOffers`。这些是公开方案事实，不是赞助、合作伙伴、权益或保证。

每个 topic 条目初始都是 `installability: unknown`。`validateCatalogItem` 是有上限的选中条目操作：同一时间只运行一次校验，先把默认分支解析为 commit SHA，再读取该 SHA 下的根 `package.json`，要求存在 `dsh.bundle.patch` 声明，并验证固定 revision 的 patch 目标。结论与固定来源缓存 24 小时。100 条列表不会扇出校验请求，无效或暂不可验证的条目不会被标成可安装。

`prepareImport` 接受用户明确选择的 GitHub、npm registry 或绝对本地目录来源。目录来源必须先通过固定 revision 的 bundle 校验；自定义 GitHub 来源仍只是风险预览，不会升级为目录已验证。该方法会规范化来源、校验本地 `package.json`，并返回一个短时有效、仅供展示的命令计划及风险，包括第三方代码、安装脚本、联网、未固定 revision 与重启要求。它不会运行命令，也不会修改 profile。

本构建中的 `confirmImport` 有意保持 fail-closed，始终返回 `installation-disabled`。该包不包含子进程安装路径。若要启用安装，必须在用户明确授权第三方安装脚本执行风险后另行变更；未来实现必须通过受监管子进程复用官方 `dsh plugin --profile web add ...` 命令，并保留两阶段确认。

`resources` 返回官方创作/发布文档链接和只读复制型起步模板。它不会自行写入项目，也不会自行打开外部 URL。

## 模型体验

无，因为本 Host-only 服务不注册工具、提示词、Provider 或模型可见消息。

#### KV Cache 影响

无；市场快照与导入预览不会进入模型输入。

## 已知限制与后续工作

- 只缓存 GitHub topic 按 star 排序的前 100 条。该 topic 当前包含无关或不完整仓库，因此 UI 必须保留“未核验”标识。
- 受 GitHub 匿名 API 限制。服务不接受浏览器传入的 token 或 endpoint。
- 导入执行尚未启用。预览 token 只证明用户看过计划，并不能让来源变安全。
- 公开服务商方案可能在 `lastVerified` 日期之后变化；依赖额度或资格前，用户必须查看所链接的官方来源。
