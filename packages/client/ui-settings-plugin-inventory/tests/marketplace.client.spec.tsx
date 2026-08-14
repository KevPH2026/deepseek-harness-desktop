// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PluginMarketplaceCatalogSnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import {
  PluginMarketplaceSettingsTab,
  type PluginMarketplaceSettingsTabInjected,
  type PluginMarketplaceSettingsTabProps,
  verifiedPartnerOffers,
} from '../src/client/PluginMarketplaceSettingsTab.tsx'
import { en, type PluginInventoryLocaleKey } from '../src/client/locales.ts'

afterEach(cleanup)

const t = ((key: PluginInventoryLocaleKey): string => en[key]) as PluginMarketplaceSettingsTabProps['t']

const DESIGN_ITEM = {
  id: 'fixture/design-plugin',
  name: 'Design Plugin',
  description: 'Creates a design artifact.',
  category: 'design',
  categorySource: 'topic-heuristic',
  sourceKind: 'github',
  sourceRef: 'github:fixture/design-plugin',
  sourceUrl: 'https://github.com/fixture/design-plugin',
  defaultBranch: 'main',
  installability: 'unknown',
  updatedAt: '2026-08-12T08:00:00.000Z',
  stars: 1250,
  license: 'MIT',
  discoveredFrom: {
    kind: 'github-topic',
    source: 'https://github.com/topics/dsh-plugin',
    lastVerified: '2026-08-13T08:00:00.000Z',
  },
  partnerOffers: [],
} as const

const VERIFIED_PROVIDER = {
  ...DESIGN_ITEM,
  id: 'fixture/model-provider',
  name: 'Verified Model Provider',
  category: 'model-provider',
  categorySource: 'verified-catalog',
  sourceRef: 'github:fixture/model-provider',
  sourceUrl: 'https://github.com/fixture/model-provider',
  verifiedSource: {
    catalogId: 'verified-provider',
    source: 'https://provider.example/catalog',
    lastVerified: '2026-08-13T08:00:00.000Z',
  },
  quickConfig: {
    settingsNamespace: 'provider-fixture',
    source: 'https://provider.example/docs',
    lastVerified: '2026-08-13T08:00:00.000Z',
  },
  partnerOffers: [{
    kind: 'free-credit',
    label: 'Application program',
    url: 'https://provider.example/apply',
    terms: 'Limited regions and review required.',
    eligibility: 'Eligible new accounts may apply.',
    source: 'https://provider.example/terms',
    lastVerified: '2026-08-13T08:00:00.000Z',
  }],
} as const

const PUBLIC_OFFER = {
  id: 'official-public-offer',
  kind: 'public-offer',
  provider: 'Official Provider',
  title: 'Public developer plan',
  summary: 'A limited public plan.',
  terms: 'Usage limits apply.',
  eligibility: 'Available where the provider offers service.',
  source: 'https://provider.example/public-plan',
  applyUrl: 'https://provider.example/signup',
  lastVerified: '2026-08-13T08:00:00.000Z',
} as const

function snapshot(
  items: readonly unknown[],
  publicOffers: readonly unknown[] = [],
): PluginMarketplaceCatalogSnapshot {
  return {
    status: items.length === 0 ? 'empty' : 'fresh',
    items,
    publicOffers,
    fromCache: false,
    nextRefreshAt: Date.now() + 60_000,
  } as unknown as PluginMarketplaceCatalogSnapshot
}

const RESOURCES = {
  topicUrl: 'https://github.com/topics/dsh-plugin',
  docsUrl: 'https://example.test/docs',
  publishGuideUrl: 'https://example.test/publish',
  template: { files: [] },
}

function props(
  catalog: PluginMarketplaceSettingsTabInjected['catalog'],
  validateCatalogItem: PluginMarketplaceSettingsTabInjected['validateCatalogItem'] = vi.fn(async () => ({
    ok: false as const,
    error: { code: 'validation-unavailable' as const, message: 'Validation unavailable.' },
  })),
): PluginMarketplaceSettingsTabProps {
  return {
    t,
    catalog,
    resources: vi.fn(async () => RESOURCES),
    validateCatalogItem,
  } as unknown as PluginMarketplaceSettingsTabProps
}

describe('PluginMarketplaceSettingsTab', () => {
  it('renders catalog trust facts and keeps installation disabled', async () => {
    const catalog = vi.fn(async () => snapshot([DESIGN_ITEM]))
    render(<PluginMarketplaceSettingsTab {...props(catalog)} />)

    expect(await screen.findByText(DESIGN_ITEM.name)).toBeTruthy()
    expect(catalog).toHaveBeenCalledWith({ category: 'design' })
    expect(screen.getByText(DESIGN_ITEM.sourceRef)).toBeTruthy()
    expect(screen.getByText(en.marketUnverifiedSource)).toBeTruthy()
    expect(screen.getByText('MIT')).toBeTruthy()
    expect(screen.getByRole('link', { name: en.marketOpenSource }).getAttribute('href'))
      .toBe(DESIGN_ITEM.sourceUrl)
    expect(screen.getByRole('link', { name: en.marketCreatePlugin }).getAttribute('href'))
      .toBe(RESOURCES.publishGuideUrl)
    expect(screen.getAllByRole('button', { name: en.marketReviewImport })
      .every(button => (button as HTMLButtonElement).disabled)).toBe(true)
    expect(screen.getByText(en.marketInstallDisabledTitle)).toBeTruthy()
    expect(screen.getByText(en.marketInstallDisabled)).toBeTruthy()
  })

  it('validates one selected item and only then marks it import-ready', async () => {
    const validated = {
      ...DESIGN_ITEM,
      installability: 'validated',
      validation: {
        source: DESIGN_ITEM.sourceUrl,
        commitSha: '1234567890abcdef',
        packageName: '@fixture/design-plugin',
        patchPath: 'cordis.patch.yml',
        lastVerified: '2026-08-13T08:00:00.000Z',
      },
    } as const
    const validateCatalogItem = vi.fn(async () => ({ ok: true as const, value: validated }))
    render(<PluginMarketplaceSettingsTab {...props(async () => snapshot([DESIGN_ITEM]), validateCatalogItem)} />)
    await screen.findByText(DESIGN_ITEM.name)

    fireEvent.click(screen.getByRole('button', { name: en.marketValidate }))
    await waitFor(() => { expect(validateCatalogItem).toHaveBeenCalledWith(DESIGN_ITEM.id) })
    expect(await screen.findByText(en.marketCompatibilityValidated)).toBeTruthy()
    const button = screen.getByRole('button', { name: en.marketImportReady }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(screen.getByText(/@fixture\/design-plugin/)).toBeTruthy()
  })

  it('keeps an invalid manifest unavailable and shows the validation reason', async () => {
    const invalid = {
      ...DESIGN_ITEM,
      installability: 'invalid',
      validationFailure: 'patch-missing',
    } as const
    const validateCatalogItem = vi.fn(async () => ({ ok: true as const, value: invalid }))
    render(<PluginMarketplaceSettingsTab {...props(async () => snapshot([DESIGN_ITEM]), validateCatalogItem)} />)
    await screen.findByText(DESIGN_ITEM.name)

    fireEvent.click(screen.getByRole('button', { name: en.marketValidate }))
    expect(await screen.findByText(en.marketCompatibilityInvalid)).toBeTruthy()
    expect(screen.getByText(en.marketValidationPatchMissing)).toBeTruthy()
    expect(screen.getByRole('button', { name: en.marketImportInvalid })).toHaveProperty('disabled', true)
  })

  it('sends category and search filters to the Host and renders official and verified offers separately', async () => {
    const catalog = vi.fn(async (request: Parameters<PluginMarketplaceSettingsTabInjected['catalog']>[0]) => {
      if (request.category === 'model-provider') {
        return snapshot([VERIFIED_PROVIDER], [PUBLIC_OFFER])
      }
      return snapshot([DESIGN_ITEM])
    })
    render(<PluginMarketplaceSettingsTab {...props(catalog)} />)
    await screen.findByText(DESIGN_ITEM.name)

    fireEvent.click(screen.getByRole('tab', { name: en.marketCategoryModelProvider }))
    expect(await screen.findAllByText(VERIFIED_PROVIDER.name)).toHaveLength(2)
    expect(screen.getByRole('heading', { name: en.marketPublicOffers })).toBeTruthy()
    expect(screen.getByText(PUBLIC_OFFER.title)).toBeTruthy()
    expect(screen.getByRole('link', { name: en.marketViewOfficialOffer }).getAttribute('href'))
      .toBe(PUBLIC_OFFER.applyUrl)
    expect(screen.getByText(en.marketPublicOfferDisclaimer)).toBeTruthy()
    expect(screen.getByRole('heading', { name: en.marketPartners })).toBeTruthy()
    expect(screen.getByText(VERIFIED_PROVIDER.partnerOffers[0].label)).toBeTruthy()
    expect(screen.getByText(en.marketQuotaDisclaimer)).toBeTruthy()
    expect(screen.getByText('provider-fixture')).toBeTruthy()

    fireEvent.change(screen.getByRole('searchbox', { name: en.marketSearch }), {
      target: { value: 'gateway' },
    })
    await waitFor(() => {
      expect(catalog).toHaveBeenLastCalledWith({ category: 'model-provider', query: 'gateway' })
    })
  })

  it('fails closed for unverified partner claims and shows the explicit empty state', async () => {
    const unverified = {
      ...VERIFIED_PROVIDER,
      verifiedSource: undefined,
      quickConfig: undefined,
    }
    expect(verifiedPartnerOffers(
      unverified as unknown as Parameters<typeof verifiedPartnerOffers>[0],
    )).toEqual([])

    const catalog = vi.fn(async (request: Parameters<PluginMarketplaceSettingsTabInjected['catalog']>[0]) =>
      request.category === 'gateway' ? snapshot([unverified]) : snapshot([]))
    render(<PluginMarketplaceSettingsTab {...props(catalog)} />)
    fireEvent.click(screen.getByRole('tab', { name: en.marketCategoryGateway }))

    expect(await screen.findByText(unverified.name)).toBeTruthy()
    expect(screen.getByText(en.marketPartnersEmpty)).toBeTruthy()
    expect(screen.queryByText(VERIFIED_PROVIDER.partnerOffers[0].label)).toBeNull()
  })

  it('keeps GitHub, npm, and local drafts non-executing while showing source-specific risks', async () => {
    render(<PluginMarketplaceSettingsTab {...props(async () => snapshot([]))} />)
    await screen.findByText(en.marketEmptyCategory)

    const source = screen.getByPlaceholderText(en.marketGithubPlaceholder)
    fireEvent.change(source, { target: { value: 'fixture/plugin' } })
    expect(screen.getByRole('button', { name: en.marketReviewImport })).toHaveProperty('disabled', true)
    expect(screen.getByText(en.marketRiskUnverifiedSource)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: en.marketCustomNpm }))
    expect(screen.getByPlaceholderText(en.marketNpmPlaceholder)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.marketCustomLocal }))
    expect(screen.getByPlaceholderText(en.marketLocalPlaceholder)).toBeTruthy()
    expect(screen.getByText(en.marketRiskLocalFilesystem)).toBeTruthy()
  })

  it('shows a generic catalog failure and retries with refresh', async () => {
    const catalog = vi.fn<PluginMarketplaceSettingsTabInjected['catalog']>()
      .mockRejectedValueOnce(new Error('private transport detail'))
      .mockResolvedValueOnce(snapshot([]))
    render(<PluginMarketplaceSettingsTab {...props(catalog)} />)

    expect((await screen.findByRole('alert')).textContent).toBe(en.marketError)
    expect(screen.queryByText('private transport detail')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    await waitFor(() => { expect(catalog).toHaveBeenCalledTimes(2) })
    expect(catalog).toHaveBeenLastCalledWith({ category: 'design', refresh: true })
  })
})
