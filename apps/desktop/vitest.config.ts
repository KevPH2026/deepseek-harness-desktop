import { defineConfig } from 'vitest/config'

/** Focused unit-test config for the independent Electron workspace. */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
  },
})
