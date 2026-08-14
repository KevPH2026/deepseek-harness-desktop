// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AboutCommunitySection } from '../src/client/AboutCommunitySection.tsx'
import type { AboutCommunitySectionProps } from '../src/client/AboutCommunitySection.tsx'
import { en, type AboutCommunityLocaleKey, zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t: NonNullable<AboutCommunitySectionProps['t']> = (key: AboutCommunityLocaleKey): string => en[key]

describe('AboutCommunitySection', () => {
  it('renders nothing until its translation dependency is injected', () => {
    const view = render(<AboutCommunitySection />)
    expect(view.container.firstChild).toBeNull()
  })

  it('states the unofficial boundary and exposes the five canonical destinations', () => {
    render(<AboutCommunitySection t={t} />)

    expect(screen.getByRole('heading', { name: en.title })).toBeTruthy()
    expect(screen.getByText(en.edition)).toBeTruthy()
    expect(screen.getByText(en.unofficialBody)).toBeTruthy()

    const destinations = new Map([
      [en.upstreamLabel, 'https://github.com/deepseek-ai/deepseek-harness'],
      [en.maintainerLabel, 'https://github.com/KevPH2026'],
      [en.repositoryLabel, 'https://github.com/KevPH2026/deepseek-harness-desktop'],
      [en.releasesLabel, 'https://github.com/KevPH2026/deepseek-harness-desktop/releases'],
      [en.feedbackLabel, 'https://github.com/KevPH2026/deepseek-harness-desktop/issues/new/choose'],
    ])
    const anchors = screen.getAllByRole('link') as HTMLAnchorElement[]
    expect(anchors).toHaveLength(destinations.size)
    for (const [label, href] of destinations) {
      const anchor = screen.getByRole('link', { name: new RegExp(label, 'i') }) as HTMLAnchorElement
      expect(anchor.href).toBe(href)
      expect(anchor.target).toBe('_blank')
      expect(anchor.rel.split(' ')).toEqual(expect.arrayContaining(['noopener', 'noreferrer']))
    }
  })

  it('ships structurally paired Chinese and English dictionaries', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
    expect(zh.edition).toBe('非官方社区版')
    expect(zh.maintainerDescription).toContain('KevPH2026')
  })
})
