import './payrollHubBridge.js' // defines window.PayrollHubBridge
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Fonts are bundled with the app - nothing is fetched from another server.
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import './index.css'
import App from './App.jsx'
import { applyStoredTheme } from './lib/theme'

applyStoredTheme()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
