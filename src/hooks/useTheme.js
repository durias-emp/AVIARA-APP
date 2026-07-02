import { useState, useEffect } from 'react'

const mq = window.matchMedia('(prefers-color-scheme: dark)')

function currentTheme() {
  return mq.matches ? 'dark' : 'light'
}

export function useTheme() {
  const [theme, setTheme] = useState(currentTheme)

  useEffect(() => {
    // Apply immediately
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  useEffect(() => {
    // React to system changes in real time
    function onChange(e) {
      const next = e.matches ? 'dark' : 'light'
      setTheme(next)
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  return { theme }
}
