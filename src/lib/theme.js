// Light/dark theme. The OS setting decides until the user picks one with
// the toggle; after that only their choice ("light" or "dark") is stored -
// a display preference, nothing to do with payroll data. The CSS does the
// rest: no data-theme attribute means "follow the OS".

const STORAGE_KEY = 'payroll_theme'

export function getStoredTheme() {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return value === 'light' || value === 'dark' ? value : null
  } catch {
    return null
  }
}

function getOsTheme() {
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

export function getEffectiveTheme() {
  return getStoredTheme() ?? getOsTheme()
}

// Called once before the first render, so the page never flashes the wrong theme.
export function applyStoredTheme() {
  const stored = getStoredTheme()
  if (stored) document.documentElement.dataset.theme = stored
}

export function chooseTheme(theme) {
  document.documentElement.dataset.theme = theme
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // Storage unavailable: the choice still applies until the page is closed.
  }
}

// Calls `listener` when the OS setting changes. Returns an unsubscribe function.
export function onOsThemeChange(listener) {
  const query = window.matchMedia?.('(prefers-color-scheme: light)')
  if (!query) return () => {}
  query.addEventListener('change', listener)
  return () => query.removeEventListener('change', listener)
}
