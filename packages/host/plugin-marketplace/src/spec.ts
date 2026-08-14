/** Durable GitHub-topic cache declaration. */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { PluginMarketplaceCatalogItem } from './types.ts'

const sourceSchema = z.object({
  kind: z.literal('github-topic'),
  source: z.url(),
  lastVerified: z.iso.datetime(),
})

const verifiedSourceSchema = z.object({
  catalogId: z.string().min(1),
  source: z.url(),
  lastVerified: z.iso.datetime(),
})

const quickConfigSchema = z.object({
  settingsNamespace: z.string().min(1),
  source: z.url(),
  lastVerified: z.iso.datetime(),
})

const partnerOfferSchema = z.object({
  kind: z.union([z.literal('sponsor'), z.literal('free-credit')]),
  label: z.string().min(1),
  url: z.url(),
  terms: z.string().min(1),
  eligibility: z.string().min(1),
  source: z.url(),
  lastVerified: z.iso.datetime(),
})

/** Durable parser for one cached GitHub discovery row and its validation evidence. */
export const pluginMarketplaceCatalogItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  category: z.union([
    z.literal('design'), z.literal('coding'), z.literal('writing'),
    z.literal('model-provider'), z.literal('gateway'), z.literal('other'),
  ]),
  categorySource: z.union([z.literal('verified-catalog'), z.literal('topic-heuristic')]),
  sourceKind: z.literal('github'),
  sourceRef: z.string().min(1),
  sourceUrl: z.url(),
  defaultBranch: z.string().min(1).max(255),
  updatedAt: z.iso.datetime(),
  stars: z.number().int().nonnegative(),
  license: z.string().optional(),
  discoveredFrom: sourceSchema,
  verifiedSource: verifiedSourceSchema.optional(),
  quickConfig: quickConfigSchema.optional(),
  partnerOffers: z.array(partnerOfferSchema),
  installability: z.union([z.literal('unknown'), z.literal('validated'), z.literal('invalid')]),
  validation: z.object({
    source: z.url(),
    commitSha: z.string().regex(/^[a-f0-9]{40}$/),
    lastVerified: z.iso.datetime(),
    packageName: z.string().optional(),
    patchPath: z.string().optional(),
  }).optional(),
  validationFailure: z.union([
    z.literal('manifest-missing'), z.literal('manifest-invalid'),
    z.literal('bundle-missing'), z.literal('patch-path-invalid'), z.literal('patch-missing'),
  ]).optional(),
}) as unknown as z.ZodType<PluginMarketplaceCatalogItem>

/** Durable row shape kept explicit so readonly client contracts stay intact. */
export interface PluginMarketplaceCacheRow {
  readonly items: readonly PluginMarketplaceCatalogItem[]
  readonly fetchedAt: number
  readonly checkedAt: number
  readonly etag?: string
  readonly rateLimitResetAt?: number
}

/** Durable parser for the singleton cached topic-search row. */
export const pluginMarketplaceCacheRowSchema = z.object({
  items: z.array(pluginMarketplaceCatalogItemSchema),
  fetchedAt: z.number().int().nonnegative(),
  checkedAt: z.number().int().nonnegative(),
  etag: z.string().optional(),
  rateLimitResetAt: z.number().int().nonnegative().optional(),
}) as unknown as z.ZodType<PluginMarketplaceCacheRow>

/** Storage-domain declaration for the versioned plugin-marketplace cache. */
export const pluginMarketplaceDomainSpec = defineDomain({
  name: 'plugin_marketplace',
  version: 0,
  tables: {
    catalog: domainTable<string, PluginMarketplaceCacheRow>(pluginMarketplaceCacheRowSchema),
  },
})
