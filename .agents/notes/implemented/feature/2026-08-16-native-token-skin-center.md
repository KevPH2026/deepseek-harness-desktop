# Agent Note: Native token skin center

Status: implemented

English | [中文](2026-08-16-native-token-skin-center.zh.md)

## Problem

The Web client offered Light, Dark, and System as base display modes but no product-owned visual variants. A user who wanted a distinct palette had to rely on the low-level in-process theme extension point. Installing an arbitrary repository from a community discovery page would add code and asset provenance, compatibility, and lifecycle questions that the existing theme registry does not answer. A runtime-only palette would also flash the base theme before the Client plugin tree restored the saved choice.

## Decision

`@deepseek-ai/dsh-client-ui-theme` keeps `light`, `dark`, and `system` as the base display modes and adds three persisted built-in skin preferences: `deep-sea`, `aurora-night`, and `warm-paper`. Deep Sea Blue and Aurora Night resolve to the dark color scheme; Warm Paper resolves to the light color scheme. `system` remains the default and Restore default selects it. This extends the preference list described by the earlier [Client Settings, Locale, and Theme layering note](../../proposed/architecture/2026-07-25-client-settings-locale-theme.md) without moving DOM ownership out of ui-layout.

The three skins are original definitions in `packages/client/ui-theme/src/builtin-themes.ts`. Each definition is a frozen map of semantic `--dsw-*` token values with no DOM code, network request, font, image, stylesheet import, or executable asset. A shared required-token list covers the application surfaces, borders, labels, business accents, interactions, markdown surfaces, scrollbars, overlays, and sidebar-specific aliases that make up a coherent skin. Base design-platform tokens continue to supply every semantic value outside that owned set, including error, warning, and success colors.

The Host schema accepts all six built-in preference ids, so the existing settings scope persists a skin through the same revisioned path as the base modes. ThemeRuntime registers the two base definitions and three skin definitions at construction and can immediately resolve a persisted skin. Dynamic ids added through `register()` remain process-local and cannot shadow a built-in id or enter the Host schema, preserving the persistence boundary from the [Host-backed Web preferences note](../bug-fix/2026-08-06-host-backed-web-preferences.md).

The Appearance row presents two labelled groups: three display-mode controls and three skin cards. Each skin card shows four honest palette swatches derived from its base, raised-surface, brand, and primary-text tokens; it does not imitate an application screenshot. Buttons expose their selection through `aria-pressed`, group labels name both collections, keyboard focus remains visible, and the layout collapses the gallery to one column on a narrow viewport.

The Host bootstrap and ThemeRuntime read the same frozen skin definitions. Before the shell mount, the bootstrap applies the selected skin's color scheme, dark-theme attribute, and every skin token. ui-layout remains the later DOM authority and continues to drive browser color metadata from the resolved presentation as recorded by the [resolved theme color metadata note](2026-08-06-resolved-theme-color-metadata.md).

## Community provenance boundary

The implementation reviewed the official repository, official [Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions), and the community [dsh-plugin topic](https://github.com/topics/dsh-plugin). That review did not identify a separately maintained theme or skin package that could be verified as installable and compatible with the current theme contract. GitHub topic membership is discovery metadata, not official endorsement. No community package, palette, artwork, dependency, or branding asset is copied into these skins.

## Verification

Focused tests pin the expanded Host schema, durable skin adoption and writes, built-in registry order, duplicate protection, dynamic registration and disposal, switching, and restoration. Bootstrap tests execute the emitted script before the shell mount and require every selected skin token plus the matching color scheme. Component tests cover the labelled groups, `aria-pressed` state, palette-only swatches, deferred snapshot selection, Restore default, and narrow-layout CSS. Skin integrity tests require the complete token-name set, reject URL, import, font, image, data-URI, and markup payloads, and enforce WCAG contrast for primary text, secondary text, accent-on-base, and foreground-on-accent pairs.

## Alternatives considered

**Import a theme discovered under `dsh-plugin`.** The discovery mechanism does not prove maintainer identity, license compatibility, manifest shape, current contract compatibility, or safe runtime behavior. Shipping an unverified package would turn a visual preference into an executable supply-chain decision, so the built-in skins use original token data only.

**Persist display mode and skin as two independent settings.** That model permits combinations a fixed-scheme skin has not been designed or contrast-tested for and requires a second migration and resolution rule. A built-in skin is therefore one closed preference with an explicit light or dark scheme; selecting Light, Dark, or System exits the skin.

**Use miniature application-window artwork as the card preview.** A fabricated interface thumbnail implies a screenshot or layout result that the palette alone cannot guarantee. Four labelled-context palette swatches truthfully preview the owned color data without taking an image dependency.

**Apply skin tokens only after ThemeRuntime activates.** This keeps the Host response smaller but produces a visible base-palette frame on reload. Sharing the frozen definitions with the existing synchronous bootstrap keeps the first frame and live runtime consistent.

## Consequences

Users gain three durable, accessible visual choices without installing code or granting a theme network access. The same definitions drive the settings swatches, pre-plugin frame, and live runtime, reducing drift. Each skin has a fixed scheme: operating-system changes do not alter an active skin, and choosing a base display mode intentionally leaves it. The larger inline bootstrap carries a bounded map of product-owned strings on each index response.

This decision does not create a community theme marketplace or certify repositories under a GitHub topic. Supporting installable third-party skins later requires an explicit trust model for provenance, license, integrity, manifest compatibility, review, update, and removal; until then, `register()` and `overrideTokens()` remain trusted-composition extension points.
