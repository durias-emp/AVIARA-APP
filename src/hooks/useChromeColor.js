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

    // BOTH media-scoped tags, not just the one matching the app's theme.
    //
    // This is the fix for a white band across the top of an iPhone. The two
    // tags are scoped to prefers-color-scheme, so iOS reads whichever matches
    // the *system* appearance — while the app decides its own palette
    // separately. A phone set to light running the app in dark therefore
    // reads the light tag, which still said #ffffff: a white strip above a
    // dark page. Writing one tag can only ever be right when the two happen
    // to agree.
    //
    // Overwriting both is correct here precisely because this hook exists to
    // say "the chrome is this colour, whatever the system thinks" — the page
    // underneath is that colour either way. Both originals are captured and
    // both are restored, so useTheme's own light/dark pair is intact the
    // moment this screen unmounts.
    const metas = [...document.querySelectorAll('meta[name="theme-color"]')]
    if (!metas.length) return

    const originals = metas.map(m => [m, m.getAttribute('content')])
    const apply = () => {
      for (const m of metas) {
        if (m.getAttribute('content') !== color) m.setAttribute('content', color)
      }
    }
    apply()

    // useTheme repaints from --bg on a theme change; this puts the tint back
    // on the frame after, rather than fighting it every frame.
    const obs = new MutationObserver(() => requestAnimationFrame(apply))
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

    return () => {
      obs.disconnect()
      for (const [m, original] of originals) {
        if (original != null) m.setAttribute('content', original)
      }
    }
  }, [color])
}
