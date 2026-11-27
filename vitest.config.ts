import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    env: { TEAG3_ACCOUNTS_ENABLED: 'true' },
    include: ['src/**/*.test.ts'],
    reporters: ['default'],
  },
})
