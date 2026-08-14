/** Static product attribution and community links for the Settings shell. */

import type { ReactNode } from 'react'
import { IconRightUpOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { en } from './locales.ts'
import styles from './AboutCommunitySection.module.css'

/** Injected copy dependency of the About & Community section. */
export interface AboutCommunitySectionInjected {
  /** Section copy bound to this package's locale namespace. */
  t: (key: keyof typeof en) => string
}

/** Props delivered by the slot outlet. */
export type AboutCommunitySectionProps = Partial<AboutCommunitySectionInjected>

const links = {
  repository: 'https://github.com/KevPH2026/deepseek-harness-desktop',
  maintainer: 'https://github.com/KevPH2026',
  releases: 'https://github.com/KevPH2026/deepseek-harness-desktop/releases',
  feedback: 'https://github.com/KevPH2026/deepseek-harness-desktop/issues/new/choose',
  upstream: 'https://github.com/deepseek-ai/deepseek-harness',
} as const

interface LinkCardProps {
  href: string
  label: string
  description: string
}

function LinkCard({ href, label, description }: LinkCardProps): ReactNode {
  return (
    <a className={styles.linkCard} href={href} target="_blank" rel="noopener noreferrer">
      <span className={styles.linkCopy}>
        <strong>{label}</strong>
        <span>{description}</span>
      </span>
      <IconRightUpOutline16 className={styles.externalIcon} />
    </a>
  )
}

/** Render the static About & Community settings page. */
export function AboutCommunitySection({ t }: AboutCommunitySectionProps): ReactNode {
  if (t === undefined) return null

  return (
    <section className={styles.section} aria-labelledby="about-community-title">
      <header className={styles.hero}>
        <div className={styles.monogram} aria-hidden="true">DH</div>
        <div className={styles.heroCopy}>
          <span className={styles.edition}>{t('edition')}</span>
          <h2 id="about-community-title">{t('title')}</h2>
          <p>{t('summary')}</p>
        </div>
      </header>

      <aside className={styles.notice} aria-labelledby="about-community-unofficial-title">
        <strong id="about-community-unofficial-title">{t('unofficialTitle')}</strong>
        <p>{t('unofficialBody')}</p>
      </aside>

      <section className={styles.group} aria-labelledby="about-community-attribution-title">
        <h3 id="about-community-attribution-title">{t('attributionTitle')}</h3>
        <div className={styles.linkGrid}>
          <LinkCard
            href={links.upstream}
            label={t('upstreamLabel')}
            description={t('upstreamDescription')}
          />
          <LinkCard
            href={links.maintainer}
            label={t('maintainerLabel')}
            description={t('maintainerDescription')}
          />
        </div>
      </section>

      <section className={styles.group} aria-labelledby="about-community-support-title">
        <h3 id="about-community-support-title">{t('communityTitle')}</h3>
        <div className={styles.linkGrid}>
          <LinkCard
            href={links.repository}
            label={t('repositoryLabel')}
            description={t('repositoryDescription')}
          />
          <LinkCard
            href={links.releases}
            label={t('releasesLabel')}
            description={t('releasesDescription')}
          />
          <LinkCard
            href={links.feedback}
            label={t('feedbackLabel')}
            description={t('feedbackDescription')}
          />
        </div>
      </section>
    </section>
  )
}
