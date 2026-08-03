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
function measureICB() {
  const doc = document.documentElement
  const probe = document.createElement('div')
  probe.style.cssText = 'position:fixed;top:0;bottom:0;left:0;width:1px;visibility:hidden;pointer-events:none'
  doc.appendChild(probe)
  const h = probe.getBoundingClientRect().height
  probe.remove()
  return h
}

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true
}

// The nuclear option, from the community fix for the sibling bug (the
// keyboard-shrunk viewport): hiding a genuinely full-height element for one
// synchronous reflow makes WebKit re-derive the viewport. Every workaround
// downstream of the lie only moves boxes; the compositor still clips painting
// at the short viewport, which no CSS can cross (proven with a painted probe:
// the backdrop stops dead at the old line). If iOS can be argued out of the
// lie itself, the deficit measures zero and the clip zone ceases to exist.
let healAttempts = 0
function healViewport() {
  if (!isStandalone() || healAttempts >= 3) return
  const target = window.screen?.height ?? 0
  if (target - measureICB() <= 2) return          // already honest
  healAttempts++
  const root = document.getElementById('root')
  if (!root) return
  const scrollTop = root.scrollTop
  root.style.display = 'none'
  void root.offsetHeight                          // synchronous reflow
  root.style.display = ''
  root.scrollTop = scrollTop
  correctViewportDeficit()
}

function correctViewportDeficit() {
  const doc = document.documentElement
  const standalone = isStandalone()
  const safeTop = parseFloat(getComputedStyle(doc).getPropertyValue('--safe-top')) || 0
  // Measure the fixed-positioning box directly instead of trusting
  // innerHeight. The keyboard collapses innerHeight (617 with visualViewport
  // 476, on record) while fixed positioning keeps resolving against the
  // unchanged containing block, so a deficit computed from innerHeight
  // switched the correction off the moment a pilot tapped a text field and
  // the dead strip returned mid-typing, surviving until iOS felt like firing
  // a resize. The probe hangs off <html>, not body: body carries a transform
  // precisely so it captures fixed descendants, and a captured probe would
  // measure the corrected box, feeding the correction its own output.
  const icb = measureICB()
  const deficit = Math.round((window.screen?.height ?? 0) - icb)
  const lying = standalone && safeTop > 0 && deficit > 0 && Math.abs(deficit - safeTop) <= 2
  doc.style.setProperty('--vp-deficit', lying ? deficit + 'px' : '0px')
}
correctViewportDeficit()
window.addEventListener('resize', correctViewportDeficit)
window.addEventListener('orientationchange', correctViewportDeficit)
window.addEventListener('pageshow', correctViewportDeficit)
window.visualViewport?.addEventListener('resize', correctViewportDeficit)

// The launch race. For the first moments of a cold standalone open iOS
// reports the safe-area insets as ZERO while already sizing the viewport
// short, so the guard above (rightly) stands down; when the insets appear a
// beat later there is no event announcing them. Waiting for a resize leaves
// the dead strip on screen for however long iOS dawdles. Re-check rapidly
// through the launch window instead: cheap (one probe measurement), bounded,
// and it also covers returning from the background, where iOS re-runs the
// same theatre.
function chaseLaunchRace() {
  let ticks = 0
  const t = setInterval(() => {
    correctViewportDeficit()
    // Twice during the launch window, try to heal the viewport outright.
    // Not on the first ticks: the insets are still settling and a heal
    // before they exist re-measures the same lie.
    if (ticks === 6 || ticks === 15) healViewport()
    if (++ticks >= 30) clearInterval(t)   // 3 seconds, then the listeners own it
  }, 100)
}
chaseLaunchRace()
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { healAttempts = 0; chaseLaunchRace() }
})
// The keyboard leaves the same stuck state; heal shortly after any field
// blurs, per the community fix (140ms lets the keyboard finish retreating).
document.addEventListener('focusout', () => { healAttempts = 0; setTimeout(healViewport, 140) })

// Dev builds report the readings to the dev server's terminal (see
// deviceLogSink in vite.config.js). Only when they change: resize events fire
// in bursts and the numbers, not the events, are the story.
if (import.meta.env.DEV) {
  // Paint probe: see the .debug-strip rule in index.css.
  document.documentElement.classList.add('debug-strip')
  let last = ''
  const report = () => {
    const doc = document.documentElement
    const line = JSON.stringify({
      standalone: window.matchMedia('(display-mode: standalone)').matches
        || window.navigator.standalone === true,
      screenH: window.screen?.height, innerH: window.innerHeight,
      visualH: Math.round(window.visualViewport?.height ?? -1),
      safeTop: getComputedStyle(doc).getPropertyValue('--safe-top').trim(),
      safeBottom: getComputedStyle(doc).getPropertyValue('--safe-bottom').trim(),
      deficit: getComputedStyle(doc).getPropertyValue('--vp-deficit').trim(),
      bodyH: Math.round(document.body.getBoundingClientRect().height),
      // The fullscreen map, when open: the overlay's real height, the
      // leaflet container's real height, and the size Leaflet believes it
      // has. Three numbers that separate "the box is short" from "the box is
      // right and Leaflet has not noticed".
      fsH: (() => {
        const el = [...document.querySelectorAll('div')].find(d =>
          d.style.position === 'fixed' && d.style.zIndex === '9999')
        return el ? Math.round(el.getBoundingClientRect().height) : null
      })(),
      leafH: (() => {
        const el = document.querySelector('.leaflet-container')
        return el ? Math.round(el.getBoundingClientRect().height) : null
      })(),
      leafBelieves: window.__fsMap ? Math.round(window.__fsMap.getSize().y) : null,
      footB: (() => {
        const el = document.querySelector('.fixed-footer-bar')
        return el ? Math.round(el.getBoundingClientRect().bottom) : null
      })(),
      icbH: (() => {
        const el = document.createElement('div')
        el.style.cssText = 'position:fixed;top:0;bottom:0;left:0;width:1px;visibility:hidden;pointer-events:none'
        doc.appendChild(el)
        const h = Math.round(el.getBoundingClientRect().height)
        el.remove()
        return h
      })(),
      // What a fixed inset:0 overlay actually measures on this device. body
      // being right proves nothing about its children if the browser ignored
      // the transform capture; this is the direct answer.
      fixedH: (() => {
        const el = document.createElement('div')
        el.style.cssText = 'position:fixed;inset:0;visibility:hidden;pointer-events:none'
        document.body.appendChild(el)
        const h = Math.round(el.getBoundingClientRect().height)
        el.remove()
        return h
      })(),
    })
    if (line === last) return
    last = line
    try { navigator.sendBeacon('/__device-log', line) } catch { /* dev only */ }
  }
  window.addEventListener('pageshow', report)
  window.addEventListener('resize', report)
  document.addEventListener('visibilitychange', report)
  setTimeout(report, 800)
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
