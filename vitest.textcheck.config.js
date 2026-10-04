import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Config for the text check only (see scripts/text-check.mjs). Kept apart
// from vitest.config.js so `npm test` never runs it.
export default defineConfig({
  plugins: [react()],
  test: {
    include: ['tests/textCheck/*.textcheck.jsx'],
    // The base version of src/ is checked out under .text-check/ inside the project.
    exclude: ['node_modules/**'],
    server: { deps: { inline: [] } },
  },
})
