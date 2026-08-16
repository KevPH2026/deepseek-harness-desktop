# `@deepseek-ai/dsh-client-ui-settings-profile`

English | [中文](README.zh.md)

Loopback-only Profile Settings and optional first-run onboarding for DeepSeek Harness Desktop. A non-loopback browser receives neither the `profile` Settings page nor the `public-profile` onboarding contribution.

The onboarding step registers at order `-50`, after the product welcome notice at `-100` and before the existing official DeepSeek model step at `0`. It is a lightweight three-step flow: identity; work direction and collaboration preferences; then public social profiles and per-field Agent consent. Each step accepts an empty form, the first and final steps offer “Skip for now,” and only the final save performs one atomic settings mutation plus the durable completion marker. Skipping writes only the marker. Model credentials remain in the existing DeepSeek onboarding that follows.

If profile settings are unavailable, read-only, or fail to load, this onboarding step fails open for the current client session without writing a durable marker. Those states render no `OnboardingSurface`, so the application root never becomes inert behind a choice that cannot be persisted. A later blank session may try the optional step again after the Host becomes writable.

The dedicated Settings page registers id `profile` at order `5`. It exposes the same complete optional form, supports later editing, clears every individual field by saving it empty, and offers a confirmed clear-all action that retains the onboarding marker. Each consent checkbox starts off and is disabled while its field is empty. The page states that enabled fields are written into supported local Agent session history and that session exports may contain them. Turning consent off or clearing data prevents future runtime snapshots only; it does not retroactively delete existing session records. Safety-focused remote presets may omit the profile context.

The UI accepts X and GitHub handles or their public profile URLs and canonicalizes them to handles before mutation. Other social fields accept only their documented public HTTPS profile forms. Invalid local drafts never cross the Host settings API; the Host schema remains the authoritative validation boundary.

The UI repeatedly warns that profile fields are for public information only and must not contain passwords, API keys, tokens, cookies, private email addresses, or phone numbers. No credential field exists in this package, and the form neither calls nor replaces the Credentials API.

## Model Experience

### Local profile configuration

#### What the model sees

Nothing directly from this browser package. Onboarding, drafts, visibility checkboxes, save state, validation errors, and clear confirmation create no Session message, prompt section, context entry, or tool schema. The Host `@deepseek-ai/dsh-user-profile` package independently projects only persisted fields with explicit consent into supported runtime-context assemblies. Once an eligible local Agent records such a snapshot, its session history and exports may retain the consented value. Later disabling consent or clearing the field stops future projection; it does not erase prior session records.

#### Token effect

Zero directly. Form rendering and settings mutations make no provider request. A later eligible Agent step may pay for the Host-owned consented profile context documented by `@deepseek-ai/dsh-user-profile`.

#### KV Cache effect

No provider request is created by this package, so it neither creates nor invalidates a reusable prefix. A later saved profile change can alter the Host-owned runtime-context suffix at the next eligible Agent step.

## Known Limitations and Deferred Work

- **Desktop-local surface only** — remote browsers cannot view or edit profile data or its consent controls.
- **Three fixed onboarding steps** — the first release does not personalize which questions appear or estimate completion quality.
- **No avatar upload** — profile images and generated avatars are outside this slice; the UI uses no placeholder identity asset.
- **No credential storage** — social passwords, tokens, cookies, private contacts, and model keys must never be entered here.
- **No guarantee of remote propagation** — `telegram-safe` and other safety-focused presets may suppress runtime context and therefore omit every profile field.
