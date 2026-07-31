/* ── Airport lookup: AWC proxy + bundled OurAirports details ── */
const AWC = '/api/awc'  // Vercel serverless proxy. No CORS issues

// Build URL for our proxy: /api/awc?path=airport&ids=KJFK&format=json
export function awcUrl(endpoint, params = {}) {
  const qs = new URLSearchParams({ path: endpoint, ...params }).toString()
  return `${AWC}?${qs}`
}

// Fallback CORS proxies (TFR feeds and other third-party text endpoints)
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
  // Same-origin /api/ routes: fetch directly, no proxy needed
  if (url.startsWith('/')) {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    const text = await res.text()
    try { return JSON.parse(text) } catch { return null }
  }
  const text = await proxyText(url)
  return JSON.parse(text)
}

/* Airport details: runways and frequencies from the bundled OurAirports
   pack (see scripts/build_geo_pack.py). This replaced scraping skyvector.com
   through a public CORS proxy: two third parties in the path for data that is
   published openly, neither of which worked offline, and one of which forbids
   it in their terms. Comparing the two over a sample, the bundled data matched
   on the common frequencies and carried more of them outside the US (MGGT 6 vs
   3, MSLP 6 vs 3), but it is community-maintained, so a few fields have none
   at all and the UI says so rather than showing an empty list. */
let _details = null
async function getDetails() {
  if (!_details) _details = (await import('../../../data/geo/airport_details.json')).default
  return _details
}

// OurAirports type codes -> labels the frequency grouping in Airport.jsx
// already recognises (it matches on /tower|twr/, /ground|gnd/, and so on).
const FREQ_LABEL = {
  TWR: 'Tower', GND: 'Ground', CLD: 'Clearance Delivery', APP: 'Approach',
  DEP: 'Departure', 'A/D': 'Approach/Departure', ATIS: 'ATIS', CTAF: 'CTAF',
  UNIC: 'UNICOM', AFIS: 'AFIS', CNTR: 'Center', RDO: 'Radio', RMP: 'Ramp',
  ARR: 'Arrival', AWOS: 'AWOS', ASOS: 'ASOS', ATF: 'ATF', FSS: 'FSS',
  EMRG: 'Emergency', OPS: 'Operations', MISC: 'Other',
}

const SURFACE_LABEL = raw => {
  const s = (raw || '').toUpperCase()
  if (/ASP|ASPH/.test(s)) return 'Asphalt'
  if (/CON|CONC/.test(s)) return 'Concrete'
  if (/TURF|GRAS|GRS/.test(s)) return 'Grass'
  if (/GRVL|GRAVEL|GVL/.test(s)) return 'Gravel'
  if (/DIRT|GROUND/.test(s)) return 'Dirt'
  if (/WATER/.test(s)) return 'Water'
  return raw || null
}

const SOURCE_LABEL = {
  FAA: 'FAA NASR',
  AIP: 'COCESNA eAIP',
  OA:  'OurAirports (community)',
}

async function bundledDetails(ids) {
  const all = await getDetails()
  const hit = ids.map(i => all[i]).find(Boolean)
  if (!hit) return { frequencies: [], runways: [], source: null }

  // Trailing zeros go, but a frequency always keeps a decimal: stripping them
  // blindly turned Long Beach ground, 133.0, into "133." on the card.
  const fmtMhz = mhz => {
    const s = mhz.toFixed(3).replace(/0+$/, '')
    return s.endsWith('.') ? `${s}0` : s
  }
  const frequencies = (hit.f || []).map(([type, mhz]) => ({
    type: FREQ_LABEL[type] || type,
    freq: fmtMhz(mhz),
  }))

  // One row per runway becomes two ends, so each can be judged into the wind.
  const runways = []
  for (const [le, he, lenFt, sfc, hdg] of (hit.r || [])) {
    const len = lenFt ? `${lenFt.toLocaleString()} ft` : null
    const surface = SURFACE_LABEL(sfc)
    if (le) runways.push({ id: le, hdg: hdg != null ? Math.round(hdg) % 360 : null, len, sfc: surface, slope: null })
    if (he) runways.push({ id: he, hdg: hdg != null ? Math.round(hdg + 180) % 360 : null, len, sfc: surface, slope: null })
  }
  const cycles = (await getDetails())._meta?.cycles || {}
  const source = hit.s
    ? { code: hit.s, label: SOURCE_LABEL[hit.s] || hit.s, cycle: cycles[hit.s] || null }
    : null
  return { frequencies, runways, source }
}

export async function fetchAWC(id) {
  // Use our Vercel proxy. Avoids CORS and third-party rate limits
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

  const [detResult, awcResult] = await Promise.allSettled([
    // ICAO first, then the FAA-style ident small US fields are keyed by
    bundledDetails([id, id.replace(/^K/, '')]),
    fetchAWC(id),
  ])

  const det = detResult.status === 'fulfilled' ? detResult.value : { frequencies: [], runways: [], source: null }
  const awc = awcResult.status === 'fulfilled' ? awcResult.value : null

  if (!awc && !det.frequencies.length && !det.runways.length) throw new Error('not found')

  // AWC runways carry gradient and alignment; the bundled NASR list carries
  // length and surface. Neither is a superset, and letting AWC win outright. 
  // which it used to. Threw away every runway length we had: KLGB came back
  // with six runway ends, no lengths, and "A" for asphalt, because AWC's
  // records have no length field and a single-letter surface code. Length is
  // the number that decides whether a field is an option at all, so the two
  // are merged per runway end instead of one replacing the other.
  const detailedRunways = []
  for (const rwy of (awc?.runways || [])) {
    const ids = (rwy.id || '').split('/')
    const align = rwy.alignment
    if (ids[0] && align != null) {
      const len = rwy.length ? `${rwy.length.toLocaleString()} ft` : null
      const sfc = SURFACE_LABEL(rwy.surface)
      detailedRunways.push({ id: ids[0], hdg: Math.round(align) % 360, len, sfc, slope: rwy.gradient ?? null })
      if (ids[1]) detailedRunways.push({ id: ids[1], hdg: Math.round(align + 180) % 360, len, sfc, slope: rwy.gradient != null ? -rwy.gradient : null })
    }
  }
  const bundledById = new Map((det.runways || []).map(r => [r.id, r]))
  const runways = detailedRunways.length
    ? detailedRunways.map(r => {
        const b = bundledById.get(r.id)
        return {
          ...r,
          len: r.len ?? b?.len ?? null,
          // A surface "label" of one or two characters is AWC's raw code that
          // SURFACE_LABEL could not resolve, not a name worth showing.
          sfc: (r.sfc && r.sfc.length > 2) ? r.sfc : (b?.sfc ?? null),
        }
      })
    : det.runways

  return {
    icaoId:      id,
    name:        awc?.name || id,
    lat:         awc?.lat  ?? null,
    lon:         awc?.lon  ?? null,
    elevFt:      awc?.elev != null ? Math.round(awc.elev * 3.28084) : null,
    elev:        awc?.elev != null ? `${Math.round(awc.elev * 3.28084)} ft` : null,
    state:       awc?.state  ?? null,
    country:     awc?.country ?? null,
    tower:       awc?.tower  ?? null,
    rwyNum:      runways.length || awc?.rwyNum || null,
    frequencies: det.frequencies,
    freqSource:  det.source,
    runways,
  }
}

/* ── METAR text parser. Decodes raw text into a display object ── */
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
  } else if (s.includes('NSC')) r.clouds = 'NSC. No significant cloud'
  else if (s.includes('NCD')) r.clouds = 'NCD. Nil cloud detected'
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
  if (s.includes('NOSIG')) r.trend = 'NOSIG. No significant change expected'
  else if (s.includes('BECMG')) r.trend = 'BECMG. Conditions becoming…'
  else if (s.includes('TEMPO')) r.trend = 'TEMPO. Temporary conditions expected'

  return r
}

/* ── Geo helpers: bearing / distance between two lat/lon points ── */
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
