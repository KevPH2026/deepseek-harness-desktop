import { describe, expect, it } from 'vitest'
import { PLUGIN_MARKETPLACE_PUBLIC_OFFERS } from '../src/resources.ts'

describe('verified public offers', () => {
  it('keeps official public-plan facts separate from sponsor and partner claims', () => {
    expect(PLUGIN_MARKETPLACE_PUBLIC_OFFERS).toHaveLength(3)
    expect(PLUGIN_MARKETPLACE_PUBLIC_OFFERS.map(offer => offer.id)).toEqual([
      'hugging-face-inference-providers',
      'openrouter-free-models',
      'groq-free-plan',
    ])
    for (const offer of PLUGIN_MARKETPLACE_PUBLIC_OFFERS) {
      expect(offer.kind).toBe('public-offer')
      expect(offer.lastVerified).toBe('2026-08-14')
      expect(new URL(offer.source).protocol).toBe('https:')
      expect(new URL(offer.applyUrl).protocol).toBe('https:')
      expect(offer.terms.length).toBeGreaterThan(0)
      expect(offer.eligibility.length).toBeGreaterThan(0)
      expect(offer).not.toHaveProperty('partner')
      expect(offer).not.toHaveProperty('sponsor')
    }
  })
})
