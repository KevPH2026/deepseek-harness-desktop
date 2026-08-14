# Security policy / 安全政策

DeepSeek Harness Desktop is an unofficial community project. For vulnerabilities in the upstream Harness runtime, report through the upstream [DeepSeek Harness repository](https://github.com/deepseek-ai/deepseek-harness). For vulnerabilities introduced by this desktop wrapper, its updater, media generation, or plugin marketplace, use this repository's private vulnerability reporting instead of a public Issue.

DeepSeek Harness Desktop 是非官方社区项目。上游 Harness 运行时中的漏洞请通过上游 [DeepSeek Harness 仓库](https://github.com/deepseek-ai/deepseek-harness)报告；本桌面封装、更新器、媒体生成或插件市场引入的漏洞，请使用本仓库的私密漏洞报告功能，不要创建公开 Issue。

## What to include / 报告内容

- Affected version and macOS version / 受影响版本与 macOS 版本
- Reproduction steps and realistic impact / 复现步骤与实际影响
- Whether untrusted plugins, local processes, or provider endpoints are involved / 是否涉及不受信任插件、本机进程或提供方端点
- A safe proof of concept with secrets and personal paths removed / 已移除密钥与个人路径的安全概念验证

## Trust boundaries / 信任边界

- The loopback Web carrier is restricted to `127.0.0.1`, but it is a same-user trust boundary rather than authentication against every local process. / 回环 Web 传输仅监听 `127.0.0.1`，但它采用同一用户信任边界，并不能认证所有本机进程。
- Third-party plugins execute code outside the agent sandbox. Discovery metadata is not a security review, and every installation requires explicit user approval. / 第三方插件会在 agent 沙箱之外执行代码；发现信息不等于安全审查，每次安装都必须获得用户明确批准。
- Media and model credentials remain subject to the configured provider and local same-user access. Never include credentials in a report. / 媒体与模型凭据仍受对应提供方及本机同一用户访问边界约束；报告中绝不能包含凭据。
- Automatic installation is enabled only for signed release builds after the downloaded update passes the platform update verifier. / 只有已签名的发布版本才会启用自动安装，并且下载的更新必须通过平台更新校验。

Public discussions may begin after a fix or mitigation is available. Security reports do not create a bounty or payment commitment. / 在修复或缓解措施可用后，可以公开讨论；安全报告不代表项目承诺漏洞奖金或付款。
