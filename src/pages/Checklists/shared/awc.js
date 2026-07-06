/* ── Airport lookup — AWC proxy + SkyVector scraper ─────────── */
const AWC = '/api/awc'  // Vercel serverless proxy — no CORS issues

// Build URL for our proxy: /api/awc?path=airport&ids=KJFK&format=json
export function awcUrl(endpoint, params = {}) {
  const qs = new URLSearchParams({ path: endpoint, ...params }).toString()
  return `${AWC}?${qs}`
}

// Fallback CORS proxies for SkyVector (HTML scraping only)
const PROXIES = [
  { url: 'https://corsproxy.io/?url=',         wrap: false },
  { url: 'https://api.allorigins.win/raw?url=', wrap: false },
]

export async function proxyFetch(url, timeout = 8000) {
  for (const { url: proxy, wrap } of PROXIES) {
    try {
      const res = await fetch(proxy + encodeURIComponent(url), { signal: AbortSignal.timeout(timeout) })
      if (!res.ok) continue
      const text = await res.text()
      if (wrap) {
        try { const env = JSON.parse(text); if (env?.contents) return env.contents } catch { /* not JSON-wrapped */ }
      }
      return text
    } catch { /* fetch failed, try next URL */ }
  }
  throw new Error('All proxies failed')
}

export async function proxyText(url) {
  return proxyFetch(url, 5000)
}

export async function proxyJSON(url) {
  // Same-origin /api/ routes — fetch directly, no proxy needed
  if (url.startsWith('/')) {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    const text = await res.text()
    try { return JSON.parse(text) } catch { return null }
  }
  const text = await proxyText(url)
  return JSON.parse(text)
}

/* Parse SkyVector airport page HTML → { frequencies, runways, elevation, coords, name } */
function parseSkyVector(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html')

  // Airport name from <title> or first <h1>
  const rawTitle = doc.querySelector('title')?.textContent || ''
  const name = rawTitle.split(' - ')[0].trim()

  const frequencies = []
  const runways     = []
  let   elevation   = null
  let   coords      = null
  let   country     = null

  // Walk every <tr> — SkyVector renders airport data in definition-style tables
  doc.querySelectorAll('tr').forEach(row => {
    const cells = [...row.querySelectorAll('td, th')]
    if (cells.length < 2) return
    const label = cells[0].textContent.trim()
    const value = cells[1].textContent.trim()

    // Frequencies — aviation VHF range 108.0–136.975 MHz only
    const FREQ_RE = /\b(1(?:0[89]|[12]\d|3[0-6])\.\d{1,3})\b/g
    const allFreqs = [...value.matchAll(FREQ_RE)].map(m => m[1])
    if (allFreqs.length && label) {
      const segments = value.split(/;/).map(s => s.trim()).filter(Boolean)
      allFreqs.forEach((freq, idx) => {
        const seg = segments[idx] || ''
        const qualifier = seg.replace(FREQ_RE, '').replace(/Tel\..*/, '').replace(/^\s*;?\s*/, '').trim()
        const type = qualifier ? `${label} ${qualifier}`.trim() : label
        if (!frequencies.find(f => f.freq === freq && f.type === type)) {
          frequencies.push({ type, freq })
        }
      })
    }

    // Elevation — label contains "Elev" or value contains "ft"
    if (!elevation && /elev/i.test(label) && /\d/.test(value)) {
      elevation = value.replace(/[^\d\s\-ft]/g, '').trim()
    }

    // Coordinates — label contains "Lat" / "Lon" or value matches coord pattern
    if (!coords && /lat/i.test(label) && /\d/.test(value)) {
      coords = value
    }

    // Country / Location
    if (!country && /country|location/i.test(label)) {
      country = value
    }

    // Runways — label matches runway ID pattern like "14/32" or "07L/25R"
    if (/^\d{2}[LRC]?\/\d{2}[LRC]?$/.test(label)) {
      runways.push({ id: label, info: value })
    }
  })

  // Also scan individual <td> cells for runway IDs (some SkyVector layouts differ)
  if (!runways.length) {
    doc.querySelectorAll('td').forEach(td => {
      const text = td.textContent.trim()
      if (/^\d{2}[LRC]?\/\d{2}[LRC]?$/.test(text)) {
        const next = td.nextElementSibling?.textContent.trim() || ''
        if (!runways.find(r => r.id === text)) {
          runways.push({ id: text, info: next })
        }
      }
    })
  }

  // Airport diagram PDF — SkyVector links it as /files/tpp/CYCLE/pdf/XXXXXAD.PDF
  let diagramUrl = null
  doc.querySelectorAll('a[href]').forEach(a => {
    if (!diagramUrl && /AD\.PDF$/i.test(a.getAttribute('href'))) {
      const href = a.getAttribute('href')
      diagramUrl = href.startsWith('http') ? href : `https://skyvector.com${href}`
    }
  })

  return { name, elevation, coords, country, frequencies, runways, diagramUrl }
}

export async function fetchAWC(id) {
  // Use our Vercel proxy — avoids CORS and third-party rate limits
  try {
    const res = await fetch(awcUrl('airport', { ids: id, format: 'json' }), { signal: AbortSignal.timeout(8000) })
    const data = await res.json()
    if (Array.isArray(data) && data.length) return data[0]
  } catch { /* ignore */ }
  try {
    const res = await fetch(awcUrl('metar', { ids: id, format: 'json', hours: '3' }), { signal: AbortSignal.timeout(8000) })
    const metar = await res.json()
    if (Array.isArray(metar) && metar.length) {
      const m = metar[0]
      return { icaoId: m.icaoId || id, faaId: m.stationId || id, name: m.site, lat: m.lat, lon: m.lon, elev: m.elev, state: m.state, country: m.country, tower: null, rwyNum: null }
    }
  } catch { /* ignore */ }
  return null
}

export async function lookupAirport(icao) {
  const id = icao.toUpperCase()

  // Fire SkyVector + AWC in parallel — cuts wait time roughly in half
  const [svResult, awcResult] = await Promise.allSettled([
    proxyText(`https://skyvector.com/airport/${id}`),
    fetchAWC(id),
  ])

  const sv  = svResult.status  === 'fulfilled' ? parseSkyVector(svResult.value) : { name: '', elevation: null, country: null, frequencies: [], runways: [] }
  const awc = awcResult.status === 'fulfilled' ? awcResult.value : null

  if (!sv.name && !awc) throw new Error('not found')

  // Build detailed runway list from AWC data
  const detailedRunways = []
  for (const rwy of (awc?.runways || [])) {
    const ids = (rwy.id || '').split('/')
    const align = rwy.alignment
    if (ids[0] && align != null) {
      const sfcRaw = rwy.surface || ''
      const sfc = /asph|^a$/i.test(sfcRaw) ? 'Asphalt' : /conc|^c$/i.test(sfcRaw) ? 'Concrete' : /turf|grass|^t$/i.test(sfcRaw) ? 'Grass' : /gravel|^g$/i.test(sfcRaw) ? 'Gravel' : /dirt|^d$/i.test(sfcRaw) ? 'Dirt' : /water|^w$/i.test(sfcRaw) ? 'Water' : sfcRaw || null
      const len = rwy.length ? `${rwy.length.toLocaleString()} ft` : null
      detailedRunways.push({ id: ids[0], hdg: Math.round(align) % 360, len, sfc, slope: rwy.gradient ?? null })
      if (ids[1]) detailedRunways.push({ id: ids[1], hdg: Math.round(align + 180) % 360, len, sfc, slope: rwy.gradient != null ? -rwy.gradient : null })
    }
  }

  return {
    icaoId:      id,
    name:        sv.name || awc?.name || id,
    lat:         awc?.lat  ?? null,
    lon:         awc?.lon  ?? null,
    elevFt:      awc?.elev != null ? Math.round(awc.elev * 3.28084) : null,
    elev:        awc?.elev != null ? `${Math.round(awc.elev * 3.28084)} ft` : sv.elevation || null,
    state:       awc?.state  ?? null,
    country:     sv.country  || awc?.country || null,
    tower:       awc?.tower  ?? null,
    rwyNum:      detailedRunways.length || sv.runways.length || awc?.rwyNum || null,
    frequencies: sv.frequencies,
    runways:     detailedRunways.length ? detailedRunways : sv.runways,
  }
}

/* ── METAR text parser — decodes raw text into a display object ── */
export function parseMetar(raw) {
  const s = raw.trim().toUpperCase().replace(/\s+/g, ' ')
  const r = {}

  // Station
  const sta = s.match(/\b([A-Z]{4})\s+\d{6}Z\b/)
  if (sta) r.station = sta[1]

  // Time
  const t = s.match(/\b(\d{2})(\d{2})(\d{2})Z\b/)
  if (t) r.time = `Day ${t[1]}, ${t[2]}:${t[3]}Z`

  // Wind
  const w = s.match(/\b(VRB|\d{3})(\d{2,3})(?:G(\d{2,3}))?(KT|MPS)\b/)
  if (w) {
    const dir = w[1] === 'VRB' ? 'Variable' : `${w[1]}°`
    const spd = `${parseInt(w[2])} ${w[4]}`
    const gst = w[3] ? ` gusting ${parseInt(w[3])} ${w[4]}` : ''
    r.wind = `${dir} at ${spd}${gst}`
  }
  const wv = s.match(/\b(\d{3})V(\d{3})\b/)
  if (wv) r.windVar = `Variable ${wv[1]}°–${wv[2]}°`

  // Visibility
  const vis = s.match(/\b(CAVOK|9999|\d{4})\b/)
  if (vis) {
    if (vis[1] === 'CAVOK') r.vis = 'CAVOK (>10 km, no cloud below 5,000 ft)'
    else if (vis[1] === '9999') r.vis = '>10 km'
    else r.vis = `${parseInt(vis[1])} m`
  }

  // Weather phenomena
  const wxMap = {
    RA:'Rain',DZ:'Drizzle',SN:'Snow',SG:'Snow grains',IC:'Ice crystals',
    PL:'Ice pellets',GR:'Hail',GS:'Small hail',FG:'Fog',BR:'Mist',
    HZ:'Haze',SA:'Sand',DU:'Dust',FU:'Smoke',VA:'Volcanic ash',
    TS:'Thunderstorm',SH:'Showers',FZ:'Freezing',
  }
  const wxMatches = [...s.matchAll(/\b([+-])?(VC)?(TS|SH|FZ)?(FG|BR|HZ|RA|DZ|SN|SG|IC|PL|GR|GS|SA|DU|FU|VA)\b/g)]
  if (wxMatches.length) {
    r.wx = wxMatches.map(m => {
      const i = m[1] === '+' ? 'Heavy ' : m[1] === '-' ? 'Light ' : ''
      const v = m[2] ? 'Vicinity ' : ''
      const d = m[3] ? (wxMap[m[3]] || m[3]) + ' ' : ''
      return `${i}${v}${d}${wxMap[m[4]] || m[4]}`
    }).join(', ')
  }

  // Clouds
  const cl = [...s.matchAll(/\b(FEW|SCT|BKN|OVC)(\d{3})(CB|TCU)?\b/g)]
  if (cl.length) {
    r.clouds = cl.map(m => {
      const alt = parseInt(m[2]) * 100
      const type = m[3] ? ` (${m[3]})` : ''
      return `${m[1]} at ${alt.toLocaleString()} ft${type}`
    }).join(' · ')
  } else if (s.includes('NSC')) r.clouds = 'NSC — No significant cloud'
  else if (s.includes('NCD')) r.clouds = 'NCD — Nil cloud detected'
  else if (s.includes('CAVOK')) r.clouds = 'CAVOK'

  // Temp / Dew
  const td = s.match(/\b(M?\d{2})\/(M?\d{2})\b/)
  if (td) {
    const parse = v => v.startsWith('M') ? `−${v.slice(1)}°C` : `${v}°C`
    r.temp = parse(td[1])
    r.dew  = parse(td[2])
  }

  // QNH
  const q = s.match(/\bQ(\d{4})\b/)
  if (q) r.qnh = `${q[1]} hPa / ${(parseInt(q[1]) / 33.8639).toFixed(2)} inHg`
  const a = s.match(/\bA(\d{4})\b/)
  if (a && !q) {
    const inhg = parseInt(a[1]) / 100
    r.qnh = `${(inhg * 33.8639).toFixed(0)} hPa / ${inhg.toFixed(2)} inHg`
  }

  // Trend
  if (s.includes('NOSIG')) r.trend = 'NOSIG — No significant change expected'
  else if (s.includes('BECMG')) r.trend = 'BECMG — Conditions becoming…'
  else if (s.includes('TEMPO')) r.trend = 'TEMPO — Temporary conditions expected'

  return r
}

/* ── Geo helpers — bearing / distance between two lat/lon points ── */
export function bearingDeg(lat1, lon1, lat2, lon2) {
  const φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180
  const Δλ = (lon2 - lon1) * Math.PI / 180
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360
}
export function haversineNm(lat1, lon1, lat2, lon2) {
  const R = 3440.065
  const φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180
  const Δφ = (lat2 - lat1) * Math.PI / 180, Δλ = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(Δφ/2)**2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2)**2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
}
