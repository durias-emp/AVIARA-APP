import { useState, useEffect } from 'react'

const THEMES = ['light', 'dark', 'red']
const KEY = 'pqrh-theme'

function systemTheme() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function useTheme() {
  const [theme, setThemeState] = useState(() => {
    return localStorage.getItem(KEY) || systemTheme()
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem(KEY, theme)
  }, [theme])

  function cycleTheme() {
    setThemeState(t => {
      const next = THEMES[(THEMES.indexOf(t) + 1) % THEMES.length]
      return next
    })
  }

  return { theme, cycleTheme }
}
