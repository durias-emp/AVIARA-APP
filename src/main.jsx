import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// A new build activates immediately (the service worker is generated with
// skipWaiting and clientsClaim) but the page already on screen keeps running
// the code it loaded with. On a phone that page can survive for days. 
// swiping a PWA away often resumes it rather than restarting it, so fixes
// appear not to have shipped. Reload once when a new worker takes over.
//
// The guard matters: on a first visit the worker also claims the page, and
// without it every new install would reload itself once for no reason.
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller
  let reloading = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return
    reloading = true
    window.location.reload()
  })
  // And ask whether there is a newer build each time the app comes back to the
  // foreground. Without this the check only happens on a cold start, which on
  // a phone can be days apart. Long enough for a fix to look like it never
  // shipped.
  const checkForUpdate = () => {
    if (document.visibilityState !== 'visible') return
    navigator.serviceWorker.getRegistration().then(reg => reg?.update()).catch(() => {})
  }
  document.addEventListener('visibilitychange', checkForUpdate)
  window.addEventListener('focus', checkForUpdate)
}

// iOS, in standalone mode with a translucent status bar, paints the web view
// over the whole screen but sizes the CSS viewport as if the status bar were
// opaque: every length in the app resolves against a box exactly one status
// bar shorter than the screen, and the bottom of the screen sits OUTSIDE the
// coordinate system, unreachable by inset:0, 100%, or any vh unit. The lie is
// detectable from inside: a nonzero top safe-area inset proves the view runs
// under the status bar, while innerHeight comes up short of screen.height by
// that same amount. Measure the deficit and hand it to CSS; body adds it back
// (see the body rule in index.css). The equality guard keeps this from firing
// anywhere legitimate: iPad split view and desktop windows are short of the
// screen by amounts that never happen to equal the top inset, Safari-in-
// browser is not standalone, and an iOS that measures honestly reports a
// deficit of zero, which turns the whole correction off.
function correctViewportDeficit() {
  const doc = document.documentElement
  const standalone = window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true
  const safeTop = parseFloat(getComputedStyle(doc).getPropertyValue('--safe-top')) || 0
  const deficit = (window.screen?.height ?? 0) - window.innerHeight
  const lying = standalone && safeTop > 0 && deficit > 0 && Math.abs(deficit - safeTop) <= 2
  doc.style.setProperty('--vp-deficit', lying ? deficit + 'px' : '0px')
}
correctViewportDeficit()
window.addEventListener('resize', correctViewportDeficit)
window.addEventListener('orientationchange', correctViewportDeficit)
window.addEventListener('pageshow', correctViewportDeficit)
window.visualViewport?.addEventListener('resize', correctViewportDeficit)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
