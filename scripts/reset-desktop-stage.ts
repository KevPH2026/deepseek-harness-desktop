/** Remove only the generated Desktop staging directory before pnpm deploy. */
import { rm } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const desktop = join(root, 'apps', 'desktop')
const stage = join(desktop, '.stage')

if (dirname(stage) !== desktop || basename(stage) !== '.stage') {
  throw new Error(`reset-desktop-stage: refusing unexpected stage path ${stage}.`)
}

await rm(stage, { recursive: true, force: true })
console.log(`reset-desktop-stage: removed ${stage}.`)
