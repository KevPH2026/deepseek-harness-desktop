# Agent Note: Optional public profile and field-level Agent consent

Status: implemented

English | [中文](2026-08-16-optional-public-profile.zh.md)

## Problem

Desktop onboarding needs enough optional user context to personalize local Agent work without turning a biography, social login, or arbitrary prompt into an implicit authority channel. The same data must remain editable and clearable after onboarding, and model-provider credentials must stay in their existing dedicated flow.

## Decision

**The Host owns one strict `user-profile` data schema.** Every public value is optional and wrapped with its own `agentVisible` consent, which defaults false. Work text remains single-line and bounded; response style is a closed enum; time zone is IANA; social identities are canonical handles or exact public profile URL forms. Contact details, biography, arbitrary system instructions, passwords, tokens, cookies, and API keys have no schema field.

**Profile context is data, not a prompt section.** `@deepseek-ai/dsh-user-profile` contributes one dynamic `systemPrompt.context` entry only when a field is explicitly visible. JSON serialization and a fixed anti-instruction frame make the trust boundary explicit. The standard loop owns source-attributed history snapshots. An Agent that suppresses runtime context receives nothing; the shipped `telegram-safe` preset therefore receives no profile data.

**The browser owns a loopback-only three-step onboarding and a durable Settings page.** `public-profile` runs at order `-50`, between the welcome notice and the existing DeepSeek model onboarding. It collects identity, work preferences, then public accounts through three optional screens and commits only once on the final step. Skip records only a versioned marker. The `profile` Settings page at order `5` supports later edits, empty-field removal, field-level consent, and confirmed clear-all without reopening onboarding.

## Consequences

Fresh local Desktop users may personalize Harness before configuring a model, while users who want no profile can skip immediately. Saving a field does not expose it to a model until its independent consent is on. Clearing a field removes its data and consent together. Remote browsers cannot reach the surface, safety-focused Agent presets may omit it, and credentials continue through their existing settings and Credentials API boundaries.

## Alternatives considered

**Reuse persona or a freeform system prompt.** Rejected because data would become instruction authority and would be difficult to validate or revoke field by field.

**Store a single global visibility switch.** Rejected because consent for a public handle does not imply consent for role, goals, language, or region.

**Put model setup into the new wizard.** Rejected because the existing DeepSeek onboarding already owns provider readiness and credential handling; duplicating it would create two sources of truth.
