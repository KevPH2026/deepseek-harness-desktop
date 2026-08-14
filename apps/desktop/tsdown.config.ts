import { defineConfig } from 'tsdown'

/** Build the Electron main process while leaving its native runtime adapters external. */
export default defineConfig({
  entry: ['lib/types/main.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  deps: { neverBundle: ['electron', 'electron-updater'] },
  fixedExtension: false,
  dts: false,
  clean: false,
})
