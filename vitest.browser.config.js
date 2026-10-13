import { defineConfig } from 'vitest/config'

// Config for the browser tests only (`npm run test:browser`). They start the
// real app on a local port and drive it in a throwaway Chromium profile, so
// they never see or touch the data in your own browser. Kept apart from
// vitest.config.js so `npm test` stays fast.
export default defineConfig({
  test: {
    include: ['tests/browser/**/*.e2e.js'],
    environment: 'node',
    testTimeout: 180_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
})
