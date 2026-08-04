// Whether the app is currently rendering dark.
//
// Reads data-theme rather than prefers-color-scheme directly, so it follows
// whatever useTheme resolved: that hook already handles the system switching
// while the app is backgrounded, and the red palette, which is dark but is not
// the system's dark. One source of truth beats two that agree most of the time.

import { useEffect, useState } from 'react'

const read = () => document.documentElement.getAttribute('data-theme') !== 'light'

export default function useIsDark() {
  const [dark, setDark] = useState(read)

  useEffect(() => {
    // The attribute is set by useTheme on every change, including the system
    // flipping while the app sat in the background, so observing it catches
    // every case without subscribing to the media query a second time.
    const obs = new MutationObserver(() => setDark(read()))
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => obs.disconnect()
  }, [])

  return dark
}
