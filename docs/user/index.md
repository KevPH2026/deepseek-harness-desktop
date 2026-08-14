---
layout: home
hero:
  name: DeepSeek Harness Desktop
  text: From agent conversation to finished work
  tagline: A community macOS workspace for coding, tools, smart media generation, and scenario-based plugins.
  image:
    src: /favicon.svg
    alt: DeepSeek Harness icon
  actions:
    - theme: brand
      text: View releases
      link: https://github.com/KevPH2026/deepseek-harness-desktop/releases
    - theme: alt
      text: Star on GitHub
      link: https://github.com/KevPH2026/deepseek-harness-desktop
features:
  - icon: 🧭
    title: Agent workspace
    details: Keep files, tools, approvals, sessions, and execution in one focused desktop app.
  - icon: 🎨
    title: Smart multimodal tools
    details: Let the agent request configured image or video generation only when the deliverable needs it.
  - icon: 🧩
    title: Community plugins
    details: Discover by scenario, inspect trust signals, validate selected repositories, and review import risks while installation remains disabled.
  - icon: 🔄
    title: Release-aware updates
    details: Read release notes and choose when a signed GitHub Release is downloaded and installed.
---

# DeepSeek Harness Desktop

English | [中文](index.zh.md)

![DeepSeek Harness Desktop showing the source-aware community plugin marketplace](deepseek-harness-desktop-plugin-marketplace.zh.png)

## Your agent should have a real workspace

DeepSeek Harness Desktop packages the complete Harness Web experience inside a supervised macOS application. It keeps the plugin-based architecture, model flexibility, tool execution, sessions, approvals, and sandbox controls of upstream Harness while adding desktop lifecycle, community discovery, configurable media generation, and a release channel people can understand.

## Built for work that crosses formats

Code, research, writing, images, and video often belong to the same deliverable. Configure the providers you trust, keep approval-before-spend enabled, and the agent can select `generate_image` or `generate_video` when media materially improves the result. Generated artifacts appear as dedicated result cards instead of disappearing into raw tool output.

## Extend by scenario, with trust visible

The plugin marketplace organizes community projects for design, programming, writing, model providers, gateways, and other workflows. Discovery starts from the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic. Only a selected repository that passes pinned manifest and patch-target validation is labeled compatible; compatibility does not enable installation. The beta accepts GitHub, npm, and local source drafts for risk review, but does not execute imports.

## Updates that follow releases, not noise

The app checks signed [GitHub Releases](https://github.com/KevPH2026/deepseek-harness-desktop/releases), not every commit. A new version shows its release notes first; downloading and installing remain user decisions. The same app menu exposes the current version, update check, release history, author attribution, and feedback entry.

## Start with the source beta

The first packaged target is Apple Silicon macOS. Until a Developer ID signed and notarized build is published, run or package the beta from source:

```sh
git clone https://github.com/KevPH2026/deepseek-harness-desktop.git
cd deepseek-harness-desktop
pnpm install
npm run desktop:dev
```

Continue with the [Web workspace quickstart](guide/index.md), [configure a model provider](guide/providers.md), or [learn how plugins are packaged and installed](develop/basic/publish.md).

## Community edition, clear attribution

This project is maintained by [@KevPH2026](https://github.com/KevPH2026) and is not an official DeepSeek desktop product. It is based on the open-source [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) project; the original DeepSeek copyright notice remains intact. Code is distributed under the [MIT License](../../LICENSE), with bundled licenses recorded in [Third-Party Notices](../../THIRD_PARTY_NOTICES.md).
