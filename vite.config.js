import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  // GitHub Pages serves this as a project site at /payroll_sys/, not the
  // domain root - only applies to the production build, so local dev keeps
  // running at the root path.
  base: command === 'build' ? '/payroll_sys/' : '/',
  plugins: [react(), tailwindcss()],
  // Each app of the payroll system has its own fixed local port, and refuses
  // to start on any other (strictPort). A browser keeps saved data per
  // address INCLUDING the port, so an app that quietly moved to another port
  // would open with none of its data. The four ports:
  //   5173  PDF form filler      5174  Payroll (this app)
  //   5175  Payslip              5176  Payroll Hub dashboard
  server: {
    port: 5174,
    strictPort: true,
  },
}))
