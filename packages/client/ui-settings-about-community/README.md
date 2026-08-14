# @deepseek-ai/dsh-client-ui-settings-about-community

English | [中文](README.zh.md)

Static **About & Community** page for Web Settings in the unofficial DeepSeek Harness Desktop community edition. The browser plugin registers one localized `settings.section` contribution with id `about-community`, ordered after the feature-owned settings pages. It makes the product boundary, upstream project, community maintainer, source repository, releases, and feedback route discoverable without adding a Host service or reading user configuration.

The page links to the upstream [`deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness) project, community maintainer [`KevPH2026`](https://github.com/KevPH2026), and the community desktop repository's [source](https://github.com/KevPH2026/deepseek-harness-desktop), [releases](https://github.com/KevPH2026/deepseek-harness-desktop/releases), and [issue form](https://github.com/KevPH2026/deepseek-harness-desktop/issues/new/choose). It explicitly states that the desktop app is unofficial and does not imply DeepSeek endorsement. Links open in a new browser context with opener access disabled.

The registration uses `ctx.slots.inject()`, so it follows late `settings.section` declaration, redeclaration, locale changes, and teardown without importing the Settings shell. The component receives only a bound translation function; it has no Remote, settings, credential, plugin-import, filesystem, or command-execution face.

## Model Experience

None, as this package only presents static product attribution and community links in browser Settings.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- The page intentionally omits a hard-coded application version because the browser client currently has no version service; the Releases link is the durable source of published version information.
- External destinations require network access and are maintained by their respective GitHub accounts.
