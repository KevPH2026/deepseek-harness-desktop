/** Copy dictionaries for the About & Community Settings section. */

/** Simplified Chinese dictionary and key source of truth. */
export const zh = {
  nav: '关于与社区',
  title: 'DeepSeek Harness Desktop',
  edition: '非官方社区版',
  summary: '了解项目来源、社区维护者，以及获取版本和支持的可靠渠道。',
  unofficialTitle: '社区维护',
  unofficialBody: '本应用不是 DeepSeek 官方桌面产品，也不代表 DeepSeek 官方背书。',
  attributionTitle: '项目归属',
  upstreamLabel: '上游开源项目',
  upstreamDescription: '基于 DeepSeek 开源的 DeepSeek Harness；原项目版权与商标归各自权利人所有。',
  maintainerLabel: '桌面版维护者',
  maintainerDescription: 'KevPH2026 维护这一非官方社区桌面版本。',
  communityTitle: '社区与支持',
  repositoryLabel: '项目仓库',
  repositoryDescription: '查看桌面版源码与项目说明。',
  releasesLabel: '版本与更新',
  releasesDescription: '查看已发布版本和变更记录。',
  feedbackLabel: '问题与建议',
  feedbackDescription: '提交可复现的问题或产品建议。',
} satisfies Record<string, string>

/** About & Community locale key union. */
export type AboutCommunityLocaleKey = keyof typeof zh

/** English dictionary checked against the Chinese key set. */
export const en = {
  nav: 'About & Community',
  title: 'DeepSeek Harness Desktop',
  edition: 'Unofficial community edition',
  summary: 'Find the project provenance, community maintainer, releases, and reliable support channels.',
  unofficialTitle: 'Community maintained',
  unofficialBody: 'This app is not an official DeepSeek desktop product and does not imply endorsement by DeepSeek.',
  attributionTitle: 'Project attribution',
  upstreamLabel: 'Upstream open-source project',
  upstreamDescription: 'Built on the DeepSeek Harness open-source project; original copyrights and trademarks remain with their respective owners.',
  maintainerLabel: 'Desktop maintainer',
  maintainerDescription: 'KevPH2026 maintains this unofficial community desktop edition.',
  communityTitle: 'Community & support',
  repositoryLabel: 'Project repository',
  repositoryDescription: 'View the desktop source and project notes.',
  releasesLabel: 'Releases & updates',
  releasesDescription: 'Review published versions and change notes.',
  feedbackLabel: 'Issues & feedback',
  feedbackDescription: 'Report a reproducible issue or share a product suggestion.',
} satisfies Record<AboutCommunityLocaleKey, string>
