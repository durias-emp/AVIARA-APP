import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// A new build activates immediately (the service worker is generated with
// skipWaiting and clientsClaim) but the page already on screen keeps running
// the code it loaded with. On a phone that page can survive for days —
// swiping a PWA away often resumes it rather than restarting it — so fixes
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
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
