import { useEffect } from 'react'

// Points the iOS status bar at a colour other than --bg, and puts it back.
//
// useTheme.js already owns theme-color and repaints it from --bg whenever the
// palette changes. That is right everywhere except a screen that tints its own
// background: there, leaving the bar on --bg produces a band across the top of
// the phone — the same defect the flight-plan map had, and the reason this
// exists rather than the home screen just setting a background and hoping.
//
// Two things make it safe to share the tag with useTheme:
//   * the original value is captured on mount and restored on unmount, so
//     navigating away leaves the bar exactly as it was found
//   * a MutationObserver re-applies after useTheme repaints, which is what
//     happens when the system flips to dark while this screen is open
//
// Pass null to do nothing at all — an unknown weather condition should leave
// the chrome alone rather than guess at it.
export function useChromeColor(color) {
  useEffect(() => {
    if (!color) return
    const dark = document.documentElement.getAttribute('data-theme') !== 'light'
    const meta = document.querySelector(
      `meta[name="theme-color"][media*="${dark ? 'dark' : 'light'}"]`)
    if (!meta) return

    const original = meta.getAttribute('content')
    const apply = () => {
      if (meta.getAttribute('content') !== color) meta.setAttribute('content', color)
    }
    apply()

    // useTheme repaints from --bg on a theme change; this puts the tint back
    // on the frame after, rather than fighting it every frame.
    const obs = new MutationObserver(() => requestAnimationFrame(apply))
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

    return () => {
      obs.disconnect()
      if (original != null) meta.setAttribute('content', original)
    }
  }, [color])
}
