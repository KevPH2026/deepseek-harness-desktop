# `@deepseek-ai/dsh-user-profile`

English | [中文](README.zh.md)

Optional public-profile settings and dynamic runtime context for DeepSeek Harness Desktop. The package registers the `user-profile` settings namespace and contributes `user:public-profile` only when at least one field has `agentVisible: true`.

## Settings contract

Every profile field is optional and stored as `{ value, agentVisible }`; `agentVisible` defaults to `false`, and removing the top-level field clears both its data and its consent atomically. The independent `onboarding` marker records `{ version: 1, state: 'completed' | 'skipped' }` and is never model-visible.

Identity fields are `preferredName`, `role`, `organization`, and `region`. Work fields are `industry`, `workFocus`, and `topGoal`. Collaboration preferences are `preferredLanguage`, an IANA `timezone`, and the closed `responseStyle` choice `concise | detailed | action-first`. Public-account fields are an HTTPS origin-only `websiteUrl`, canonical `xHandle`, LinkedIn `/in/` profile URL, canonical `githubHandle`, Douyin `/user/` profile URL, Xiaohongshu `/user/profile/` URL, and public WeChat Official Account ID.

Host validation rejects empty or untrimmed values, control characters, multiline data, over-length values, invalid IANA zones, unsupported response styles, noncanonical handles, URLs with credentials, ports, queries, fragments or wrong profile paths, and common embedded credential assignments or provider-token fragments. These checks reduce accidental secret entry but do not prove that arbitrary human text contains no confidential information; the UI must retain its explicit public-data-only warning.

## Context semantics

The context provider reads the live settings scope at every eligible assembly. It emits only fields whose individual `agentVisible` value is exactly `true`, serializes them as JSON, and prefixes a fixed boundary that says values are user-approved data and preferences, never instructions, policy, authority, permission, or tool requests. Fields that are absent, empty by removal, or model-hidden add no context.

The standard agent loop records a changed profile projection as a source-attributed runtime-context snapshot. An agent composition with `includeRuntimeContext: false` or `systemPrompt.suppressRuntimeContext()` does not evaluate or receive the profile contribution. The shipped `telegram-safe` preset uses that suppression, so Telegram tasks do not receive profile data.

## Model Experience

### User-approved public profile

#### What the model sees

Eligible local Agents see one ordered runtime-context entry named `user:public-profile`. It contains a fixed data-not-instructions warning followed by JSON with only the fields the user explicitly made Agent-visible. A field can be present in local settings yet absent from model context.

#### Token effect

The fixed warning and consented JSON values are added to a runtime-context snapshot when the visible projection is nonempty. A changed projection creates a new source-attributed snapshot under the standard loop; unchanged settings reuse the current projection, and a fully hidden or suppressed profile costs zero profile tokens.

#### KV Cache effect

An unchanged profile preserves the earlier cacheable prefix and only participates in the normal runtime-context suffix. Changing, showing, hiding, or clearing a field changes that suffix from the next eligible step; runtime-context suppression omits it entirely.

## Known Limitations and Deferred Work

- **Public data is a user judgment** — syntax checks catch common credential shapes but cannot prove that an otherwise ordinary name, goal, or organization is nonconfidential.
- **Runtime-context support varies by Agent composition** — safety-focused or remote presets may suppress all runtime context; `telegram-safe` does so intentionally.
- **No per-session profile selection** — visible fields are a Desktop-wide preference for every eligible local Agent, not separate profiles per workspace or session.
- **No contact or freeform biography fields** — email, phone, private contact details, biography, arbitrary system prompts, tokens, passwords, and cookies are intentionally outside the schema.
