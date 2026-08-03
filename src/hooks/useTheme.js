import { useState, useEffect } from 'react'

const mq = window.matchMedia('(prefers-color-scheme: dark)')

function currentTheme() {
  return mq.matches ? 'dark' : 'light'
}

// Paint the browser and PWA chrome. The status bar area on iOS. The same
// colour as the app's own background.
//
// This is done from here rather than with media-scoped <meta> tags because iOS
// evaluates those once, when the app launches, and never again: switching the
// system between light and dark left the bar stuck on whichever colour the app
// started with until it was force-quit and reopened. Rewriting the tag's
// content is picked up live.
function setMeta(name, content) {
  let meta = document.querySelector(`meta[name="${name}"]`)
  if (!meta) {
    meta = document.createElement('meta')
    meta.setAttribute('name', name)
    document.head.appendChild(meta)
  }
  meta.setAttribute('content', content)
}

function paintChrome() {
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
  if (!bg) return
  // theme-color, and nothing else. iOS standalone ignores it for the status
  // bar (Apple does not support it there), so the bar is handled by loading
  // the matching shell document instead: see syncShellAppearance in main.jsx.
  // This still drives Android and desktop Chrome, including the red palette,
  // which the shells know nothing about.
  setMeta('theme-color', bg)
  // color-scheme stays in the stylesheet, where it is keyed to data-theme. 
  // setting it here as well would override the red palette's dark scheme with
  // whatever the system happens to be.
}

export function useTheme() {
  const [theme, setTheme] = useState(currentTheme)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    // After the attribute lands, so --bg resolves to the new palette. A frame
    // later still, because the body carries a colour transition and iOS samples
    // the chrome colour immediately.
    paintChrome()
    const id = requestAnimationFrame(paintChrome)
    return () => cancelAnimationFrame(id)
  }, [theme])

  useEffect(() => {
    const sync = () => setTheme(currentTheme())
    mq.addEventListener('change', sync)
    // A backstop for the change event being missed, which is what happens when
    // the appearance flips while the app is in the background, or on a schedule
    // the page was never told about. Re-reading on the way back in means the
    // theme is right by the time anything is on screen, rather than waiting for
    // the next relaunch.
    document.addEventListener('visibilitychange', sync)
    window.addEventListener('pageshow', sync)
    window.addEventListener('focus', sync)
    return () => {
      mq.removeEventListener('change', sync)
      document.removeEventListener('visibilitychange', sync)
      window.removeEventListener('pageshow', sync)
      window.removeEventListener('focus', sync)
    }
  }, [])

  return { theme }
}
