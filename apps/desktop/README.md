# DeepSeek Harness Desktop

English | [中文](README.zh.md)

> **Unofficial community desktop wrapper.** This is not an official DeepSeek desktop product. The wrapper is maintained by [@KevPH2026](https://github.com/KevPH2026) and is based on the upstream [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) project.

Electron desktop shell for the existing DeepSeek Harness Web workspace. The desktop process starts one supervised Harness child on an operating-system-assigned `127.0.0.1` port, opens that exact origin in a locked-down renderer, and stops the child before the app exits.

DeepSeek Harness retains its original `Copyright (c) 2026 DeepSeek` notice. This community wrapper is distributed under the upstream [MIT License](../../LICENSE); bundled dependencies and their licenses are listed in [Third-Party Notices](../../THIRD_PARTY_NOTICES.md).

Community source, feedback, and desktop releases live at
[`KevPH2026/deepseek-harness-desktop`](https://github.com/KevPH2026/deepseek-harness-desktop).
The upstream DeepSeek Harness link remains separate in About and Help.

## Development

Build the Harness host packages, client bundles, Web frontend, and desktop main process from the repository root:

```sh
pnpm install
pnpm run desktop:dev
```

Installing workspace dependencies or packaging fetches the Electron runtime. A packaged app does not download Electron on first launch. Desktop data is isolated under Electron's `userData` directory instead of reusing the command-line Harness home.

The macOS icon is generated without changing the artwork from the repository's
official `apps/web/public/favicon.svg` asset:

```sh
npm run desktop:icon:mac
```

The command rasterizes the same SVG into Apple's required icon sizes and writes
`apps/desktop/build/icon.icns`.

## macOS packaging

Create a local unsigned Apple Silicon app directory:

```sh
npm run desktop:pack:mac
```

The app is written to
`apps/desktop/release/mac-arm64/DeepSeek Harness Desktop.app`.
The command then boots the packaged runtime, requests the Web entry both before
and after a three-second stability window, and requires a clean shutdown.

Create signed, notarized DMG and ZIP release artifacts:

```sh
npm run desktop:dist:mac
```

Release packaging requires a Developer ID Application identity and Apple notarization credentials. The local pack command explicitly disables identity selection and Hardened Runtime; it is a verification artifact, not a distributable release.

The builder is preconfigured for the public GitHub repository above. A signed
release must attach the DMG, ZIP, ZIP blockmap, and generated `latest-mac.yml`;
the ZIP and update metadata are required by the macOS updater. The current
workflow notarizes and staples the app, but the separate upload, notarization,
and stapling of the outer DMG is still a release prerequisite. No pre-staple
DMG blockmap is emitted because stapling changes the container bytes. Local
commands always pass `--publish never`, and no binary Release should be created
until the outer-DMG step, runtime smoke, and artifact checks all pass.

## Updates and feedback

A Developer ID-signed installed app checks the GitHub Release channel at startup
and every six hours. It asks before downloading an available update, then asks
again before restarting to install it. The native updater validates the macOS
code-signing requirement before installation, and the existing desktop shutdown
coordinator stops the Harness process tree before the app exits.

Development builds and local ad-hoc beta packages do not contact the update
feed. Signed beta builds follow the beta channel and may advance to a newer beta
or stable release; stable builds do not opt into pre-releases. Downgrades remain
disabled. The download confirmation shows a plain-text, length-bounded summary
of the release notes. The native menu shows the current version and provides
**Check for Updates**,
[Release Notes](https://github.com/KevPH2026/deepseek-harness-desktop/releases),
and [Send Feedback](https://github.com/KevPH2026/deepseek-harness-desktop/issues/new/choose).

The initial bilingual desktop release notes are in the single source of truth,
[CHANGELOG.md](CHANGELOG.md).

## Security and lifecycle

The renderer runs with Node integration disabled, context isolation enabled, the Chromium sandbox enabled, and Web security enabled. Navigation stays on the assigned Harness origin; HTTP and HTTPS links open through the operating-system browser, while every other protocol is denied.

The Web carrier remains loopback-only. The desktop process does not expose generic filesystem, shell, fetch, or IPC primitives to the renderer. Native directory picking and path opening continue through the existing pathless Host APIs.

The final macOS bundle disables arbitrary App Transport Security loads while
retaining local networking and explicit `localhost` / `127.0.0.1` exceptions.

Loopback transport is a same-user trust boundary, not authentication against
other native processes running under the logged-in account. Do not run an
untrusted local process alongside a sensitive Harness session.

Closing the last window on macOS keeps the Harness process available for Dock reactivation. Explicit Quit sends `SIGTERM`, waits up to eight seconds for complete exit, then sends `SIGKILL` only when graceful teardown did not reach quiescence.
An early Quit also cancels a pending launch, and POSIX teardown signals the
owned process group so tool subprocesses do not outlive the desktop app.

The supervised Node-mode child starts with `--expose-internals`, which the
current Harness Web profile requires for its HMR service on macOS.

The desktop manifest owns the explicit, peer-closed Harness runtime root.
`npm run desktop:verify-runtime` must pass before deployment; automatic peer
installation stays disabled so a missing packaged peer fails the build instead
of appearing only on a user's machine. The staging pass also restores pnpm's
legacy hoists and materializes vendored `link:` packages, leaving no package
symlink back into the source checkout.

The first package keeps the Harness runtime outside ASAR because profile fallback links, dynamic plugins, workers, native modules, and the `node-pty` helper require real filesystem paths. A future `file://` renderer needs a complete IPC carrier for unary calls, streams, client modules, and cancellation; the Web carrier is retained until that transport exists.
