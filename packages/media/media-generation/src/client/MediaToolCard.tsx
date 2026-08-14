/** Dedicated Tool card for generated image and video artifacts. */

import {
  IconDownloadOutline16, IconInspectOutline12, IconPlayOutline16, IconSparkle16, StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import type { NS } from './locales.ts'
import { formatMediaBytes, mediaToolModel } from './media-tool-model.ts'
import css from './MediaToolCard.module.css'

/** Props derived from the keyed Tool-view slot and locale seat. */
export type MediaToolCardProps = PropsRuntime<'tool.call.toolview'> & PropsLocale<typeof NS>

function providerName(provider: 'openai-images' | 'google-veo'): string {
  return provider === 'openai-images' ? 'OpenAI-compatible Images' : 'Google Veo'
}

/** Render one running or settled media generation call. */
export function MediaToolCard({ toolName, block, inspect, t }: MediaToolCardProps) {
  const model = mediaToolModel(toolName, block)
  const title = t(model.kind === 'image' ? 'generateImage' : 'generateVideo')
  const running = model.state === 'running'
  const failed = model.state === 'error'
  const stopped = model.state === 'stopped'
  const status = running
    ? t(model.kind === 'image' ? 'generatingImage' : 'generatingVideo')
    : failed ? t('generationFailed')
      : stopped ? t('generationStopped')
        : t(model.kind === 'image' ? 'generatedImage' : 'generatedVideo')

  return (
    <article className={css.card} data-kind={model.kind} data-state={model.state}>
      <header className={css.header}>
        <span className={css.icon} aria-hidden>
          {failed ? <StateDot state="error" />
            : stopped ? <StateDot state="warning" />
              : model.kind === 'image' ? <IconSparkle16 size={14} /> : <IconPlayOutline16 size={14} />}
        </span>
        <span className={css.title}>{title}</span>
        <span className={css.separator} aria-hidden />
        <span className={css.prompt} title={model.prompt}>{model.prompt}</span>
        <span className={css.state}>{status}</span>
      </header>

      {running
        ? (
          <div className={css.pending} role="status" aria-live="polite">
            <div className={css.pendingCanvas} aria-hidden>
              <span className={css.pendingGlyph}>{model.kind === 'image' ? '◫' : '▶'}</span>
            </div>
            <span>{status}</span>
          </div>
        )
        : model.artifact !== undefined
          ? (
            <div className={css.artifact}>
              <div className={css.mediaFrame} data-kind={model.artifact.kind}>
                {model.artifact.kind === 'image'
                  ? (
                    <img
                      className={css.image}
                      src={model.artifact.url}
                      alt={model.prompt || t('artifactAlt')}
                      loading="lazy"
                      decoding="async"
                    />
                  )
                  : (
                    <video
                      className={css.video}
                      src={model.artifact.url}
                      controls
                      preload="metadata"
                      aria-label={model.prompt || t('artifactAlt')}
                    />
                  )}
              </div>
              <div className={css.artifactFooter}>
                <dl className={css.meta}>
                  <div><dt>{t('modelLabel')}</dt><dd>{model.artifact.model}</dd></div>
                  <div><dt>{t('providerLabel')}</dt><dd>{providerName(model.artifact.provider)}</dd></div>
                  <div><dt>{t('sizeLabel')}</dt><dd>{formatMediaBytes(model.artifact.bytes)}</dd></div>
                </dl>
                <span className={css.actions}>
                  {inspect === undefined
                    ? null
                    : (
                      <button type="button" className={css.actionButton} onClick={inspect}>
                        <IconInspectOutline12 size={12} />
                        {t('inspect')}
                      </button>
                    )}
                  <a className={css.download} href={model.artifact.url} download>
                    <IconDownloadOutline16 size={14} />
                    {t('download')}
                  </a>
                </span>
              </div>
            </div>
          )
          : (
            <div className={failed || stopped ? css.failure : css.missing} role={failed ? 'alert' : 'status'}>
              <strong>{failed || stopped ? status : t('resultUnavailable')}</strong>
              {model.output === ''
                ? null
                : <pre>{model.output}</pre>}
              {inspect === undefined
                ? null
                : (
                  <button type="button" className={css.actionButton} onClick={inspect}>
                    <IconInspectOutline12 size={12} />
                    {t('inspect')}
                  </button>
                )}
            </div>
          )}
    </article>
  )
}
