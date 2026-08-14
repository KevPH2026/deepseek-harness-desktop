/** Copy-only starter template and authoritative documentation links. */

import type { PluginMarketplacePublicOffer, PluginMarketplaceResources } from './types.ts'

const DOC_ROOT = 'https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic'

/** Official public plans verified on 2026-08-14; never label these as partners. */
export const PLUGIN_MARKETPLACE_PUBLIC_OFFERS: readonly PluginMarketplacePublicOffer[] = Object.freeze([
  Object.freeze({
    id: 'hugging-face-inference-providers',
    kind: 'public-offer',
    provider: 'Hugging Face',
    title: 'Inference Providers public monthly credits',
    summary: 'Free users receive $0.10 in monthly routed-inference credits, subject to change.',
    terms: 'Extra routed usage requires purchased credits; custom provider keys do not use Hugging Face monthly credits.',
    eligibility: 'A Hugging Face user account using eligible Inference Providers through Hugging Face routing.',
    source: 'https://huggingface.co/docs/inference-providers/en/pricing',
    applyUrl: 'https://huggingface.co/join',
    lastVerified: '2026-08-14',
  }),
  Object.freeze({
    id: 'openrouter-free-models',
    kind: 'public-offer',
    provider: 'OpenRouter',
    title: 'Free models and Free Models Router',
    summary: 'Free models default to 50 API requests per day in total; accounts that have purchased at least $10 in credits receive 1,000 per day.',
    terms: 'Limits apply across free models, can change, and are usually unsuitable for production; `openrouter/free` chooses a free model automatically.',
    eligibility: 'An OpenRouter account and API key; the higher daily limit requires at least $10 in purchased credits.',
    source: 'https://openrouter.ai/docs/faq',
    applyUrl: 'https://openrouter.ai/',
    lastVerified: '2026-08-14',
  }),
  Object.freeze({
    id: 'groq-free-plan',
    kind: 'public-offer',
    provider: 'Groq',
    title: 'Groq Free Plan limits',
    summary: 'Groq publishes model-specific Free Plan limits for requests and tokens.',
    terms: 'Exact limits vary by model and organization; the account Limits page is authoritative. Developer tier is pay-as-you-go.',
    eligibility: 'A Groq Cloud organization on the Free Plan; upgrading to Developer requires a valid payment method.',
    source: 'https://console.groq.com/docs/rate-limits',
    secondarySources: Object.freeze(['https://console.groq.com/docs/billing-faqs']),
    applyUrl: 'https://console.groq.com/',
    lastVerified: '2026-08-14',
  }),
])

/** Immutable authoring links and copy-only starter files returned by `resources`. */
export const PLUGIN_MARKETPLACE_RESOURCES: PluginMarketplaceResources = Object.freeze({
  topicUrl: 'https://github.com/topics/dsh-plugin',
  docsUrl: `${DOC_ROOT}/index.md`,
  publishGuideUrl: `${DOC_ROOT}/publish.md`,
  template: Object.freeze({
    files: Object.freeze([
      Object.freeze({
        path: 'index.js',
        content: 'export const name = \'my-dsh-plugin\'\n\nexport function apply() {\n  // Register tools, services, or UI contributions here.\n}\n',
      }),
      Object.freeze({
        path: 'package.json',
        content: `${JSON.stringify({
          name: 'my-dsh-plugin',
          version: '0.1.0',
          private: true,
          type: 'module',
          main: 'index.js',
          files: ['index.js', 'cordis.patch.yml'],
          keywords: ['dsh-plugin'],
          dsh: { bundle: { patch: './cordis.patch.yml' } },
        }, null, 2)}\n`,
      }),
      Object.freeze({
        path: 'cordis.patch.yml',
        content: '- insert:\n    - id: my-dsh-plugin\n      name: my-dsh-plugin\n',
      }),
    ]),
  }),
})
