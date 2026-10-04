import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Test-only config (the app itself still builds from vite.config.js).
export default defineConfig({
  plugins: [react()],
  test: {
    include: ['tests/**/*.test.{js,jsx}'],
  },
})
