/* global process, Buffer */
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import basicSsl from '@vitejs/plugin-basic-ssl'

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

// Dev-only middleware mirroring api/tfr-detail.js — per-TFR floor/ceiling,
// fetched from the FAA's own getWebText API (the WFS layer above has no
// altitude field at all; see api/tfr-detail.js's header comment).
function tfrDetailDevProxy() {
  return {
    name: 'tfr-detail-dev-proxy',
    configureServer(server) {
      server.middlewares.use('/api/tfr-detail', async (req, res) => {
        const { searchParams } = new URL(req.url, 'http://localhost')
        const notamId = searchParams.get('notamId')
        if (!notamId) {
          res.statusCode = 400
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'notamId is required' }))
          return
        }
        try {
          const upstream = await fetch(`https://tfr.faa.gov/tfrapi/getWebText?notamId=${encodeURIComponent(notamId)}`, {
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

// Dev-only middleware mirroring api/procedure-chart.js — same reasoning as
// tfrDevProxy above. Binary-safe on purpose (Buffer, not text()) — see that
// file's header comment for why a naive text-proxy template would corrupt
// the PDF bytes.
function procedureChartDevProxy() {
  const CYCLE_RE = /^\d{3,4}$/
  const PDF_RE = /^[A-Za-z0-9_.-]+\.PDF$/i
  const MAX_BYTES = 4.5 * 1024 * 1024

  return {
    name: 'procedure-chart-dev-proxy',
    configureServer(server) {
      server.middlewares.use('/api/procedure-chart', async (req, res) => {
        const { searchParams } = new URL(req.url, 'http://localhost')
        const cycle = searchParams.get('cycle')
        const pdf = searchParams.get('pdf')

        if (!CYCLE_RE.test(cycle ?? '') || !PDF_RE.test(pdf ?? '')) {
          res.statusCode = 400
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: "cycle and pdf must match the FAA d-TPP metadata feed's own values" }))
          return
        }

        try {
          const upstream = await fetch(`https://aeronav.faa.gov/d-tpp/${cycle}/${pdf}`, {
            headers: { 'User-Agent': 'AVIARA-App/1.0' },
            signal: AbortSignal.timeout(20000),
          })
          if (!upstream.ok) {
            res.statusCode = upstream.status
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: `FAA server returned ${upstream.status}` }))
            return
          }
          const buffer = Buffer.from(await upstream.arrayBuffer())
          if (buffer.length > MAX_BYTES) {
            res.statusCode = 502
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'Chart PDF is too large to proxy' }))
            return
          }
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/pdf')
          res.end(buffer)
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

// Dev-only middleware mirroring api/generate-aircraft-icon.js — same reason
// as awcDevProxy/tfrDevProxy above. Without this, "Generate aircraft icon"
// hit a bare 404 under `npm run dev`, and the frontend's res.json() on that
// empty body threw a raw "Unexpected end of JSON input" instead of a real
// error message. This mirrors the serverless function's own logic (right
// down to the "OPENAI_API_KEY not configured" message) rather than faking a
// different local-only behavior.
function iconDevProxy() {
  const PROMPT = (name) =>
    `Create a stylized 3D transportation icon of a ${name} in a unified premium mobility-app design language inspired by modern ride-sharing vehicle illustrations.

The aircraft should feature smooth, simplified geometry with rounded edges, clean continuous surfaces, and slightly softened proportions while maintaining its instantly recognizable silhouette. Remove all unnecessary technical details including rivets, panel lines, antennas, registration numbers, warning labels, logos, and surface markings.

Render the aircraft with a matte white body and dark smoked glass windows. Use a monochromatic palette consisting primarily of white, light gray, and black accents. The design should feel modern, premium, approachable, and technologically advanced.

Camera angle: front-left three-quarter view, elevated approximately 20 degrees above the aircraft, rotated approximately 35 degrees horizontally, centered composition, 85mm lens equivalent.

Lighting: soft studio lighting with subtle ambient occlusion, gentle shadows, smooth reflections, and clean product-render quality. No dramatic highlights, no harsh shadows, no environmental reflections.

Style: high-end 3D clay render, industrial design visualization, transportation iconography, minimalistic mobility platform aesthetic, consistent fleet design language, designed as if every aircraft in the world was created by the same artist.

Background: pure black (#000000).

The final image should resemble a premium mobility app vehicle icon rather than a realistic aircraft photograph. Maintain the aircraft's essential silhouette while simplifying forms into a clean, unified visual system.`

  return {
    name: 'icon-dev-proxy',
    configureServer(server) {
      server.middlewares.use('/api/generate-aircraft-icon', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'Method not allowed' }))
          return
        }

        let body = ''
        for await (const chunk of req) body += chunk
        let aircraftName
        try { ({ aircraftName } = JSON.parse(body || '{}')) } catch { aircraftName = null }

        if (!aircraftName?.trim()) {
          res.statusCode = 400
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'aircraftName is required' }))
          return
        }

        const apiKey = process.env.OPENAI_API_KEY
        if (!apiKey) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'OPENAI_API_KEY not configured' }))
          return
        }

        try {
          const openaiRes = await fetch('https://api.openai.com/v1/images/generations', {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'dall-e-3', prompt: PROMPT(aircraftName.trim()), n: 1, size: '1024x1024', quality: 'standard' }),
          })

          if (!openaiRes.ok) {
            const err = await openaiRes.json().catch(() => ({}))
            res.statusCode = openaiRes.status
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: err.error?.message ?? 'OpenAI request failed' }))
            return
          }

          const data = await openaiRes.json()
          const imageUrl = data.data[0].url
          const imgRes = await fetch(imageUrl)
          const buffer = await imgRes.arrayBuffer()
          const base64 = Buffer.from(buffer).toString('base64')

          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ image: `data:image/png;base64,${base64}` }))
        } catch (err) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: err.message }))
        }
      })
    },
  }
}

// Dev-only middleware mirroring api/extract-poh-chart.js — same reasoning as
// iconDevProxy above, right down to duplicating the chart-type metadata and
// prompt builder rather than importing across the Vite/Vercel runtime split.
function pohDevProxy() {
  const CHART_TYPE_META = {
    takeoff: { label: 'Takeoff Distance', axis1Label: 'Pressure Altitude', axis1Unit: 'ft', axis2Label: 'OAT', axis2Unit: '°C', outputs: [{ key: 'groundRoll', label: 'Ground Roll', unit: 'ft' }, { key: 'over50', label: 'Over 50ft', unit: 'ft' }] },
    landing: { label: 'Landing Distance', axis1Label: 'Pressure Altitude', axis1Unit: 'ft', axis2Label: 'OAT', axis2Unit: '°C', outputs: [{ key: 'groundRoll', label: 'Ground Roll', unit: 'ft' }, { key: 'over50', label: 'Over 50ft', unit: 'ft' }] },
    climb: { label: 'Climb Performance', axis1Label: 'Pressure Altitude', axis1Unit: 'ft', axis2Label: 'OAT', axis2Unit: '°C', outputs: [{ key: 'value', label: 'Rate of Climb', unit: 'fpm' }] },
    cruise: { label: 'Cruise Performance', axis1Label: 'Pressure Altitude', axis1Unit: 'ft', axis2Label: 'RPM / % Power', axis2Unit: '', outputs: [{ key: 'tas', label: 'TAS', unit: 'kt' }, { key: 'ff', label: 'Fuel Flow', unit: 'GPH' }] },
  }

  function buildPrompt(meta) {
    const outputsDesc = meta.outputs.map(o => `"${o.key}" (${o.label}${o.unit ? `, ${o.unit}` : ''})`).join(' and ')
    const cellShape = meta.outputs.length > 1
      ? `an object like {${meta.outputs.map(o => `"${o.key}": <number>`).join(', ')}}`
      : 'a plain number'

    return `You are reading a page photographed from an aircraft's Pilot Operating Handbook (POH), showing a ${meta.label} performance chart. It may be printed as a table or as a graph with gridlines.

This chart has two axes:
- Axis 1: ${meta.axis1Label} (${meta.axis1Unit}) — the chart's rows (or, on a graph, one set of gridlines)
- Axis 2: ${meta.axis2Label}${meta.axis2Unit ? ` (${meta.axis2Unit})` : ''} — the chart's columns (or the graph's other gridline set)

Each cell holds ${outputsDesc}.

Read the EXACT values printed on the chart's own rows/columns/gridlines — never invent round numbers or interpolate between printed values yourself. If a cell isn't legible or the chart doesn't cover it, omit it (use null) rather than guessing.

Also capture, in a couple of sentences, any correction-factor conditions printed on the chart itself (flaps setting, runway surface, headwind/weight assumptions, etc.) — this is for the pilot's own reference, not for you to apply.

Respond with strict JSON in exactly this shape, and nothing else:
{
  "axis1": { "values": [<numbers, ascending, exactly as printed>] },
  "axis2": { "values": [<numbers, ascending, exactly as printed>] },
  "cells": [ [ <row for axis1.values[0]>, <row for axis1.values[1]>, ... ] ],
  "notes": "<conditions printed on the chart, or an empty string>"
}
Each row in "cells" must have one entry per axis2 value, in the same order as "axis2.values", and each entry is ${cellShape} or null.`
  }

  return {
    name: 'poh-dev-proxy',
    configureServer(server) {
      server.middlewares.use('/api/extract-poh-chart', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'Method not allowed' }))
          return
        }

        let body = ''
        for await (const chunk of req) body += chunk
        let chartType, imageDataUrl
        try { ({ chartType, imageDataUrl } = JSON.parse(body || '{}')) } catch { chartType = null }

        const meta = CHART_TYPE_META[chartType]
        if (!meta) {
          res.statusCode = 400
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'chartType must be one of takeoff, landing, climb, cruise' }))
          return
        }
        if (!imageDataUrl?.startsWith('data:image/')) {
          res.statusCode = 400
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'imageDataUrl is required' }))
          return
        }

        const apiKey = process.env.OPENAI_API_KEY
        if (!apiKey) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'OPENAI_API_KEY not configured' }))
          return
        }

        try {
          const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'gpt-4o',
              response_format: { type: 'json_object' },
              max_tokens: 2000,
              messages: [{
                role: 'user',
                content: [
                  { type: 'text', text: buildPrompt(meta) },
                  { type: 'image_url', image_url: { url: imageDataUrl } },
                ],
              }],
            }),
          })

          if (!openaiRes.ok) {
            const err = await openaiRes.json().catch(() => ({}))
            res.statusCode = openaiRes.status
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: err.error?.message ?? 'OpenAI request failed' }))
            return
          }

          const data = await openaiRes.json()
          const content = data.choices?.[0]?.message?.content
          let chart
          try {
            chart = JSON.parse(content)
          } catch {
            res.statusCode = 502
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'AI response was not valid JSON — try again' }))
            return
          }

          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ chart }))
        } catch (err) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: err.message }))
        }
      })
    },
  }
}

// Same AI-photo-extraction pattern as pohDevProxy() above — dev-server
// mirror of api/extract-logbook-page.js, prompt/logic hand-duplicated for
// the same "separate bundling contexts" reason (see that file's own header
// comment).
function logbookPageDevProxy() {
  const PROMPT = `You are reading a page photographed from a pilot's paper flight logbook. It has one row per flight, with column headers at the top — these vary between logbooks and pilots, so read whatever headers this specific page actually uses.

For each row, extract as many of these fields as the page has columns for (map the page's own column headers to these — e.g. a column labeled "A/C" or "Tail #" maps to aircraftReg; a column labeled "Total" or "Total Time" maps to totalTime):
- date (YYYY-MM-DD if the year is legible on the page, otherwise MM-DD)
- aircraftReg (tail number, e.g. N12345)
- from, to (departure/destination airport identifiers)
- route
- totalTime, pic, sic, night, solo, crossCountry (decimal hours or nm, exactly as printed)
- dayTakeoffs, nightTakeoffs, dayLandings, nightLandings (integer counts)
- actualInstrument, simulatedInstrument, holds, dualGiven, dualReceived, groundTraining (decimal hours or counts, exactly as printed)
- comments (any remarks column)

Read only what's actually legible and printed on the page — never invent or guess a value you can't clearly read, and never fill in a zero for a blank cell. If a cell is blank, illegible, or the page has no column for a field, omit that field from that row entirely.

Respond with strict JSON in exactly this shape, and nothing else:
{ "entries": [ { "date": "...", "aircraftReg": "...", "from": "...", ... }, ... ] }
Every entry in the array is one row/flight from the page, in the order they appear top to bottom.`

  return {
    name: 'logbook-page-dev-proxy',
    configureServer(server) {
      server.middlewares.use('/api/extract-logbook-page', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'Method not allowed' }))
          return
        }

        let body = ''
        for await (const chunk of req) body += chunk
        let imageDataUrl
        try { ({ imageDataUrl } = JSON.parse(body || '{}')) } catch { imageDataUrl = null }

        if (!imageDataUrl?.startsWith('data:image/')) {
          res.statusCode = 400
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'imageDataUrl is required' }))
          return
        }

        const apiKey = process.env.OPENAI_API_KEY
        if (!apiKey) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'OPENAI_API_KEY not configured' }))
          return
        }

        try {
          const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'gpt-4o',
              response_format: { type: 'json_object' },
              max_tokens: 4000,
              messages: [{
                role: 'user',
                content: [
                  { type: 'text', text: PROMPT },
                  { type: 'image_url', image_url: { url: imageDataUrl } },
                ],
              }],
            }),
          })

          if (!openaiRes.ok) {
            const err = await openaiRes.json().catch(() => ({}))
            res.statusCode = openaiRes.status
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: err.error?.message ?? 'OpenAI request failed' }))
            return
          }

          const data = await openaiRes.json()
          const content = data.choices?.[0]?.message?.content
          let parsed
          try {
            parsed = JSON.parse(content)
          } catch {
            res.statusCode = 502
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'AI response was not valid JSON — try again' }))
            return
          }

          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ entries: Array.isArray(parsed.entries) ? parsed.entries : [] }))
        } catch (err) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: err.message }))
        }
      })
    },
  }
}

// Phone testing needs HTTPS + a network-visible host, since phone browsers
// block location access on a plain http:// LAN address. That's off by
// default (`npm run dev`) so the regular local workflow is untouched, and
// only turns on for `npm run dev:phone`.
const phoneTest = process.env.PHONE_TEST === '1'

export default defineConfig(({ mode }) => {
  // Vite only loads .env vars prefixed VITE_ into import.meta.env by
  // default — arbitrary vars like OPENAI_API_KEY need to be loaded here
  // and merged into process.env so the dev-proxy plugins above (which run
  // in this Node process, not the client bundle) can read them the same
  // way the real Vercel serverless functions do via process.env.
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''))

  return {
    server: {
      // Vite rejects requests whose Host header it doesn't recognise, which
      // blocks the phone preview served through a Cloudflare quick tunnel.
      // The leading dot allows any *.trycloudflare.com subdomain — the quick
      // tunnel picks a fresh random one on every run.
      allowedHosts: ['.trycloudflare.com'],
      ...(phoneTest ? { host: true } : {}),
    },
    plugins: [
      awcDevProxy(),
      tfrDevProxy(),
      deviceLogSink(),
      tfrDetailDevProxy(),
      iconDevProxy(),
      pohDevProxy(),
      logbookPageDevProxy(),
      procedureChartDevProxy(),
      react(),
      tailwindcss(),
      ...(phoneTest ? [basicSsl()] : []),
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
          // world reference layer, airports, airways, navaids, procedure
          // indexes — is deliberately NOT precached. Together it is over
          // 10 MB, and precaching means the phone must download all of it
          // before a new version will activate: on a weak connection the
          // install fails, retries, and the app appears not to update at
          // all. It is cached on first use instead (below), so it is still
          // there offline once a route has been planned.
          globIgnores: [
            '**/assets/{fixes,land,airport_details,world_ref,airports,airport_search,airways,navaids,cenamer_airspace,preferred_routes,procedures,procedures_index,aux_aerodromes}-*.js',
          ],
          maximumFileSizeToCacheInBytes: 2 * 1024 * 1024,
          runtimeCaching: [
            {
              // Content-hashed filenames, so a cached copy is never stale — a
              // new build simply asks for a different URL. maxEntries clears
              // the ones previous builds left behind.
              urlPattern: /\/assets\/(fixes|land|airport_details|world_ref|airports|airport_search|airways|navaids|cenamer_airspace|preferred_routes|procedures|procedures_index|aux_aerodromes)-[^/]+\.js$/,
              handler: 'CacheFirst',
              options: {
                cacheName: 'aviara-navdata',
                expiration: { maxEntries: 20, purgeOnQuotaError: true },
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
  }
})
