#!/usr/bin/env node
/**
 * Refresh the local marketplace "Featured picks" feed from the
 * AdamPlatin123/awesome-dsh-plugins radar.
 *
 * Parses the curated Top 50 table out of the repo's `README.md` between
 * the "精选插件 Top 50" heading and the "分类目录" anchor, keeps only
 * rows whose verdict is a checkmark (✅ — i.e. the package was tested
 * by the radar in a live K8s pod), and writes the result to
 * `packages/host/plugin-marketplace/src/featured-plugins.generated.json`.
 *
 * The marketplace Host reads that file at runtime; if the radar is
 * unavailable, the package falls back to the bundled default in
 * `featured-plugins.fallback.json`.
 *
 * Usage:
 *   node scripts/sync-featured-plugins.mjs
 *   node scripts/sync-featured-plugins.mjs --fallback  # use the bundled default
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const FEED_URL = 'https://raw.githubusercontent.com/AdamPlatin123/awesome-dsh-plugins/main/README.md'
const OUTPUT_PATH = resolve(root, 'packages/host/plugin-marketplace/src/featured-plugins.generated.json')
const FALLBACK_PATH = resolve(root, 'packages/host/plugin-marketplace/src/featured-plugins.fallback.json')

const CATEGORY_FALLBACK = {
  'Booster': 'productivity',
  '界面与工作台': 'ui',
  '终端与桌面端': 'ui',
  '视觉与多模态': 'media',
  'Agent 能力与编排': 'workflow',
  '编码与生产力': 'productivity',
  '记忆与上下文': 'workflow',
  '消息通讯与 IM': 'tools',
  '文件、数据与浏览': 'tools',
  '市场与管理': 'tools',
  '娱乐生活': 'other',
}
const CATEGORY_DEFAULT = 'other'

function describeNpm(repo) {
  // Strip a full GitHub URL down to `owner/repo`. The radar links each
  // row to the upstream GitHub repository, but the dsh CLI accepts the
  // GitHub importer form (`owner/repo`) directly.
  let cleaned = repo
  try {
    const u = new URL(repo)
    if (u.hostname === 'github.com' || u.hostname === 'www.github.com') {
      cleaned = u.pathname.replace(/^\/+/, '').replace(/\.git$/, '').replace(/\/$/, '')
    }
  } catch {
    // Not a URL; treat as the bare repo string below.
  }
  if (cleaned.startsWith('dsh-') || cleaned.startsWith('dsh/')) {
    return cleaned.replace(/^dsh\//, '@dsh/')
  }
  if (cleaned.startsWith('@')) return cleaned
  return cleaned
}

async function fetchReadme() {
  // Use the platform's curl binary. Honour HTTPS_PROXY / HTTP_PROXY when
  // set; otherwise fall back to a direct fetch. The bundled fallback
  // covers any failure that escapes this path.
  const { execFile } = await import('node:child_process')
  const envProxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY
  const args = ['--silent', '--show-error', '--fail', '--max-time', '20']
  if (envProxy) {
    args.push('--proxy', envProxy)
  }
  args.push(FEED_URL)
  return await new Promise((resolve, reject) => {
    execFile('curl', args, { maxBuffer: 32 * 1024 * 1024, encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(
          `curl ${FEED_URL}${envProxy ? ` via ${envProxy}` : ''} failed: ${error.message} (stderr: ${stderr})`,
        ))
      } else {
        resolve(stdout)
      }
    })
  })
}

function parseFeaturedTable(markdown) {
  // Pull the section between the "精选插件 Top 50" heading and the next
  // level-2 heading. The radar's automated tables use pipe-form rows whose
  // verdict cell sits in the third column.
  const startMarker = '## 精选插件 Top 50'
  const startIdx = markdown.indexOf(startMarker)
  if (startIdx < 0) throw new Error('featured section not found')
  const after = markdown.indexOf('\n## ', startIdx + startMarker.length)
  const section = after > 0 ? markdown.slice(startIdx, after) : markdown.slice(startIdx)
  // Each category is a level-3 heading followed by a table; walk the
  // document and group rows by their nearest preceding heading.
  const out = []
  const lines = section.split('\n')
  let currentCategory = ''
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (line.startsWith('### ')) {
      // Strip "### " plus any leading emoji / surplus whitespace. The
      // "（6）" / "(5)" trailing counts on the same line are also trimmed
      // so they never become the category label.
      const stripped = line.replace(/^###\s+/, '')
      // Drop the leading high-codepoint run (emoji, symbols, dingbats)
      // plus any spaces between it and the Chinese / Latin name. v8
      // does not honour the \u{...} escape in regex character classes, so
      // a manual code-point loop is the portable way to express this.
      // Skip leading high-codepoint chars (emoji + dingbats + CJK symbols)
      // and ordinary whitespace. Step by full code-point (2 chars for
      // surrogate pairs) so we never split a pair and leave a dangling
      // surrogate. v8 regex character classes do not honour the \u{}
      // escape for arbitrary high-codepoint ranges, so we use a loop.
      let head = stripped
      while (head.length > 0) {
        const code = head.codePointAt(0)
        const step = code > 0xffff ? 2 : 1
        const isSpace = code === 0x09 || code === 0x0a || code === 0x0d || code === 0x20
        const isMisc = code >= 0x2000 && code <= 0x2fff
        const isEmoji = code >= 0x1f000 && code <= 0x1ffff
        const isSymbol = code >= 0x2600 && code <= 0x27bf
        const isCjkSym = code >= 0x3000 && code <= 0x303f
        const isVs16 = code === 0xfe0f // emoji presentation selector
        if (isSpace || isMisc || isEmoji || isSymbol || isCjkSym || isVs16) {
          head = head.slice(step)
        } else {
          break
        }
      }
      // Drop a trailing "(N)" or "（N）" count.
      currentCategory = head
        .replace(/[\s(（][0-9]+[)）]\s*$/, '')
        .trim()
      continue
    }
    if (!line.startsWith('|')) continue
    // Format: | [name](repo) | stars | verdict | desc |
    const cells = line.split('|').map(c => c.trim()).filter(Boolean)
    if (cells.length < 4) continue
    // The second cell is the verdict token.
    if (cells[2] !== '✅') continue
    const nameCell = cells[0]
    const desc = cells[3] || ''
    const linkMatch = nameCell.match(/\[([^\]]+)\]\(([^)]+)\)/)
    if (!linkMatch) continue
    const displayName = linkMatch[1]
    const repo = linkMatch[2]
    out.push({
      package: describeNpm(repo),
      displayName,
      whyIncluded: desc,
      category: CATEGORY_FALLBACK[currentCategory] || CATEGORY_DEFAULT,
    })
  }
  return out
}

function buildRecommendations(markdown) {
  const items = parseFeaturedTable(markdown)
  return {
    items,
    source: 'fetched',
    refreshedAt: new Date().toISOString(),
  }
}

async function main() {
  let result
  if (process.argv.includes('--fallback')) {
    result = JSON.parse(await readFile(FALLBACK_PATH, 'utf8'))
  } else {
    try {
      result = buildRecommendations(await fetchReadme())
    } catch (error) {
      console.warn(`sync-featured-plugins: ${error.message}; using bundled fallback.`)
      result = JSON.parse(await readFile(FALLBACK_PATH, 'utf8'))
    }
  }
  await mkdir(dirname(OUTPUT_PATH), { recursive: true })
  await writeFile(OUTPUT_PATH, JSON.stringify(result, null, 2) + '\n', 'utf8')
  const rel = OUTPUT_PATH.replace(root + '/', '')
  console.log(`sync-featured-plugins: wrote ${result.items.length} items to ${rel} (source=${result.source})`)
}

main().catch(error => {
  console.error('sync-featured-plugins:', error)
  process.exit(1)
})
