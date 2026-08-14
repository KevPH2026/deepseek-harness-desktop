# Agent Note: Desktop community surfaces stay evidence-bound and release-gated

Status: implemented

English | [中文](2026-08-14-desktop-community-release-surfaces.zh.md)

## Problem

The community desktop edition needs product features beyond a window around the Web workspace: agent-selected image and video generation, community plugin discovery, provider offers, native version and feedback controls, and an update channel. Each surface crosses a trust or cost boundary. Media calls can spend money, topic membership does not prove that a repository is a Harness plugin, third-party installation executes code, public free tiers are not sponsorships, and an unsigned download must never be presented as a safe automatic update.

The public repository also inherits upstream workflows designed for DeepSeek's secrets, npm release family, and self-hosted runners. Running those unchanged in a community fork would produce false failures or misleading publication paths.

## Decision

Media generation is an optional Host/client package with separate image and video tools. Provider configuration and credentials stay Host-owned, tools are disabled until configured, and the default execution policy asks before a paid call. Generated files use dedicated attachment or artifact paths and media result cards rather than placing unsupported image blocks in the next DeepSeek model request.

The plugin marketplace is a source-aware catalog. It discovers one bounded page from GitHub's `dsh-plugin` topic, caches results, exposes source and license facts, and validates only a user-selected repository. Validation resolves the default branch to a commit, reads the pinned `package.json`, requires `dsh.bundle.patch`, and verifies the pinned patch target before labeling the item compatible. Topic membership remains unverified discovery. GitHub, npm, and local source forms are risk previews only: this build contains no installer subprocess, and confirmation fails closed with `installation-disabled`.

Public provider offers require an official source, eligibility, terms, an application URL, and a verification date. They are rendered separately from a verified-partner catalog, which starts empty. No public plan is labeled as a sponsor or guaranteed entitlement.

The native application menu owns About attribution, the installed version, manual update checks, release notes, and feedback. The updater remains offline for development and ad-hoc packages and activates only after strict Developer ID verification. It follows GitHub Releases, never arbitrary commits, sanitizes and bounds release text, disables automatic download and install-on-quit, and asks before both download and restart.

Packaging pins the desktop icon to the exact upstream Web favicon bytes and records the source and output hashes. Local package commands always use `--publish never`. The Desktop Release workflow requires Apple credentials, builds arm64 on an Apple Silicon runner, and verifies version, signature, Team ID, Gatekeeper assessment, app notarization ticket, ATS, icon, update feed, and artifact names before GitHub Release creation. Missing credentials fail closed; the workflow never publishes an unsigned fallback. Outer-DMG notarization is kept as a release prerequisite that still needs explicit authorization to send that container to Apple's notarization service.

The community fork has its own keyless Desktop CI and bilingual GitHub Pages site. Upstream npm publication, real-API, sandbox, Landlock, and self-hosted default-branch jobs are restricted to `deepseek-ai/deepseek-harness`; they are not reinterpreted as community release evidence.

## Alternatives considered

- **Treat every topic result as installable.** Rejected because GitHub topics are self-assigned and currently include unrelated repositories.
- **Install directly after one click.** Rejected for this beta because Git, registry, and local packages can execute installation scripts outside the agent sandbox; discovery and execution require separate authority.
- **List provider free tiers as sponsors.** Rejected because a public plan does not prove a commercial relationship or guarantee that a user qualifies.
- **Enable updates in all packaged builds.** Rejected because ad-hoc builds do not establish the signing identity needed for a trusted replacement.
- **Let Electron Builder publish while packaging.** Rejected because artifact creation must complete and pass independent gates before any external Release mutation.

## Consequences

- The beta delivers useful media, discovery, offer, version, and feedback surfaces while keeping code execution and paid calls explicit.
- A compatible marketplace badge means only that the pinned bundle shape was validated; it is not a security audit or permission to install.
- Signed GitHub Releases can support in-app update prompts, while local unsigned builds remain useful for verification without becoming distribution artifacts.
- Public source and Pages publication can proceed independently, but binary distribution remains blocked until Apple signing, notarization, and final update-install evidence are available.
