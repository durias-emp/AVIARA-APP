import { useEffect, useRef } from 'react'

// Cloudflare Turnstile widget — required once Supabase's auth server has
// CAPTCHA protection turned on (see the bot/scam-prevention plan). Built
// and wired up ahead of that switch actually being flipped: enabling it
// server-side before the client can send a token would lock every sign-in
// out immediately, this app's own included.
//
// siteKey defaults to Cloudflare's own published "always passes" test key
// (https://developers.cloudflare.com/turnstile/troubleshooting/testing/) —
// a real, public, documented key meant for exactly this: developing against
// before a real site exists. Swap in VITE_TURNSTILE_SITE_KEY once one does.
const TEST_SITE_KEY = '1x00000000000000000000AA'

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js'
let scriptPromise = null
function loadScript() {
  if (window.turnstile) return Promise.resolve()
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = SCRIPT_SRC
      s.async = true
      s.onload = resolve
      s.onerror = reject
      document.head.appendChild(s)
    })
  }
  return scriptPromise
}

export default function Turnstile({ onVerify }) {
  const containerRef = useRef(null)
  const widgetId = useRef(null)

  useEffect(() => {
    let cancelled = false
    loadScript().then(() => {
      if (cancelled || !containerRef.current) return
      widgetId.current = window.turnstile.render(containerRef.current, {
        sitekey: import.meta.env.VITE_TURNSTILE_SITE_KEY || TEST_SITE_KEY,
        callback: onVerify,
        'expired-callback': () => onVerify(null),
        'error-callback': () => onVerify(null),
      })
    }).catch(() => {})
    return () => {
      cancelled = true
      if (widgetId.current != null && window.turnstile) window.turnstile.remove(widgetId.current)
    }
    // onVerify deliberately left out — it's expected to be a stable setState
    // setter, and re-running this on every parent render would tear down
    // and rebuild the widget, resetting an in-progress/solved challenge.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div ref={containerRef} />
}
