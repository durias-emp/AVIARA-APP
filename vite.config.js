import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// Dev-only middleware mirroring api/awc.js — Vite's dev server doesn't run
// Vercel serverless functions, so /api/awc 404s under `npm run dev` even
// though it works fine once deployed. Without this, every airport lookup
// looks "broken" locally regardless of the actual proxy's health.
// Dev-only middleware mirroring api/tfr.js (same reasoning as awcDevProxy).
// Dev-only sink for on-device measurements. The numbers that decide whether
// the app fills the screen exist only on the phone: the desktop preview
// reports zero insets, and the phone's console does not reach this terminal.
// main.jsx (dev builds only) posts its viewport readings here, so opening the
// app on the phone prints the truth where the developer is actually looking.
function deviceLogSink() {
  return {
    name: 'device-log-sink',
    configureServer(server) {
      server.middlewares.use('/__device-log', (req, res) => {
        let body = ''
        req.on('data', (c) => { body += c })
        req.on('end', () => {
          try {
            console.log('\n[device] ' + JSON.stringify(JSON.parse(body)))
          } catch { console.log('\n[device] ' + body.slice(0, 500)) }
          res.statusCode = 204
          res.end()
        })
      })
    },
  }
}

// Dev-only middleware mirroring api/traffic.js. Vercel functions do not run
// under `npm run dev`, so without this the traffic layer 404s locally while
// working perfectly once deployed, which is the most misleading failure of
// all. Kept deliberately thin: it delegates to the real handler rather than
// reimplementing it, so the two cannot drift.
function trafficDevProxy() {
  return {
    name: 'traffic-dev-proxy',
    configureServer(server) {
      server.middlewares.use('/api/traffic', async (req, res) => {
        const url = new URL(req.url, 'http://localhost')
        const query = Object.fromEntries(url.searchParams)
        const { default: handler } = await server.ssrLoadModule('/api/traffic.js')
        // The handler expects the Vercel request/response shape.
        const shim = {
          status(code) { res.statusCode = code; return shim },
          setHeader(k, v) { res.setHeader(k, v); return shim },
          json(body) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)) },
          send(body) { res.end(body) },
        }
        try {
          await handler({ query }, shim)
        } catch (err) {
          res.statusCode = 502
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'dev proxy failed', detail: err.message }))
        }
      })
    },
  }
}

function tfrDevProxy() {
  const WFS_URL =
    'https://tfr.faa.gov/geoserver/TFR/ows?service=WFS&version=1.1.0&request=GetFeature' +
    '&typeName=TFR:V_TFR_LOC&maxFeatures=300&outputFormat=application/json&srsname=EPSG:4326'
  return {
    name: 'tfr-dev-proxy',
    configureServer(server) {
      server.middlewares.use('/api/tfr', async (req, res) => {
        try {
          const upstream = await fetch(WFS_URL, {
            headers: { 'User-Agent': 'AVIARA-App/1.0' },
            signal: AbortSignal.timeout(15000),
          })
          const text = await upstream.text()
          res.statusCode = upstream.status
          res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json')
          res.end(text)
        } catch (err) {
          res.statusCode = 502
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'upstream fetch failed', detail: err.message }))
        }
      })
    },
  }
}

function awcDevProxy() {
  return {
    name: 'awc-dev-proxy',
    configureServer(server) {
      server.middlewares.use('/api/awc', async (req, res) => {
        const { searchParams } = new URL(req.url, 'http://localhost')
        const path = searchParams.get('path')
        searchParams.delete('path')

        if (!path) {
          res.statusCode = 400
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'path required' }))
          return
        }

        const qs = searchParams.toString()
        const url = `https://aviationweather.gov/api/data/${path}${qs ? '?' + qs : ''}`

        try {
          const upstream = await fetch(url, {
            headers: { 'User-Agent': 'PQRH-App/1.0' },
            signal: AbortSignal.timeout(10000),
          })
          const text = await upstream.text()
          res.statusCode = upstream.status
          res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json')
          res.end(text)
        } catch (err) {
          res.statusCode = 502
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'upstream fetch failed', detail: err.message }))
        }
      })
    },
  }
}

export default defineConfig({
  server: {
    // Vite rejects requests whose Host header it doesn't recognise, which
    // blocks the phone preview served through a Cloudflare quick tunnel.
    // The leading dot allows any *.trycloudflare.com subdomain — the quick
    // tunnel picks a fresh random one on every run.
    allowedHosts: ['.trycloudflare.com'],
  },
  plugins: [
    awcDevProxy(),
    tfrDevProxy(),
    deviceLogSink(),
    trafficDevProxy(),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'favicon-32x32.png', 'favicon-16x16.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'AVIARA – Pilot Quick Reference Handbook',
        short_name: 'AVIARA',
        description: 'Offline pilot quick reference: calculators, checklists, air law, currency tracker.',
        // matches --bg in the dark theme, so the install splash and app
        // surface are the same colour instead of slate vs near-black
        theme_color: '#000000',
        background_color: '#000000',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'pwa-maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // The aeronautical data — fixes, coastline, airport details, the
        // world reference layer, airports, airways, navaids — is deliberately
        // NOT precached. Together it is over 10 MB, and precaching means the
        // phone must download all of it before a new version will activate: on
        // a weak connection the install fails, retries, and the app appears
        // not to update at all. It is cached on first use instead (below), so
        // it is still there offline once a route has been planned.
        globIgnores: [
          '**/assets/{fixes,land,airport_details,world_ref,airports,airways,navaids,cenamer_airspace,preferred_routes,procedures}-*.js',
        ],
        maximumFileSizeToCacheInBytes: 2 * 1024 * 1024,
        runtimeCaching: [
          {
            // Content-hashed filenames, so a cached copy is never stale — a new
            // build simply asks for a different URL. maxEntries clears the ones
            // previous builds left behind.
            urlPattern: /\/assets\/(fixes|land|airport_details|world_ref|airports|airways|navaids|cenamer_airspace|preferred_routes|procedures)-[^/]+\.js$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'aviara-navdata',
              expiration: { maxEntries: 16, purgeOnQuotaError: true },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/aviationweather\.gov\/.*/i,
            handler: 'NetworkFirst',
            options: { cacheName: 'wx-cache', networkTimeoutSeconds: 10 },
          },
        ],
      },
    }),
  ],
})
