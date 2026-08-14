/**
 * Client-safe vocabulary for third-party plugin discovery and explicit import.
 * @module @deepseek-ai/dsh-host-plugin-marketplace/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Stable one-use confirmation identity minted by the Host. */
export type PluginMarketplaceConfirmationId = Branded<'PluginMarketplaceConfirmationId'>

/** Product categories offered by the marketplace surface. */
export type PluginMarketplaceCategory =
  | 'design'
  | 'coding'
  | 'writing'
  | 'model-provider'
  | 'gateway'
  | 'other'

/** Why a catalog row received its category. */
export type PluginMarketplaceCategorySource = 'verified-catalog' | 'topic-heuristic'

/** GitHub-topic observation backing one discovery row. */
export interface PluginMarketplaceDiscoverySource {
  readonly kind: 'github-topic'
  /** Human-verifiable topic or API URL. */
  readonly source: string
  /** ISO-8601 time at which the Host last verified the observation. */
  readonly lastVerified: string
}

/** Curated-catalog evidence. Its presence does not mean the code was audited. */
export interface PluginMarketplaceVerifiedSource {
  /** Stable entry id inside the bundled, reviewed catalog. */
  readonly catalogId: string
  /** Human-verifiable source for the curated metadata. */
  readonly source: string
  /** ISO-8601 time at which the curated metadata was last verified. */
  readonly lastVerified: string
}

/** Optional settings-page shortcut supplied only by the reviewed catalog. */
export interface PluginMarketplaceQuickConfig {
  readonly settingsNamespace: string
  readonly source: string
  readonly lastVerified: string
}

/** Sponsor or free-credit claim supplied only by the reviewed catalog. */
export interface PluginMarketplacePartnerOffer {
  readonly kind: 'sponsor' | 'free-credit'
  readonly label: string
  readonly url: string
  readonly terms: string
  readonly eligibility: string
  readonly source: string
  readonly lastVerified: string
}

/**
 * Independently verified public provider plan. This is deliberately not a
 * sponsor, partner, entitlement, or guaranteed credit.
 */
export interface PluginMarketplacePublicOffer {
  readonly id: string
  readonly kind: 'public-offer'
  readonly provider: string
  readonly title: string
  readonly summary: string
  readonly terms: string
  readonly eligibility: string
  readonly source: string
  readonly secondarySources?: readonly string[]
  readonly applyUrl: string
  /** Verification date in `YYYY-MM-DD` form. */
  readonly lastVerified: string
}

/** Selected-row installability, never inferred from topic membership. */
export type PluginMarketplaceInstallability = 'unknown' | 'validated' | 'invalid'

/** Pinned evidence collected by bounded, lazy validation. */
export interface PluginMarketplaceValidation {
  /** Pinned GitHub tree URL for human inspection. */
  readonly source: string
  readonly commitSha: string
  readonly lastVerified: string
  readonly packageName?: string
  readonly patchPath?: string
}

/** Why a pinned repository failed the minimum bundle-shape check. */
export type PluginMarketplaceValidationFailure =
  | 'manifest-missing'
  | 'manifest-invalid'
  | 'bundle-missing'
  | 'patch-path-invalid'
  | 'patch-missing'

/** One GitHub-topic discovery row. Topic membership alone is unverified. */
export interface PluginMarketplaceCatalogItem {
  /** Lower-cased `owner/repository`, stable across refreshes. */
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly category: PluginMarketplaceCategory
  readonly categorySource: PluginMarketplaceCategorySource
  readonly sourceKind: 'github'
  /** Normalized dsh/pnpm source such as `github:owner/repository`. */
  readonly sourceRef: string
  readonly sourceUrl: string
  readonly defaultBranch: string
  readonly updatedAt: string
  readonly stars: number
  readonly license?: string
  readonly discoveredFrom: PluginMarketplaceDiscoverySource
  /** Absent for an ordinary topic hit. */
  readonly verifiedSource?: PluginMarketplaceVerifiedSource
  /** Absent unless the reviewed catalog names a settings namespace. */
  readonly quickConfig?: PluginMarketplaceQuickConfig
  /** Empty unless reviewed catalog evidence backs every returned field. */
  readonly partnerOffers: readonly PluginMarketplacePartnerOffer[]
  readonly installability: PluginMarketplaceInstallability
  readonly validation?: PluginMarketplaceValidation
  readonly validationFailure?: PluginMarketplaceValidationFailure
}

/** Explicit lazy validation request for one selected discovery row. */
export interface PluginMarketplaceValidateCatalogItemRequest {
  readonly itemId: string
}

/** Admission and transient failures returned by selected-row validation. */
export type PluginMarketplaceValidateCatalogItemErrorCode =
  | 'catalog-item-not-found'
  | 'validation-busy'
  | 'validation-rate-limited'
  | 'validation-unavailable'

/** Selected-row validation failure kept on the Remote business-result channel. */
export interface PluginMarketplaceValidateCatalogItemError {
  /** Stable machine-readable failure code. */
  readonly code: PluginMarketplaceValidateCatalogItemErrorCode
  /** Human-readable explanation suitable for the marketplace UI. */
  readonly message: string
}

/** Selected-row validation verdict or explicit admission/transient failure. */
export type PluginMarketplaceValidateCatalogItemResult =
  | { readonly ok: true; readonly value: PluginMarketplaceCatalogItem }
  | { readonly ok: false; readonly error: PluginMarketplaceValidateCatalogItemError }

/** Server-side search/filter request. */
export interface PluginMarketplaceCatalogRequest {
  readonly query?: string
  readonly category?: PluginMarketplaceCategory
  /** Ask for a refresh; the Host still enforces its minimum interval/rate limit. */
  readonly refresh?: boolean
}

/** Degraded-catalog facts kept explicit instead of thrown away. */
export type PluginMarketplaceCatalogWarning =
  | 'offline-cache'
  | 'offline-no-cache'
  | 'rate-limited'
  | 'github-response-invalid'

/** A filtered view over the cached GitHub-topic snapshot. */
export interface PluginMarketplaceCatalogSnapshot {
  readonly status: 'fresh' | 'stale' | 'empty'
  readonly items: readonly PluginMarketplaceCatalogItem[]
  /** Official public-plan facts, separate from plugin rows and partner claims. */
  readonly publicOffers: readonly PluginMarketplacePublicOffer[]
  /** Time of the most recent full 200 response. */
  readonly fetchedAt?: number
  /** Time of the most recent successful 200/304 verification. */
  readonly checkedAt?: number
  readonly fromCache: boolean
  readonly nextRefreshAt: number
  readonly warning?: PluginMarketplaceCatalogWarning
}

/** Explicit source selected by the user for an import preview. */
export type PluginMarketplaceImportSource =
  | { readonly kind: 'catalog'; readonly itemId: string }
  | { readonly kind: 'github'; readonly repository: string; readonly ref?: string }
  | { readonly kind: 'npm'; readonly spec: string }
  | { readonly kind: 'local'; readonly path: string }

/** Hazards the user must acknowledge before the Host runs the official command. */
export type PluginMarketplaceImportRisk =
  | 'third-party-code'
  | 'install-scripts'
  | 'network-access'
  | 'unpinned-source'
  | 'unverified-source'
  | 'local-filesystem-access'
  | 'profile-restart-required'

/** Input to the non-executing import preview. */
export interface PluginMarketplacePrepareImportRequest {
  readonly source: PluginMarketplaceImportSource
}

/** Display-only rendering of the official command. */
export interface PluginMarketplaceCommandPreview {
  readonly program: 'dsh'
  readonly args: readonly string[]
}

/** One one-use, short-lived import confirmation. */
export interface PluginMarketplaceImportPreview {
  readonly confirmationId: PluginMarketplaceConfirmationId
  readonly expiresAt: number
  readonly profile: 'web'
  readonly sourceKind: 'github' | 'npm' | 'local'
  readonly sourceRef: string
  readonly verification: 'catalog-verified' | 'topic-only' | 'custom'
  readonly command: PluginMarketplaceCommandPreview
  readonly risks: readonly PluginMarketplaceImportRisk[]
}

/** Preview validation/admission failures. */
export type PluginMarketplacePrepareImportErrorCode =
  | 'invalid-source'
  | 'catalog-item-not-found'
  | 'catalog-item-unvalidated'
  | 'catalog-item-invalid'
  | 'local-path-unreadable'
  | 'local-manifest-missing'
  | 'confirmation-capacity'

/** Import-preview rejection kept on the Remote business-result channel. */
export interface PluginMarketplacePrepareImportError {
  /** Stable machine-readable rejection code. */
  readonly code: PluginMarketplacePrepareImportErrorCode
  /** Human-readable explanation suitable for the confirmation UI. */
  readonly message: string
}

/** Non-executing import preview or explicit source/admission failure. */
export type PluginMarketplacePrepareImportResult =
  | { readonly ok: true; readonly value: PluginMarketplaceImportPreview }
  | { readonly ok: false; readonly error: PluginMarketplacePrepareImportError }

/** Explicit second step. The literal prevents accidental truthy substitutes. */
export interface PluginMarketplaceConfirmImportRequest {
  readonly confirmationId: PluginMarketplaceConfirmationId
  readonly acknowledgeRisks: true
}

/** Successful official dsh command outcome. */
export interface PluginMarketplaceImportReceipt {
  readonly status: 'installed'
  readonly profile: 'web'
  readonly sourceRef: string
  readonly restartRequired: true
  readonly stdoutTail: string
  readonly stderrTail: string
}

/** Confirmation/execution failure vocabulary. */
export type PluginMarketplaceConfirmImportErrorCode =
  | 'confirmation-not-found'
  | 'confirmation-expired'
  | 'confirmation-consumed'
  | 'install-busy'
  | 'installation-disabled'
  | 'command-unavailable'
  | 'install-failed'

/** Confirmation or execution failure kept on the Remote business-result channel. */
export interface PluginMarketplaceConfirmImportError {
  /** Stable machine-readable failure code, including `installation-disabled`. */
  readonly code: PluginMarketplaceConfirmImportErrorCode
  /** Human-readable explanation suitable for the confirmation UI. */
  readonly message: string
  /** Managed command exit code when an execution implementation reports one. */
  readonly exitCode?: number | null
  /** Bounded standard-output tail when an execution implementation reports one. */
  readonly stdoutTail?: string
  /** Bounded standard-error tail when an execution implementation reports one. */
  readonly stderrTail?: string
}

/** Installation receipt or explicit confirmation/execution failure. */
export type PluginMarketplaceConfirmImportResult =
  | { readonly ok: true; readonly value: PluginMarketplaceImportReceipt }
  | { readonly ok: false; readonly error: PluginMarketplaceConfirmImportError }

/** One file in the copy-only starter template. */
export interface PluginMarketplaceTemplateFile {
  readonly path: string
  readonly content: string
}

/** Safe links and copy-only starter content for creating a plugin. */
export interface PluginMarketplaceResources {
  readonly topicUrl: string
  readonly docsUrl: string
  readonly publishGuideUrl: string
  readonly template: {
    readonly files: readonly PluginMarketplaceTemplateFile[]
  }
}
