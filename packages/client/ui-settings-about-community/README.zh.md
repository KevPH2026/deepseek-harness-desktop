# @deepseek-ai/dsh-client-ui-settings-about-community

[English](README.md) | 中文

非官方 DeepSeek Harness Desktop 社区版 Web 设置中的静态**关于与社区**页面。浏览器插件注册一个本地化的 `settings.section` 贡献，id 为 `about-community`，排在各功能设置页之后。它让产品边界、上游项目、社区维护者、源码仓库、版本发布与反馈渠道清晰可见，同时不新增 Host 服务，也不读取用户配置。

页面链接到上游 [`deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness) 项目、社区维护者 [`KevPH2026`](https://github.com/KevPH2026)，以及社区桌面版仓库的[源码](https://github.com/KevPH2026/deepseek-harness-desktop)、[版本发布](https://github.com/KevPH2026/deepseek-harness-desktop/releases)和[问题表单](https://github.com/KevPH2026/deepseek-harness-desktop/issues/new/choose)。页面明确说明桌面应用是非官方版本，不代表 DeepSeek 官方背书。所有链接都会在新的浏览器上下文中打开，并禁用 opener 访问。

注册使用 `ctx.slots.inject()`，因此能跟随 `settings.section` 的延迟声明、重新声明、本地化变化与 teardown，而无需 import 设置外壳。组件只接收一个已绑定的翻译函数；它不具备 Remote、设置、凭据、插件导入、文件系统或命令执行接口。

## 模型体验

无，因为本包只在浏览器设置中呈现静态产品归属和社区链接。

#### KV Cache 影响

无；本包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- 页面有意不硬编码应用版本，因为浏览器客户端目前没有版本服务；“版本与更新”链接是已发布版本信息的持久来源。
- 外部目的地需要网络连接，并由相应的 GitHub 账户维护。
