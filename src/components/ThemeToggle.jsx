import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { chooseTheme, getEffectiveTheme, onOsThemeChange } from '../lib/theme'

// Small light/dark switch. Follows the OS until the user clicks it.
export default function ThemeToggle() {
  const [theme, setTheme] = useState(getEffectiveTheme)

  useEffect(() => onOsThemeChange(() => setTheme(getEffectiveTheme())), [])

  const next = theme === 'dark' ? 'light' : 'dark'
  const label = `Switch to ${next} theme`

  return (
    <button
      onClick={() => {
        chooseTheme(next)
        setTheme(next)
      }}
      className="btn btn-ghost btn-icon"
      aria-label={label}
      title={label}
    >
      {theme === 'dark' ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
    </button>
  )
}
