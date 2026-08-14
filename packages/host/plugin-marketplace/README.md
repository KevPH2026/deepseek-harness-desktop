# @deepseek-ai/dsh-host-plugin-marketplace

English | [中文](README.zh.md)

Host data layer for the desktop plugin marketplace. `PluginMarketplaceGateway` publishes five generated direct Remotes under `pluginMarketplace`: `catalog`, `validateCatalogItem`, `prepareImport`, `confirmImport`, and `resources`.

`catalog` discovers repositories by querying GitHub repository search for the public `dsh-plugin` topic, keeps one schema-validated durable snapshot, sends an ETag on later checks, and enforces a one-hour freshness window plus a one-minute minimum refresh interval. A network or rate-limit failure falls back to the last durable snapshot; without one it returns an explicit empty/offline state. Search and category filtering happen over the bounded cache. Topic membership is only discovery evidence: it never means a repository is installable, trustworthy, or audited.

Categories are `design`, `coding`, `writing`, `model-provider`, `gateway`, and `other`. Remote rows use deterministic topic/text heuristics unless the bundled reviewed catalog supplies independently verifiable evidence. Sponsor, partner, quick-config, or credit claims can only come from that reviewed catalog; it is empty by default. Separately, the snapshot carries a small `publicOffers` list backed by official provider documentation. Those rows are public-plan facts, never sponsors, partners, entitlements, or guarantees.

Every topic row begins with `installability: unknown`. `validateCatalogItem` is a bounded, selected-row operation: only one validation runs at a time, it resolves the default branch to a commit SHA, reads the root `package.json` at that SHA, requires a `dsh.bundle.patch` declaration, and verifies the pinned patch target. The verdict and pinned source are cached for 24 hours. The 100-row listing never fans out validation requests, and an invalid or unavailable row is never presented as installable.

`prepareImport` accepts one explicit GitHub, npm-registry, or absolute local-directory source. A catalog source must first pass the pinned bundle validation; a custom GitHub source remains a risk preview and is never promoted to catalog-validated. The method normalizes the source, validates a local `package.json`, and returns a short-lived display-only command plan plus risks including third-party code, install scripts, network access, unpinned revisions, and restart requirements. It does not run a command or modify a profile.

`confirmImport` is intentionally fail-closed in this build and always returns `installation-disabled`. The package contains no subprocess installation path. Enabling installation requires a separate change after explicit authorization of third-party install-script execution; that future implementation must reuse the official `dsh plugin --profile web add ...` command through the managed subprocess seam and retain the two-phase confirmation.

`resources` returns official authoring/publishing links and a copy-only starter template. It never writes a project or opens an external URL itself.

## Model Experience

None, as this Host-only service registers no tool, prompt, provider, or model-visible message.

#### KV Cache effect

None; marketplace snapshots and import previews are not part of model input.

## Known Limitations and Deferred Work

- Only the first 100 GitHub topic results sorted by stars are cached. The topic currently contains unrelated or incomplete repositories, so the UI must retain the unverified label.
- Anonymous GitHub API limits apply. The service does not accept a browser-supplied token or endpoint.
- Import execution is disabled. Preview tokens prove only a user-reviewed plan and do not make a source safe.
- Public provider-plan facts can change after their `lastVerified` date; users must follow the linked official source before relying on limits or eligibility.
