/** Reviewed metadata overlay. Remote discovery can never populate this catalog. */

import type {
  PluginMarketplaceCategory,
  PluginMarketplacePartnerOffer,
  PluginMarketplaceQuickConfig,
  PluginMarketplaceVerifiedSource,
} from './types.ts'

/** One manually reviewed metadata row, keyed by lower-cased `owner/repository`. */
export interface VerifiedPluginCatalogEntry {
  readonly catalogId: string
  readonly repository: string
  readonly category: PluginMarketplaceCategory
  readonly verifiedSource: PluginMarketplaceVerifiedSource
  readonly quickConfig?: PluginMarketplaceQuickConfig
  readonly partnerOffers: readonly PluginMarketplacePartnerOffer[]
}

/**
 * Intentionally empty until a human-reviewed source supports a row. Sponsor
 * and credit claims must never be inferred from repository copy or topics.
 */
export const VERIFIED_PLUGIN_CATALOG: readonly VerifiedPluginCatalogEntry[] = Object.freeze([])
