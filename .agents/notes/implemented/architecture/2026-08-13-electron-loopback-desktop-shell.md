# Agent Note: Electron desktop shell supervises the loopback Web carrier

Status: implemented

English | [中文](2026-08-13-electron-loopback-desktop-shell.zh.md)

## Problem

Harness has a complete browser workspace and Host runtime but no desktop application lifecycle. The Web UI depends on an injected boot manifest, HTTP RPC, WebSocket downlinks, and dynamically served client bundles, so loading its built index through `file://` does not produce a functional application. The source describes an Electron IPC carrier as the intended native transport, but the client connection and module registries still instantiate Web transports and Web-server routes directly.

## Decision

`apps/desktop` ships an Electron main process that supervises the built `dsh web` entry in a child Electron process running as Node. The child starts with `--expose-internals`, which the current Web profile's HMR service requires. Harness binds to an operating-system-assigned loopback port and remains the sole owner of the existing HTTP, WebSocket, module, directory-picker, settings, credentials, and session protocols. Electron loads only the exact origin parsed from the Host readiness line.

The child receives an app-owned `DSH_HOME`, so desktop state is isolated from command-line profiles. The desktop app retains the child across ordinary macOS window closure, recreates the window on Dock activation, and performs bounded process-group teardown on explicit Quit. Quitting during startup cancels the pending launch. It keeps stdout and stderr in an owner-only application log and reports startup or unexpected-exit failures through a native error dialog.

The renderer has no preload bridge. Node integration is disabled, context isolation, the Chromium sandbox, and Web security are enabled, same-origin navigation is allowed, HTTP and HTTPS links are handed to the operating-system browser, and every other navigation protocol is denied.

Packaging uses Electron Builder over a symlink-free pnpm deploy stage. The deploy root explicitly supplies all required workspace peers; a preparation pass restores legacy hoists and materializes vendored `link:` packages. The first package keeps the application outside ASAR because Harness creates profile fallback links to installed package directories and loads plugins, workers, native modules, and the `node-pty` spawn helper from real paths.

## Alternatives considered

- **Load the current Vite output through `file://` and bridge only `fetch`**: rejected because the Web server injects the boot manifest and owns plugin bundle routes and WebSocket streams; one Fetch bridge would bypass connection interceptors and leave client module loading unresolved.
- **Import `runProfile` directly into the Electron main process**: rejected for the first package because the CLI does not export that lifecycle as a package subpath, and it installs process-wide signal and fatal handlers. A supervised child preserves the published entry and gives Electron unambiguous process ownership.
- **Use Tauri with a Node sidecar**: rejected because Harness already requires Node and the sidecar would retain the same runtime and process-lifecycle work while adding a second desktop framework.
- **Package the runtime inside ASAR**: rejected because virtual archive paths conflict with the installation fallback, dynamic module resolution, workers, native modules, and executable helpers.

## Consequences

- The desktop app reuses the assembled and tested Web experience without forking UI behavior or wire contracts.
- Each launch uses a random loopback port and exposes no LAN listener, but the first transport still trusts other native processes running as the same logged-in user; it is not an in-process IPC authentication boundary.
- Explicit Quit waits for graceful shutdown and retains a force-kill fallback, while macOS window closure keeps background state alive.
- A future no-port desktop transport remains a separate architectural change: it must provide the complete connection dispatcher, unary and stream transport, cancellation, and client-module loading before removing the Web carrier.
