import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import FAA_CHARTS_DATA from '../../data/faa_charts.json'
import { BackButton } from '../../components/Shell'
import WBChecklistItem from './WBChecklistItem'
import { get, put } from '../../lib/db'
import { getCurrencyStatus, fmtDate, fmtDaysLeft, calendarMonthExpiry, daysCurrencyExpiry, statusFromExpiry } from '../../lib/currency'
import { MapContainer, TileLayer, Marker, Polyline, Polygon, CircleMarker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'

delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

const airportIcon = new L.DivIcon({
  className: '',
  html: `<div style="width:12px;height:12px;border-radius:50%;background:#fff;border:2.5px solid #333;box-shadow:0 1px 6px rgba(0,0,0,0.4)"></div>`,
  iconSize: [12, 12], iconAnchor: [6, 6],
})

function RouteFitter({ positions }) {
  const map = useMap()
  useEffect(() => {
    if (positions.length >= 2) {
      map.fitBounds(L.latLngBounds(positions), { padding: [36, 36] })
    }
  }, [JSON.stringify(positions)])
  return null
}

function AirspaceZoomer({ active }) {
  const map = useMap()
  useEffect(() => {
    if (active && map.getZoom() < 8) {
      map.setZoom(9)
    }
  }, [active])
  return null
}

function SectionalZoomer({ active }) {
  const map = useMap()
  useEffect(() => {
    if (active && map.getZoom() < 7) map.setZoom(7)
  }, [active])
  // Keep enforcing min zoom while sectional is on (user may zoom out)
  useEffect(() => {
    if (!active) return
    const onZoom = () => { if (map.getZoom() < 6) map.setZoom(6) }
    map.on('zoomend', onZoom)
    return () => map.off('zoomend', onZoom)
  }, [active])
  return null
}

function MapInvalidator() {
  const map = useMap()
  useEffect(() => {
    setTimeout(() => map.invalidateSize(), 50)
  }, [])
  return null
}

function MapFlyTo({ target, instant = false }) {
  const map = useMap()
  useEffect(() => {
    if (!target) return
    if (instant) map.setView([target.lat, target.lon], target.zoom ?? 10, { animate: false })
    else map.flyTo([target.lat, target.lon], target.zoom ?? 10, { duration: 1.2 })
  }, [target])
  return null
}

// Line-segment intersection (2D, lat/lon space)
function segmentsIntersect(p1, p2, p3, p4) {
  const d = (p2[0]-p1[0])*(p4[1]-p3[1]) - (p2[1]-p1[1])*(p4[0]-p3[0])
  if (Math.abs(d) < 1e-10) return false
  const t = ((p3[0]-p1[0])*(p4[1]-p3[1]) - (p3[1]-p1[1])*(p4[0]-p3[0])) / d
  const u = ((p3[0]-p1[0])*(p2[1]-p1[1]) - (p3[1]-p1[1])*(p2[0]-p1[0])) / d
  return t >= 0 && t <= 1 && u >= 0 && u <= 1
}

// Point-in-polygon (ray casting)
function pointInPoly(pt, poly) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j]
    if (((yi > pt[1]) !== (yj > pt[1])) && pt[0] < ((xj-xi)*(pt[1]-yi)/(yj-yi)+xi))
      inside = !inside
  }
  return inside
}

// Does the route (array of {lat,lon} waypoints) cross or enter a polygon [lat,lon][]?
function routeIntersectsPoly(waypoints, poly) {
  for (let s = 0; s < waypoints.length - 1; s++) {
    const ra = [waypoints[s].lat, waypoints[s].lon]
    const rb = [waypoints[s+1].lat, waypoints[s+1].lon]
    if (pointInPoly(ra, poly) || pointInPoly(rb, poly)) return true
    for (let i = 0, j = poly.length-1; i < poly.length; j = i++) {
      if (segmentsIntersect(ra, rb, poly[j], poly[i])) return true
    }
  }
  return false
}

// Format decimal lat/lon → aviation DMS notation: N25°47'42" W080°17'24"
function fmtAvCoord(lat, lon) {
  const fmt = (val, padDeg) => {
    const d = Math.floor(Math.abs(val))
    const mFull = (Math.abs(val) - d) * 60
    const m = Math.floor(mFull)
    const s = Math.round((mFull - m) * 60)
    return `${String(d).padStart(padDeg, '0')}°${String(m).padStart(2,'0')}'${String(s).padStart(2,'0')}"`
  }
  const ns = lat >= 0 ? 'N' : 'S', ew = lon >= 0 ? 'E' : 'W'
  return `${ns}${fmt(lat, 2)} ${ew}${fmt(lon, 3)}`
}

// Cross-track distance from point (la,lo) to great-circle segment (a→b), in NM
function crossTrackNM(la, lo, a, b) {
  const R = 3440.065 // NM
  const toRad = d => d * Math.PI / 180
  const [lat1,lon1] = a.map(toRad), [lat2,lon2] = b.map(toRad)
  const [lat3,lon3] = [toRad(la), toRad(lo)]
  const d13 = Math.acos(Math.sin(lat1)*Math.sin(lat3)+Math.cos(lat1)*Math.cos(lat3)*Math.cos(lon3-lon1))
  const θ13 = Math.atan2(Math.sin(lon3-lon1)*Math.cos(lat3), Math.cos(lat1)*Math.sin(lat3)-Math.sin(lat1)*Math.cos(lat3)*Math.cos(lon3-lon1))
  const θ12 = Math.atan2(Math.sin(lon2-lon1)*Math.cos(lat2), Math.cos(lat1)*Math.sin(lat2)-Math.sin(lat1)*Math.cos(lat2)*Math.cos(lon2-lon1))
  return Math.abs(Math.asin(Math.sin(d13)*Math.sin(θ13-θ12))) * R
}

// DraggableWaypoint — draggable intermediate marker (touch-safe)
function DraggableWaypoint({ position, index, onMove, onRemove }) {
  const markerRef = useRef(null)
  // touch-action:none is critical — prevents browser scroll from hijacking the drag
  const icon = L.divIcon({
    className: '', iconSize: [28, 28], iconAnchor: [14, 14],
    html: `<div style="width:28px;height:28px;border-radius:50%;background:#333;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.4);cursor:grab;touch-action:none;display:flex;align-items:center;justify-content:center;">
      <div style="width:8px;height:8px;background:#fff;border-radius:50%"></div>
    </div>`
  })
  useEffect(() => {
    const marker = markerRef.current
    if (!marker) return
    // Ensure dragging is enabled and works on touch
    const m = marker.getLeafletElement ? marker.getLeafletElement() : marker
    if (m?.dragging) m.dragging.enable()
  }, [])
  return (
    <Marker
      ref={markerRef}
      position={position}
      icon={icon}
      draggable={true}
      eventHandlers={{
        drag:    (e) => onMove(index, e.target.getLatLng()),
        dragend: (e) => onMove(index, e.target.getLatLng()),
        click:   (e) => { L.DomEvent.stopPropagation(e) },
        contextmenu: () => onRemove(index),
      }}
    />
  )
}

// PolylineEditor — tap/click the route line to insert a waypoint + renders the line
function PolylineEditor({ waypoints, onInsert }) {
  const positions = waypoints.map(w => [w.lat, w.lon])
  return (<>
    {/* Thick invisible hit-area so tap is easy on mobile */}
    <Polyline
      positions={positions}
      pathOptions={{ color: 'transparent', weight: 20, opacity: 0 }}
      eventHandlers={{
        click: (e) => {
          L.DomEvent.stopPropagation(e)
          let bestSeg = 1, bestDist = Infinity
          for (let i = 0; i < waypoints.length - 1; i++) {
            const d = crossTrackNM(e.latlng.lat, e.latlng.lng, [waypoints[i].lat, waypoints[i].lon], [waypoints[i+1].lat, waypoints[i+1].lon])
            if (d < bestDist) { bestDist = d; bestSeg = i + 1 }
          }
          onInsert(bestSeg, e.latlng.lat, e.latlng.lng)
        }
      }}
    />
    {/* Visible line */}
    <Polyline positions={positions} pathOptions={{ color: '#ffffff', weight: 2.5, opacity: 0.85 }} />
  </>)
}

// Fade-out hint shown once when fullscreen opens
function RouteHint() {
  const [visible, setVisible] = useState(true)
  useEffect(() => { const t = setTimeout(() => setVisible(false), 3500); return () => clearTimeout(t) }, [])
  if (!visible) return null
  return (
    <div style={{
      position: 'absolute', bottom: 280, left: '50%', transform: 'translateX(-50%)',
      zIndex: 10002, pointerEvents: 'none',
      background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(10px)',
      borderRadius: 20, padding: '7px 14px',
      display: 'flex', alignItems: 'center', gap: 8,
      animation: 'fadeOut 0.6s ease 2.9s forwards',
    }}>
      <span style={{ fontSize: 16 }}>✦</span>
      <span style={{ fontSize: 12, color: '#fff', fontWeight: 500 }}>Tap the route line to add a waypoint · drag to move</span>
      <style>{`@keyframes fadeOut { to { opacity: 0 } }`}</style>
    </div>
  )
}

/* ── FAA airport directory (searchable by ICAO, name, city) ─────── */
const FAA_AIRPORTS = [
  // US — Major hubs
  { icao:'KATL', name:'Hartsfield-Jackson Atlanta Intl',  city:'Atlanta, GA' },
  { icao:'KLAX', name:'Los Angeles Intl',                  city:'Los Angeles, CA' },
  { icao:'KORD', name:"O'Hare Intl",                       city:'Chicago, IL' },
  { icao:'KDFW', name:'Dallas/Fort Worth Intl',            city:'Dallas, TX' },
  { icao:'KDEN', name:'Denver Intl',                       city:'Denver, CO' },
  { icao:'KJFK', name:'John F. Kennedy Intl',              city:'New York, NY' },
  { icao:'KSFO', name:'San Francisco Intl',                city:'San Francisco, CA' },
  { icao:'KLAS', name:'Harry Reid Intl',                   city:'Las Vegas, NV' },
  { icao:'KPHX', name:'Phoenix Sky Harbor Intl',           city:'Phoenix, AZ' },
  { icao:'KIAH', name:'George Bush Intercontinental',      city:'Houston, TX' },
  { icao:'KMIA', name:'Miami Intl',                        city:'Miami, FL' },
  { icao:'KSEA', name:'Seattle-Tacoma Intl',               city:'Seattle, WA' },
  { icao:'KBOS', name:'Logan Intl',                        city:'Boston, MA' },
  { icao:'KCLT', name:'Charlotte Douglas Intl',            city:'Charlotte, NC' },
  { icao:'KEWR', name:'Newark Liberty Intl',               city:'Newark, NJ' },
  { icao:'KSAN', name:'San Diego Intl',                    city:'San Diego, CA' },
  { icao:'KMSP', name:'Minneapolis-Saint Paul Intl',       city:'Minneapolis, MN' },
  { icao:'KDTW', name:'Detroit Metropolitan Wayne Co',     city:'Detroit, MI' },
  { icao:'KPHL', name:'Philadelphia Intl',                 city:'Philadelphia, PA' },
  { icao:'KLGA', name:'LaGuardia',                         city:'New York, NY' },
  { icao:'KBWI', name:'Baltimore/Washington Intl',         city:'Baltimore, MD' },
  { icao:'KSLC', name:'Salt Lake City Intl',               city:'Salt Lake City, UT' },
  { icao:'KIAD', name:'Washington Dulles Intl',            city:'Washington, DC' },
  { icao:'KDCA', name:'Ronald Reagan Washington Natl',     city:'Washington, DC' },
  { icao:'KMCO', name:'Orlando Intl',                      city:'Orlando, FL' },
  { icao:'KMDW', name:'Chicago Midway Intl',               city:'Chicago, IL' },
  { icao:'KHOU', name:'William P. Hobby',                  city:'Houston, TX' },
  { icao:'KAUS', name:'Austin-Bergstrom Intl',             city:'Austin, TX' },
  { icao:'KPDX', name:'Portland Intl',                     city:'Portland, OR' },
  { icao:'KFLL', name:'Fort Lauderdale-Hollywood Intl',   city:'Fort Lauderdale, FL' },
  { icao:'KRDU', name:'Raleigh-Durham Intl',               city:'Raleigh, NC' },
  { icao:'KSTL', name:'St. Louis Lambert Intl',            city:'St. Louis, MO' },
  { icao:'KPIT', name:'Pittsburgh Intl',                   city:'Pittsburgh, PA' },
  { icao:'KCVG', name:'Cincinnati/Northern Kentucky Intl', city:'Cincinnati, OH' },
  { icao:'KCLE', name:'Cleveland Hopkins Intl',            city:'Cleveland, OH' },
  { icao:'KMEM', name:'Memphis Intl',                      city:'Memphis, TN' },
  { icao:'KBNA', name:'Nashville Intl',                    city:'Nashville, TN' },
  { icao:'KSAT', name:'San Antonio Intl',                  city:'San Antonio, TX' },
  { icao:'KTPA', name:'Tampa Intl',                        city:'Tampa, FL' },
  { icao:'KMSY', name:'Louis Armstrong New Orleans Intl',  city:'New Orleans, LA' },
  { icao:'KPBI', name:'Palm Beach Intl',                   city:'West Palm Beach, FL' },
  { icao:'KRSW', name:'Southwest Florida Intl',            city:'Fort Myers, FL' },
  { icao:'KJAX', name:'Jacksonville Intl',                 city:'Jacksonville, FL' },
  { icao:'KBUF', name:'Buffalo Niagara Intl',              city:'Buffalo, NY' },
  { icao:'KOKE', name:'Oke City Will Rogers World',        city:'Oklahoma City, OK' },
  { icao:'KTUL', name:'Tulsa Intl',                        city:'Tulsa, OK' },
  { icao:'KABQ', name:'Albuquerque Intl Sunport',          city:'Albuquerque, NM' },
  { icao:'KTUS', name:'Tucson Intl',                       city:'Tucson, AZ' },
  { icao:'KBHM', name:'Birmingham-Shuttlesworth Intl',    city:'Birmingham, AL' },
  { icao:'KMKE', name:'Milwaukee Mitchell Intl',           city:'Milwaukee, WI' },
  { icao:'KIND', name:'Indianapolis Intl',                 city:'Indianapolis, IN' },
  { icao:'KCMH', name:'John Glenn Columbus Intl',          city:'Columbus, OH' },
  { icao:'KDSM', name:'Des Moines Intl',                   city:'Des Moines, IA' },
  { icao:'KCHS', name:'Charleston Intl',                   city:'Charleston, SC' },
  { icao:'KSAV', name:'Savannah/Hilton Head Intl',         city:'Savannah, GA' },
  { icao:'KTYS', name:'McGhee Tyson',                      city:'Knoxville, TN' },
  { icao:'KGRR', name:'Gerald R. Ford Intl',               city:'Grand Rapids, MI' },
  { icao:'KRIC', name:'Richmond Intl',                     city:'Richmond, VA' },
  { icao:'KSDF', name:'Louisville Intl - Standiford Field',city:'Louisville, KY' },
  { icao:'KELP', name:'El Paso Intl',                      city:'El Paso, TX' },
  { icao:'KOAK', name:'Oakland Intl',                      city:'Oakland, CA' },
  { icao:'KSJC', name:'Norman Y. Mineta San Jose Intl',   city:'San Jose, CA' },
  { icao:'KSMF', name:'Sacramento Intl',                   city:'Sacramento, CA' },
  { icao:'KSNA', name:'John Wayne - Orange County',        city:'Santa Ana, CA' },
  { icao:'KBUR', name:'Hollywood Burbank',                 city:'Burbank, CA' },
  { icao:'KONT', name:'Ontario Intl',                      city:'Ontario, CA' },
  { icao:'KRNO', name:'Reno-Tahoe Intl',                   city:'Reno, NV' },
  { icao:'KANC', name:'Ted Stevens Anchorage Intl',        city:'Anchorage, AK' },
  { icao:'PHNL', name:'Daniel K. Inouye Intl',             city:'Honolulu, HI' },
  // Canada
  { icao:'CYYZ', name:'Toronto Pearson Intl',              city:'Toronto, ON' },
  { icao:'CYVR', name:'Vancouver Intl',                    city:'Vancouver, BC' },
  { icao:'CYUL', name:'Montréal-Trudeau Intl',             city:'Montréal, QC' },
  { icao:'CYYC', name:'Calgary Intl',                      city:'Calgary, AB' },
  { icao:'CYEG', name:'Edmonton Intl',                     city:'Edmonton, AB' },
  { icao:'CYWG', name:'Winnipeg James Armstrong Richardson Intl', city:'Winnipeg, MB' },
  // Central America / Caribbean
  { icao:'MSLP', name:'El Salvador Intl',                  city:'San Salvador, SV' },
  { icao:'MSSS', name:'Ilopango Intl',                     city:'San Salvador, SV' },
  { icao:'MMMX', name:'Benito Juárez Intl',                city:'Mexico City, MX' },
  { icao:'MMUN', name:'Cancún Intl',                       city:'Cancún, MX' },
  { icao:'MMGL', name:'Don Miguel Hidalgo y Costilla Intl',city:'Guadalajara, MX' },
  { icao:'MMTJ', name:'Tijuana Intl — Gen Abelardo L Rodriguez', city:'Tijuana, MX' },
  { icao:'MGGT', name:'La Aurora Intl',                    city:'Guatemala City, GT' },
  { icao:'MHTG', name:'Toncontín Intl',                    city:'Tegucigalpa, HN' },
  { icao:'MNMG', name:'Augusto C. Sandino Intl',           city:'Managua, NI' },
  { icao:'MROC', name:'Juan Santamaría Intl',              city:'San José, CR' },
  { icao:'MPTO', name:'Tocumen Intl',                      city:'Panama City, PA' },
  { icao:'MBPV', name:'Providenciales Intl',               city:'Providenciales, TC' },
  { icao:'MKJP', name:'Norman Manley Intl',                city:'Kingston, JM' },
  { icao:'TNCM', name:'Princess Juliana Intl',             city:'Sint Maarten' },
  { icao:'MDSD', name:'Las Américas Intl',                 city:'Santo Domingo, DO' },
  { icao:'TJSJ', name:'Luis Muñoz Marín Intl',             city:'San Juan, PR' },
  { icao:'MUBА', name:'José Martí Intl',                   city:'Havana, CU' },
]

/* ── Airport lookup — AWC + SkyVector scraper ────────────────── */
const AWC     = 'https://aviationweather.gov/api/data'
// Ordered by reliability for FAA/government endpoints
const PROXIES = [
  { url: 'https://corsproxy.io/?url=',         wrap: false },
  { url: 'https://api.allorigins.win/get?url=', wrap: true  },  // returns { contents: '...' }
  { url: 'https://api.allorigins.win/raw?url=', wrap: false },
]

async function proxyFetch(url, timeout = 8000) {
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

async function proxyText(url) {
  return proxyFetch(url, 5000)
}

async function proxyJSON(url) {
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

async function fetchAWC(id) {
  // Try FAA airport endpoint first, fall back to METAR station (covers international)
  try {
    const data = await proxyJSON(`${AWC}/airport?ids=${id}&format=json`)
    if (Array.isArray(data) && data.length) return data[0]
  } catch { /* ignore */ }
  try {
    const metar = await proxyJSON(`${AWC}/metar?ids=${id}&format=json&hours=3`)
    if (Array.isArray(metar) && metar.length) {
      const m = metar[0]
      return { icaoId: m.icaoId || id, faaId: m.stationId || id, name: m.site, lat: m.lat, lon: m.lon, elev: m.elev, state: m.state, country: m.country, tower: null, rwyNum: null }
    }
  } catch { /* ignore */ }
  return null
}

async function lookupAirport(icao) {
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

/* ── Checklist data ──────────────────────────────────────────── */
const CHECKLISTS = [
  {
    id: 'flight-plan',
    title: 'Flight Plan',
    tag: 'FLIGHT PLANNING',
    color: 'var(--text-secondary)',
    sections: [
      {
        title: 'EN ROUTE',
        num: 1,
        items: [
          { id: 'route', label: 'Route and Altitude', sub: 'Charts · Airspace · TFR · Overflight', expand: 'altitude', items: [
            { id: 'route-a', label: 'Charts', sub: 'Sectional · TAC · Chart Supplement', expand: 'charts' },
          ]},
          { id: 'wx', label: 'Weather', sub: 'PROG · METAR · TAF · AIRMET · SIGMET · Winds', expand: 'metar' },
          { id: 'alternates', label: 'Alternate(s)', sub: 'Distance · Weather · Fuel · IFR 1-2-3', expand: 'alternates' },
        ],
      },
      {
        title: 'PERFORMANCE',
        num: 2,
        items: [
          { id: 'wb',         label: 'Weight & Balance', sub: 'CG envelope · Longitudinal & lateral', expand: 'wb' },
          { id: 'perf-da',    label: 'Density Altitude', sub: 'Pressure Alt · ISA Deviation · Performance Impact', expand: 'densityalt' },
          { id: 'perf-dist',  label: 'Takeoff / Landing / Accelerate-Stop Distances', sub: 'POH · Wind · Surface · Slope corrections', expand: 'perfdist' },
          { id: 'perf-cruise',label: 'Cruise Speed / Time / Fuel Required / Endurance', sub: 'GS · Winds Aloft · Fuel State · Go/No-Go', expand: 'cruise' },
        ],
      },
      {
        title: 'AIRPORT',
        num: 3,
        items: [
          { id: 'apt', label: 'Destination Airport', sub: 'Diagram · Charts · Services · NOTAM · FBO', expand: 'airport' },
        ],
      },
      {
        title: 'AIRCRAFT',
        num: 4,
        items: [
          { id: 'aircraft', label: 'Aircraft', sub: 'CARROW · Airworthiness · Fuel · Equipment', expand: 'aircraft' },
        ],
      },
      {
        title: 'PILOT',
        num: 5,
        items: [
          { id: 'pilot-imsafe',    label: 'IM SAFE',      sub: 'Illness · Medication · Stress · Alcohol · Fatigue · Eating', expand: 'imsafe' },
          { id: 'pilot-imcurrent', label: 'IM CURRENT',   sub: 'Flight review · Passenger currency · IFR currency',          expand: 'imcurrent' },
          { id: 'pilot-imvalid',   label: 'IM VALID',     sub: 'Medical certificate validity',                               expand: 'imvalid' },
          { id: 'pilot-airworthy', label: 'IM AIRWORTHY', sub: 'Annual · Transponder · Pitot-static',                        expand: 'imairworthy' },
          { id: 'pilot-fp',        label: 'Flight Plan Filed' },
        ],
      },
    ],
  },
]

/* ── Flatten all item ids in a checklist ─────────────────────── */
function flattenIds(items) {
  const ids = []
  for (const item of items) {
    ids.push(item.id)
    if (item.items) ids.push(...flattenIds(item.items))
  }
  return ids
}

function allIds(checklist) {
  return checklist.sections.flatMap(s => flattenIds(s.items))
}

/* ── IM SAFE / CURRENT / VALID / AIRWORTHY checklist cards ──── */
const IMSAFE_ITEMS = [
  { key: 'illness',    letter: 'I', label: 'Illness',    detail: 'No symptoms affecting performance' },
  { key: 'medication', letter: 'M', label: 'Medication', detail: 'None affecting performance or judgment' },
  { key: 'stress',     letter: 'S', label: 'Stress',     detail: 'Psychological pressure manageable' },
  { key: 'alcohol',    letter: 'A', label: 'Alcohol',    detail: '8 hrs bottle-to-throttle · BAC < 0.04%' },
  { key: 'fatigue',    letter: 'F', label: 'Fatigue',    detail: 'Rested and alert' },
  { key: 'eating',     letter: 'E', label: 'Eating',     detail: 'Adequately nourished and hydrated' },
]

function imStatusColor(status) {
  if (status === 'valid')     return 'var(--ok)'
  if (status === 'expiring')  return '#f59e0b'
  if (status === 'expired')   return 'var(--danger)'
  return 'var(--text-tertiary)'
}

function imStatusLabel(status) {
  if (status === 'valid')      return 'Current'
  if (status === 'expiring')   return 'Expiring'
  if (status === 'expired')    return 'Expired'
  if (status === 'incomplete') return 'Incomplete'
  return 'Not set'
}

function IMStatusRow({ label, detail, status, extra }) {
  const color = imStatusColor(status)
  return (
    <div style={{ padding: '9px 16px', borderBottom: '0.5px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{label}</div>
        {detail && <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>{detail}</div>}
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color }}>{imStatusLabel(status)}</div>
        {extra && <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 1 }}>{extra}</div>}
      </div>
    </div>
  )
}

function IMChecklistItem({ item, isChecked, onToggle, statusKey }) {
  const [open, setOpen]       = useState(false)
  const [currData, setCurrData] = useState(null)

  useEffect(() => {
    get('currency', 'profile').then(d => setCurrData(d ?? {}))
  }, [open])

  const cs = currData ? getCurrencyStatus(currData) : null
  const overallStatus = cs?.[statusKey]?.status ?? 'incomplete'
  const okColor = imStatusColor(overallStatus)

  // ── card content per statusKey ────────────────────────────────
  function renderContent() {
    if (!currData || !cs) {
      return <div style={{ padding: '16px', fontSize: 13, color: 'var(--text-tertiary)', textAlign: 'center' }}>Loading...</div>
    }

    if (statusKey === 'safe') {
      return IMSAFE_ITEMS.map(it => {
        const checked = currData.safe?.[it.key] === true
        return (
          <IMStatusRow
            key={it.key}
            label={`${it.letter} — ${it.label}`}
            detail={it.detail}
            status={checked ? 'valid' : 'incomplete'}
          />
        )
      })
    }

    if (statusKey === 'current') {
      const c = currData.current ?? {}
      const frExp  = c.flightReviewDate  ? calendarMonthExpiry(c.flightReviewDate, 24)  : null
      const dayExp = c.dayLandingsDate   ? daysCurrencyExpiry(c.dayLandingsDate, 90)    : null
      const nigExp = c.nightLandingsDate ? daysCurrencyExpiry(c.nightLandingsDate, 90)  : null
      const ifrExp = c.ifrDate           ? calendarMonthExpiry(c.ifrDate, 6)            : null
      const fr  = frExp  ? statusFromExpiry(frExp,  30) : { status: 'incomplete' }
      const day = dayExp ? statusFromExpiry(dayExp, 30) : { status: 'incomplete' }
      const nig = nigExp ? statusFromExpiry(nigExp, 30) : { status: 'incomplete' }
      const ifr = ifrExp ? statusFromExpiry(ifrExp, 30) : { status: 'incomplete' }
      return (<>
        <IMStatusRow label="Flight Review" detail="FAR 61.56 · 24 calendar months" status={fr.status}
          extra={frExp ? `Exp ${fmtDate(frExp)} · ${fmtDaysLeft(fr.daysLeft)}` : null} />
        <IMStatusRow label="Day Passenger Currency" detail="FAR 61.57(a) · 90 days" status={day.status}
          extra={dayExp ? `Exp ${fmtDate(dayExp)} · ${fmtDaysLeft(day.daysLeft)}` : null} />
        <IMStatusRow label="Night Passenger Currency" detail="FAR 61.57(b) · 90 days" status={nig.status}
          extra={nigExp ? `Exp ${fmtDate(nigExp)} · ${fmtDaysLeft(nig.daysLeft)}` : null} />
        <IMStatusRow label="IFR Currency" detail="FAR 61.57(c) · 6 months" status={ifr.status}
          extra={ifrExp ? `Exp ${fmtDate(ifrExp)} · ${fmtDaysLeft(ifr.daysLeft)}` : null} />
      </>)
    }

    if (statusKey === 'valid') {
      const m = currData.medical ?? {}
      if (!m.examDate || !m.dob || !m.medClass) {
        return <div style={{ padding: '16px', fontSize: 13, color: 'var(--text-tertiary)', textAlign: 'center' }}>Set up medical info in the Currency section.</div>
      }
      const examLabel = `FAR 61.23(d) · Exam ${fmtDate(new Date(m.examDate))}`
      return cs.valid.tiers.map(t => (
        <IMStatusRow
          key={t.tier}
          label={t.label}
          detail={examLabel}
          status={t.status}
          extra={t.expiresOn ? `Exp ${fmtDate(t.expiresOn)} · ${fmtDaysLeft(t.daysLeft)}` : null}
        />
      ))
    }

    if (statusKey === 'airworthy') {
      const a = currData.airworthy ?? {}
      const annExp = a.annualDate      ? calendarMonthExpiry(a.annualDate, 12)      : null
      const trExp  = a.transponderDate ? calendarMonthExpiry(a.transponderDate, 24) : null
      const ptExp  = a.pitotDate       ? calendarMonthExpiry(a.pitotDate, 24)       : null
      const ann = annExp ? statusFromExpiry(annExp, 30) : { status: 'incomplete' }
      const tr  = trExp  ? statusFromExpiry(trExp,  30) : { status: 'incomplete' }
      const pt  = ptExp  ? statusFromExpiry(ptExp,  30) : { status: 'incomplete' }
      return (<>
        <IMStatusRow label="Annual Inspection" detail="FAR 91.409 · 12 calendar months" status={ann.status}
          extra={annExp ? `Exp ${fmtDate(annExp)} · ${fmtDaysLeft(ann.daysLeft)}` : null} />
        <IMStatusRow label="Transponder" detail="FAR 91.413 · 24 calendar months" status={tr.status}
          extra={trExp ? `Exp ${fmtDate(trExp)} · ${fmtDaysLeft(tr.daysLeft)}` : null} />
        <IMStatusRow label="Pitot-Static" detail="FAR 91.411 · 24 calendar months" status={pt.status}
          extra={ptExp ? `Exp ${fmtDate(ptExp)} · ${fmtDaysLeft(pt.daysLeft)}` : null} />
      </>)
    }
    return null
  }

  return (
    <div style={{ marginBottom: 8 }}>
      {/* Card header */}
      <div style={{
        background: 'var(--bg-card)',
        border: '0.5px solid var(--border)',
        borderRadius: open ? '14px 14px 0 0' : 14,
        overflow: 'hidden',
        boxShadow: 'var(--shadow-sm)',
      }}>
        <button
          onClick={() => setOpen(o => !o)}
          style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: '13px 14px', textAlign: 'left' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{
                fontSize: 15, fontWeight: 600, letterSpacing: '-0.2px',
                color: isChecked ? 'var(--text-tertiary)' : 'var(--text)',
                textDecoration: isChecked ? 'line-through' : 'none',
              }}>{item.label}</div>
              {item.sub && !isChecked && <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 3 }}>{item.sub}</div>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
              {/* Live status dot from currency data */}
              <div style={{
                width: 7, height: 7, borderRadius: '50%',
                background: currData ? okColor : 'transparent',
                border: `1.5px solid ${currData ? okColor : 'var(--border-strong)'}`,
                flexShrink: 0,
              }} />
              {/* Checkmark toggle */}
              <div
                onClick={e => { e.stopPropagation(); onToggle(item.id) }}
                style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: isChecked ? 'var(--text)' : 'transparent',
                  border: `1.5px solid ${isChecked ? 'var(--text)' : 'var(--border-strong)'}`,
                  transition: 'all 0.2s', cursor: 'pointer', flexShrink: 0,
                }}
              />
              <div style={{ color: 'var(--text-tertiary)', transition: 'transform 0.2s', transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}>
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none">
                  <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
            </div>
          </div>
        </button>
      </div>

      {/* Expanded body */}
      {open && (
        <div style={{
          background: 'var(--bg-card)', border: '0.5px solid var(--border)',
          borderTop: 'none', borderRadius: '0 0 14px 14px', overflow: 'hidden',
        }}>
          {renderContent()}
          {/* Status banner */}
          <div style={{
            margin: 12, padding: '10px 14px', borderRadius: 10,
            background: 'var(--bg-card-2)', border: '0.5px solid var(--border)',
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, color: okColor }}>
              {overallStatus === 'valid'
                ? <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                : <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
              }
            </svg>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>
              {overallStatus === 'valid'    ? `${item.label} confirmed` :
               overallStatus === 'expiring' ? `${item.label} — expiring soon` :
               overallStatus === 'expired'  ? `${item.label} — action required` :
               `${item.label} — data incomplete`}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Shared expandable card wrapper ─────────────────────────── */
function ExpandableCard({ item, isChecked, onToggle, open, setOpen, children }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{
        background: 'var(--bg-card)',
        border: '0.5px solid var(--border)',
        borderRadius: open ? '14px 14px 0 0' : 14,
        boxShadow: 'var(--shadow-sm)',
        overflow: 'hidden',
      }}>
        {/* Tappable header */}
        <button
          onClick={() => setOpen(o => !o)}
          style={{
            width: '100%', background: 'none', border: 'none',
            cursor: 'pointer', padding: '13px 14px', textAlign: 'left',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{
              fontSize: 15, fontWeight: 600, letterSpacing: '-0.2px',
              color: isChecked ? 'var(--text-tertiary)' : 'var(--text)',
              textDecoration: isChecked ? 'line-through' : 'none',
            }}>{item.label}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
              <div
                onClick={e => { e.stopPropagation(); onToggle(item.id) }}
                style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: isChecked ? 'var(--text)' : 'transparent',
                  border: `1.5px solid ${isChecked ? 'var(--text)' : 'var(--border-strong)'}`,
                  transition: 'all 0.2s', cursor: 'pointer', flexShrink: 0,
                }}
              />
              <div style={{
                color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center',
                transition: 'transform 0.2s',
                transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
              }}>
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none">
                  <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
            </div>
          </div>
        </button>
      </div>

      {/* Expanded content — connects flush to the card header */}
      {open && (
        <div style={{
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
          borderTop: 'none',
          borderRadius: '0 0 14px 14px',
          overflow: 'hidden',
        }}>
          {children}
        </div>
      )}
    </div>
  )
}

/* ── Sub label (plain text) ──────────────────────────────────── */
function SubPills({ sub, isChecked }) {
  if (!sub || isChecked) return null
  return (
    <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 3 }}>
      {sub}
    </div>
  )
}

/* ── Root component ──────────────────────────────────────────── */
export default function Checklists() {
  return <ChecklistDetail checklist={CHECKLISTS[0]} />
}


/* ── Checklist detail — MTA Metro layout ────────────────────── */
function ChecklistDetail({ checklist, onBack }) {
  const [checked, setChecked]         = useState(new Set())
  const [customItems, setCustomItems] = useState({ PILOT: [] })
  const [addingTo, setAddingTo]       = useState(null)
  const [draftLabel, setDraftLabel]   = useState('')
  const trackRef = useRef(null)
  const circleRefs = useRef([])

  const customTotal = Object.values(customItems).reduce((sum, arr) => sum + arr.length, 0)
  const total = allIds(checklist).length + customTotal

  useEffect(() => {
    get('checklists', checklist.id).then(saved => {
      if (saved?.checked) setChecked(new Set(saved.checked))
      if (saved?.custom)  setCustomItems(saved.custom)
    })
  }, [checklist.id])

  function save(nextChecked, nextCustom) {
    put('checklists', { id: checklist.id, checked: [...nextChecked], custom: nextCustom })
  }

  function toggle(id) {
    setChecked(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      save(next, customItems)
      return next
    })
  }

  function reset() {
    setChecked(new Set())
    save(new Set(), customItems)   // custom items persist across resets — they're a template
  }

  function addCustomItem(sectionTitle) {
    const label = draftLabel.trim()
    if (!label) return
    const item = { id: `custom-${Date.now()}`, label }
    const next = { ...customItems, [sectionTitle]: [...(customItems[sectionTitle] ?? []), item] }
    setCustomItems(next)
    save(checked, next)
    setDraftLabel('')
    setAddingTo(null)
  }

  function deleteCustomItem(sectionTitle, itemId) {
    const next = { ...customItems, [sectionTitle]: customItems[sectionTitle].filter(i => i.id !== itemId) }
    const nextChecked = new Set(checked)
    nextChecked.delete(itemId)
    setCustomItems(next)
    setChecked(nextChecked)
    save(nextChecked, next)
  }

  const done     = checked.size
  const pct      = total > 0 ? done / total : 0
  const complete = done === total

  function isSectionDone(section) {
    const builtIn = flattenIds(section.items).every(id => checked.has(id))
    const custom  = (customItems[section.title] ?? []).every(i => checked.has(i.id))
    return builtIn && custom
  }

  // Active section = first incomplete
  const activeSectionIdx = checklist.sections.findIndex(s => !isSectionDone(s))

  // Compute fill height by measuring actual DOM positions of each station circle.
  // Uses getBoundingClientRect so it's correct regardless of scroll, nesting, or card expansion.
  const [trainRatio, setTrainRatio] = useState(0)

  const recalcTrain = useCallback(() => {
    const track = trackRef.current
    if (!track) return
    const sections = checklist.sections
    const n = sections.length
    const circles = circleRefs.current.slice(0, n)
    if (circles.some(r => !r)) return

    // Get center-Y of each station circle relative to the track container top
    const trackTop = track.getBoundingClientRect().top
    const centerYs = circles.map(el => {
      const r = el.getBoundingClientRect()
      return r.top + r.height / 2 - trackTop
    })
    const trackH = track.getBoundingClientRect().height
    if (!trackH) return

    // The visual line spans from center of circle[0] to center of circle[n-1]
    const lineStart = centerYs[0]
    const lineEnd   = centerYs[n - 1]
    const lineH     = lineEnd - lineStart
    if (lineH <= 0) return

    // Find last fully-done section
    let lastDone = -1
    for (let i = 0; i < n; i++) {
      if (isSectionDone(sections[i])) lastDone = i
      else break
    }

    let targetY  // absolute target center-Y within track
    if (lastDone < 0) {
      // Nothing done: interpolate from circle[0] toward circle[1] by section-0 progress
      const items = flattenIds(sections[0].items)
      const frac  = items.length > 0 ? items.filter(id => checked.has(id)).length / items.length : 0
      const endY  = n > 1 ? centerYs[1] : lineEnd
      targetY = centerYs[0] + (endY - centerYs[0]) * frac
    } else if (lastDone === n - 1) {
      targetY = lineEnd
    } else {
      // Reached circle[lastDone+1]; advance into next segment by that section's progress
      const nextSec   = sections[lastDone + 1]
      const nextItems = flattenIds(nextSec.items)
      const nextFrac  = nextItems.length > 0 ? nextItems.filter(id => checked.has(id)).length / nextItems.length : 0
      const fromY = centerYs[lastDone + 1]
      const toY   = lastDone + 2 < n ? centerYs[lastDone + 2] : lineEnd
      targetY = fromY + (toY - fromY) * nextFrac
    }

    // Convert targetY to a ratio of the full track container height
    setTrainRatio(Math.min(Math.max(targetY / trackH, 0), 1))
  }, [checked, checklist])

  useEffect(() => {
    // Small rAF delay so DOM has painted after state change
    const id = requestAnimationFrame(recalcTrain)
    return () => cancelAnimationFrame(id)
  }, [recalcTrain])

  return (
    <div style={{ paddingBottom: 64 }}>
      {/* Header */}
      <div style={{ padding: '20px 16px 0', display: 'flex', alignItems: 'center', gap: 12 }}>
        <BackButton onBack={onBack} />
        <h2 style={{ flex: 1, fontSize: 22, fontWeight: 700, letterSpacing: '-0.4px', color: 'var(--text)' }}>
          {checklist.title}
        </h2>
        <button onClick={reset} style={{
          fontSize: 13, color: 'var(--text-tertiary)',
          background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0', flexShrink: 0,
        }}>Reset</button>
      </div>

      {/* Progress strip */}
      <div style={{ padding: '10px 16px 0' }}>
        <div style={{ height: 2, borderRadius: 1, background: 'var(--border)', overflow: 'hidden' }}>
          <div style={{
            height: '100%', borderRadius: 1, background: 'var(--text)',
            width: `${pct * 100}%`, transition: 'width 0.4s ease',
          }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5 }}>
          <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
            {complete ? 'All complete' : `${done} of ${total}`}
          </span>
          <span style={{ fontSize: 11, color: complete ? 'var(--ok)' : 'var(--text-tertiary)' }}>
            {Math.round(pct * 100)}%
          </span>
        </div>
      </div>

      {/* MTA Metro timeline */}
      <div ref={trackRef} style={{ padding: '24px 16px 0 16px', position: 'relative' }}>

        {/* Track — spans center of first circle to center of last (top:15 = 24px padding + 15 = circle center) */}
        <div style={{
          position: 'absolute', left: 30, top: 0, bottom: 0,
          width: 2, background: 'var(--border)', borderRadius: 1,
          marginLeft: -1,
        }} />

        {/* Fill — height driven by measured circle positions */}
        <div style={{
          position: 'absolute', left: 30, top: 0,
          width: 2, marginLeft: -1,
          height: `${trainRatio * 100}%`,
          background: 'var(--text)', borderRadius: 1,
          transition: 'height 0.55s cubic-bezier(0.4,0,0.2,1)',
        }} />

        {/* Sections */}
        {checklist.sections.map((section, si) => {
          const secDone  = isSectionDone(section)
          const isActive = si === activeSectionIdx
          const isLast   = si === checklist.sections.length - 1

          return (
            <div key={section.num} style={{ marginBottom: isLast ? 0 : 4 }}>
              {/* Station row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 4 }}>
                {/* MTA-style station circle — ref'd for fill measurement */}
                <div ref={el => circleRefs.current[si] = el} style={{
                  width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
                  background: secDone ? 'var(--text)' : 'var(--bg-card)',
                  border: `2px solid ${secDone ? 'var(--text)' : isActive ? 'var(--text)' : 'var(--border)'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12, fontWeight: 800,
                  color: secDone ? 'var(--bg-card)' : isActive ? 'var(--text)' : 'var(--text-tertiary)',
                  position: 'relative', zIndex: 3,
                  transition: 'all 0.4s cubic-bezier(0.4,0,0.2,1)',
                }}>{section.num}</div>

                {/* Section title */}
                <div style={{ flex: 1 }}>
                  <span style={{
                    fontSize: isActive && !secDone ? 13 : 11,
                    fontWeight: secDone || isActive ? 700 : 500,
                    letterSpacing: '0.5px',
                    textTransform: 'uppercase',
                    color: secDone ? 'var(--text)' : isActive ? 'var(--text)' : 'var(--text-tertiary)',
                    transition: 'all 0.35s',
                  }}>{section.title}</span>
                </div>

                {/* Done check */}
                {secDone && (
                  <svg width={13} height={13} viewBox="0 0 24 24" fill="none" style={{ color: 'var(--text)', flexShrink: 0 }}>
                    <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </div>

              {/* Items — indented past the station circle */}
              <div style={{ paddingLeft: 44, paddingBottom: isLast ? 0 : 20 }}>
                <MetroItems items={section.items} checked={checked} onToggle={toggle} depth={0} />

                {/* Custom items — PILOT section only */}
                {section.title === 'PILOT' && (
                  <>
                    {(customItems.PILOT ?? []).map(ci => (
                      <div key={ci.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0', minHeight: 36 }}>
                        <button
                          onClick={() => toggle(ci.id)}
                          style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0 }}
                        >
                          <div style={{
                            width: 7, height: 7, marginTop: 1, borderRadius: '50%', flexShrink: 0,
                            background: checked.has(ci.id) ? 'var(--text)' : 'transparent',
                            border: `1.5px solid ${checked.has(ci.id) ? 'var(--text)' : 'var(--border-strong)'}`,
                            transition: 'all 0.2s',
                          }} />
                          <span style={{
                            fontSize: 14, fontWeight: 500, lineHeight: 1.35,
                            color: checked.has(ci.id) ? 'var(--text-tertiary)' : 'var(--text)',
                            textDecoration: checked.has(ci.id) ? 'line-through' : 'none',
                            transition: 'color 0.2s',
                          }}>{ci.label}</span>
                        </button>
                        <button
                          onClick={() => deleteCustomItem('PILOT', ci.id)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', padding: '2px 4px', flexShrink: 0, display: 'flex', alignItems: 'center' }}
                        >
                          <svg width={11} height={11} viewBox="0 0 24 24" fill="none">
                            <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </button>
                      </div>
                    ))}

                    {addingTo === 'PILOT' ? (
                      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                        <input
                          autoFocus
                          value={draftLabel}
                          onChange={e => setDraftLabel(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter')  addCustomItem('PILOT')
                            if (e.key === 'Escape') { setAddingTo(null); setDraftLabel('') }
                          }}
                          placeholder="Step description"
                          maxLength={80}
                          style={{
                            flex: 1, padding: '7px 10px', borderRadius: 8,
                            border: '1px solid var(--border-strong)',
                            background: 'var(--bg-card-2)', color: 'var(--text)',
                            fontSize: 13, outline: 'none',
                          }}
                        />
                        <button
                          onClick={() => addCustomItem('PILOT')}
                          style={{ padding: '7px 12px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: 'var(--accent-fg)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}
                        >Add</button>
                        <button
                          onClick={() => { setAddingTo(null); setDraftLabel('') }}
                          style={{ padding: '7px 8px', borderRadius: 8, border: 'none', background: 'var(--bg-card-2)', color: 'var(--text-secondary)', fontSize: 13, cursor: 'pointer' }}
                        >Cancel</button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setAddingTo('PILOT')}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, background: 'none', border: 'none', cursor: 'pointer', padding: '3px 0', color: 'var(--text-tertiary)' }}
                      >
                        <svg width={12} height={12} viewBox="0 0 24 24" fill="none">
                          <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                        <span style={{ fontSize: 12, fontWeight: 500 }}>Add step</span>
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* ── Complete button ── */}
      <CompleteButton
        pct={pct}
        complete={complete}
        checklist={checklist}
        onComplete={reset}
      />
    </div>
  )
}

function CompleteButton({ pct, complete, checklist, onComplete }) {
  const [saving, setSaving] = useState(false)
  const [saved,  setSaved]  = useState(false)

  const handleComplete = async () => {
    if (!complete || saving || saved) return
    setSaving(true)

    try {
      // Pull everything the pilot filled in
      const [route, cruise, preset] = await Promise.all([
        get('settings', 'route'),
        get('settings', 'cruise'),
        get('settings', 'aircraft_preset'),
      ])

      const dep  = route?.dep  || ''
      const dest = route?.dest || ''
      const distNm      = route?.dist ?? null
      const cruiseAlt   = cruise?.cruiseAlt ?? route?.cruiseAlt ?? null
      const flightRules = cruise?.flightRules || 'VFR'
      const tas         = parseFloat(cruise?.tas)   || null
      const burnRate    = parseFloat(cruise?.burnRate) || null
      const fuelOnBoard = parseFloat(cruise?.fuelOnBoard) || null
      const aircraft    = preset?.label || ''

      // Flight time from cruise calculation
      let flightTimeH = null
      if (distNm && tas) flightTimeH = distNm / tas

      // Fuel required
      let fuelRequired = null
      if (flightTimeH && burnRate) fuelRequired = parseFloat((flightTimeH * burnRate).toFixed(1))

      const record = {
        id:           Date.now(),
        savedAt:      new Date().toISOString(),
        checklistId:  checklist.id,
        dep,
        dest,
        distNm,
        cruiseAlt,
        flightRules,
        tas,
        burnRate,
        fuelOnBoard,
        fuelRequired,
        flightTimeH:  flightTimeH ? parseFloat(flightTimeH.toFixed(2)) : null,
        aircraft,
      }

      await put('flights', record)
    } catch (e) {
      // Save failed silently — don't block the pilot
    }

    setSaved(true)
    setSaving(false)

    // Brief moment to show the checkmark, then reset the checklist
    setTimeout(() => {
      onComplete()
      setSaved(false)
    }, 1200)
  }

  return (
    <div style={{ padding: '24px 16px 36px' }}>
      {/* Button shell — always present, bar fills inside it */}
      <button
        onClick={handleComplete}
        disabled={!complete || saving || saved}
        style={{
          position: 'relative',
          width: '100%',
          height: 52,
          borderRadius: 14,
          border: 'none',
          cursor: complete ? 'pointer' : 'default',
          overflow: 'hidden',
          background: complete ? 'var(--text)' : 'var(--bg-card-2)',
          transition: 'background 0.4s ease',
          outline: 'none',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        {/* Progress fill — grows left to right while not complete */}
        {!complete && (
          <div style={{
            position: 'absolute', inset: 0,
            width: `${pct * 100}%`,
            background: 'var(--border)',
            transition: 'width 0.4s ease',
            borderRadius: 14,
          }} />
        )}

        {/* Label */}
        <span style={{
          position: 'relative', zIndex: 1,
          fontSize: 15, fontWeight: 700, letterSpacing: '-0.2px',
          color: complete ? 'var(--bg)' : 'var(--text-tertiary)',
          transition: 'color 0.4s ease',
        }}>
          {saved
            ? 'Saved to Flights'
            : saving
            ? 'Saving...'
            : complete
            ? 'Complete Flight Plan'
            : 'Complete Flight Plan'}
        </span>
      </button>
    </div>
  )
}

/* ── Alternate(s) item ───────────────────────────────────────── */
// IFR 1-2-3 rule: alternate required if, from 1 hr before to 1 hr after ETA,
// ceiling < 2000 ft OR vis < 3 SM at destination.
// VFR best practice: always identify at least one alternate.

// Parse DMS string "28-25-45.8000N" → decimal degrees
function parseDMSAlt(dms) {
  if (!dms) return null
  const m = dms.match(/(\d+)-(\d+)-(\d+\.?\d*)\s*([NSEW])/)
  if (!m) return null
  let val = parseInt(m[1]) + parseInt(m[2])/60 + parseFloat(m[3])/3600
  if (m[4] === 'S' || m[4] === 'W') val = -val
  return val
}

function AlternatesItem({ item, isChecked, onToggle }) {
  const [open, setOpen]       = useState(false)
  const [depIcao, setDepIcao] = useState('')
  const [destIcao, setDestIcao] = useState('')
  const [depPos, setDepPos]   = useState(null)
  const [destPos, setDestPos] = useState(null)
  const [burnRate, setBurnRate] = useState(10)

  // Takeoff alternate state
  const [toAlts, setToAlts]           = useState([])
  const [toQuery, setToQuery]         = useState('')
  const [toShowList, setToShowList]   = useState(false)
  const [toLoading, setToLoading]     = useState(false)
  const [toError, setToError]         = useState(null)
  const [toSuggestions, setToSuggestions] = useState([])
  const [toSuggestLoad, setToSuggestLoad] = useState(false)

  // Landing alternate state
  const [ldAlts, setLdAlts]           = useState([])
  const [ldQuery, setLdQuery]         = useState('')
  const [ldShowList, setLdShowList]   = useState(false)
  const [ldLoading, setLdLoading]     = useState(false)
  const [ldError, setLdError]         = useState(null)
  const [ldSuggestions, setLdSuggestions] = useState([])
  const [ldSuggestLoad, setLdSuggestLoad] = useState(false)

  const FAA_PDF_BASE = 'https://aeronav.faa.gov/d-tpp/2606/'

  function altMinUrl(icao) {
    if (!icao) return null
    const ident = icao.replace(/^K/, '').toUpperCase()
    const charts = FAA_CHARTS_DATA[ident] || []
    const chart  = charts.find(([code, name]) => code === 'MIN' && name === 'ALTERNATE MINIMUMS')
    return chart ? FAA_PDF_BASE + chart[2] : null
  }

  async function fetchSuggestions(pos, excludeIcao, setSugg, setLoad) {
    if (!pos) return
    setSugg([]); setLoad(true)
    try {
      const pad = 1.2
      const bbox = `${pos[1]-pad},${pos[0]-pad},${pos[1]+pad},${pos[0]+pad}`
      const url = `https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/US_Airport/FeatureServer/0/query?where=OPERSTATUS%3D%27OPERATIONAL%27+AND+IAPEXISTS%3D1&geometry=${encodeURIComponent(bbox)}&geometryType=esriGeometryEnvelope&spatialRel=esriSpatialRelIntersects&outFields=ICAO_ID,IDENT,NAME,LATITUDE,LONGITUDE,ELEVATION,STATE&returnGeometry=false&f=json`
      const res  = await fetch(url, { signal: AbortSignal.timeout(8000) })
      const data = await res.json()
      const nearby = (data.features || [])
        .map(f => {
          const a = f.attributes
          const lat = parseDMSAlt(a.LATITUDE), lon = parseDMSAlt(a.LONGITUDE)
          if (!a.ICAO_ID || !lat || !lon) return null
          const dist = Math.round(haversineNm(pos[0], pos[1], lat, lon))
          return { icao: a.ICAO_ID, name: a.NAME, state: a.STATE, lat, lon, elev: a.ELEVATION, dist }
        })
        .filter(a => a && a.icao !== excludeIcao && a.dist <= 70 && a.dist > 0)
        .sort((a, b) => a.dist - b.dist)
        .slice(0, 8)
      if (!nearby.length) { setLoad(false); return }
      const ids = nearby.map(a => a.icao).join(',')
      let metars = {}
      try {
        const mRes  = await fetch(`https://aviationweather.gov/api/data/metar?ids=${ids}&format=json&hours=3`, { signal: AbortSignal.timeout(8000) })
        const mData = await mRes.json()
        if (Array.isArray(mData)) mData.forEach(m => { metars[m.station_id || m.icaoId] = m.raw_text || '' })
      } catch { /* ignore */ }
      const withWx = nearby.map(a => ({ ...a, wx: metars[a.icao] ? parseMetar(metars[a.icao]) : null }))
      const catOrder = { VFR: 0, MVFR: 1, IFR: 2, LIFR: 3, null: 4 }
      withWx.sort((a, b) => {
        const ca = flightCatSort(a.wx), cb = flightCatSort(b.wx)
        return catOrder[ca] !== catOrder[cb] ? catOrder[ca] - catOrder[cb] : a.dist - b.dist
      })
      setSugg(withWx.slice(0, 5))
    } catch { /* ignore */ } finally { setLoad(false) }
  }

  useEffect(() => {
    if (!open) return
    get('settings', 'cruise').then(c => { if (c?.burnRate) setBurnRate(parseFloat(c.burnRate) || 10) })
    get('settings', 'route').then(r => {
      if (!r) return
      const d = (r.dep  || '').toUpperCase()
      const x = (r.dest || '').toUpperCase()
      setDepIcao(d); setDestIcao(x)
      if (r.depPos)  setDepPos(r.depPos)
      if (r.destPos) setDestPos(r.destPos)
      fetchSuggestions(r.depPos,  d, setToSuggestions, setToSuggestLoad)
      fetchSuggestions(r.destPos, x, setLdSuggestions, setLdSuggestLoad)
    }).catch(() => {})
  }, [open])

  async function addAlt(icao, refPos, refIcao, setAlts, setQuery, setShowList, setLoading, setError) {
    setQuery(''); setShowList(false); setLoading(true); setError(null)
    try {
      const [apt, metarRaw] = await Promise.allSettled([
        lookupAirport(icao),
        proxyText(`https://aviationweather.gov/api/data/metar?ids=${icao}&format=raw&hours=3`),
      ])
      if (apt.status !== 'fulfilled') throw new Error('Airport not found')
      const airport = apt.value
      const raw = metarRaw.status === 'fulfilled' ? (metarRaw.value || '').trim() : ''
      const wx = raw.length > 8 ? parseMetar(raw) : null
      let distNm = null, bearing = null
      const aLat = parseFloat(airport.lat), aLon = parseFloat(airport.lon)
      if (refPos && !isNaN(aLat) && !isNaN(aLon)) {
        distNm  = Math.round(haversineNm(refPos[0], refPos[1], aLat, aLon))
        bearing = Math.round(bearingDeg(refPos[0], refPos[1], aLat, aLon))
      }
      setAlts(prev => [...prev, { ...airport, raw, wx, distNm, bearing, refIcao }])
    } catch (e) {
      setError(e.message || 'Airport not found')
    } finally { setLoading(false) }
  }

  const fuelToAlt = (distNm) => {
    if (!distNm) return null
    return ((distNm / 120) * burnRate).toFixed(1)
  }

  function flightCat(wx) {
    if (!wx) return null
    const vis = parseFloat(wx.vis)
    const ceilMatch = (wx.clouds || '').match(/BKN(\d{3})|OVC(\d{3})/)
    const ceil = ceilMatch ? parseInt(ceilMatch[1] || ceilMatch[2]) * 100 : Infinity
    if ((!isNaN(vis) && vis < 1) || ceil < 500)  return { cat: 'LIFR' }
    if ((!isNaN(vis) && vis < 3) || ceil < 1000) return { cat: 'IFR' }
    if ((!isNaN(vis) && vis < 5) || ceil < 3000) return { cat: 'MVFR' }
    return { cat: 'VFR' }
  }
  function flightCatSort(wx) { const c = flightCat(wx); return c ? c.cat : null }

  function AltCard({ title, refIcao, refPos, alts, setAlts, query, setQuery, showList, setShowList,
    loading, setLoading, error, setError, suggestions, suggestLoad }) {

    const altMinLink = altMinUrl(refIcao)
    const matches = query.length >= 1
      ? FAA_AIRPORTS.filter(a =>
          a.icao.startsWith(query.toUpperCase()) ||
          a.name.toLowerCase().includes(query.toLowerCase()) ||
          a.city.toLowerCase().includes(query.toLowerCase())
        ).filter(a => !alts.find(x => x.icaoId === a.icao)).slice(0, 6)
      : []

    return (
      <div style={{ margin: '10px 14px 0', borderRadius: 12, border: '0.5px solid var(--border)',
        background: 'var(--bg-card-2)', overflow: 'visible' }}>
        {/* Card header */}
        <div style={{ padding: '10px 12px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-tertiary)',
            textTransform: 'uppercase', letterSpacing: '0.5px' }}>{title}</span>
          {refIcao && <span style={{ fontSize: 11, fontWeight: 700, fontFamily: 'monospace',
            color: 'var(--text-secondary)' }}>{refIcao}</span>}
        </div>

        {/* Search */}
        <div style={{ padding: '8px 10px 6px', position: 'relative' }}>
          <div style={{ position: 'relative' }}>
            <input
              value={query}
              onChange={e => { setQuery(e.target.value); setShowList(true); setError(null) }}
              onFocus={() => setShowList(true)}
              onBlur={() => setTimeout(() => setShowList(false), 150)}
              placeholder="Search by ICAO, name or city…"
              style={{
                width: '100%', background: 'var(--bg)', border: '0.5px solid var(--border)',
                borderRadius: showList && matches.length ? '8px 8px 0 0' : 8,
                padding: '9px 11px', color: 'var(--text)', fontSize: 13, outline: 'none', boxSizing: 'border-box',
              }}
            />
            {loading && <div style={{ position: 'absolute', right: 11, top: '50%', transform: 'translateY(-50%)',
              fontSize: 12, color: 'var(--text-tertiary)' }}>…</div>}
          </div>
          {showList && matches.length > 0 && (
            <div style={{ position: 'absolute', left: 10, right: 10, zIndex: 20,
              background: 'var(--bg-card-2)', border: '0.5px solid var(--border)', borderTop: 'none',
              borderRadius: '0 0 8px 8px', overflow: 'hidden' }}>
              {matches.map((a, i) => (
                <button key={a.icao} onMouseDown={() => addAlt(a.icao, refPos, refIcao, setAlts, setQuery, setShowList, setLoading, setError)}
                  style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none',
                    borderTop: i > 0 ? '0.5px solid var(--border)' : 'none',
                    padding: '8px 11px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 9 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', fontFamily: 'monospace', minWidth: 40 }}>{a.icao}</span>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--text)' }}>{a.name}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{a.city}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
          {error && <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 6 }}>{error}</div>}
        </div>

        {/* Suggestions */}
        {(suggestLoad || suggestions.length > 0) && (
          <div style={{ padding: '0 10px 6px' }}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase',
              color: 'var(--text-tertiary)', marginBottom: 6 }}>Nearest with IAP · auto-detected</div>
            {suggestLoad ? (
              <div style={{ display: 'flex', gap: 6 }}>{[1,2,3].map(i => <Bone key={i} w={80} h={44} r={7} />)}</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {suggestions.filter(s => !alts.find(a => a.icaoId === s.icao)).map(s => {
                  const cat = flightCat(s.wx)
                  return (
                    <button key={s.icao} onClick={() => addAlt(s.icao, refPos, refIcao, setAlts, setQuery, setShowList, setLoading, setError)}
                      style={{ width: '100%', textAlign: 'left', cursor: 'pointer',
                        background: 'var(--bg)', border: '0.5px solid var(--border)',
                        borderRadius: 8, padding: '7px 10px',
                        display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: 'var(--border-strong)' }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                          <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--text)', fontFamily: 'monospace' }}>{s.icao}</span>
                          {cat && <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-secondary)' }}>{cat.cat}</span>}
                          <span style={{ fontSize: 10, color: 'var(--text-tertiary)', marginLeft: 'auto' }}>{s.dist} NM</span>
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 1, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                          {s.name}{s.state ? `, ${s.state}` : ''}{s.wx?.wind ? ` · ${s.wx.wind}` : ''}
                        </div>
                      </div>
                      <span style={{ fontSize: 16, color: 'var(--text-tertiary)', flexShrink: 0 }}>+</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* Loaded alternates */}
        {alts.length > 0 && (
          <div style={{ borderTop: '0.5px solid var(--border)' }}>
            {alts.map((alt, i) => {
              const cat = flightCat(alt.wx)
              const fuel = fuelToAlt(alt.distNm)
              return (
                <div key={alt.icaoId} style={{ borderTop: i > 0 ? '0.5px solid var(--border)' : 'none', padding: '10px 12px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 7 }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                        <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', fontFamily: 'monospace' }}>{alt.icaoId}</span>
                        {cat && <span style={{ fontSize: 9, fontWeight: 800, color: 'var(--text-secondary)',
                          background: 'var(--accent-light)', borderRadius: 4, padding: '2px 5px',
                          border: '0.5px solid var(--border)' }}>{cat.cat}</span>}
                        {!alt.wx && <span style={{ fontSize: 9, color: 'var(--text-tertiary)', fontStyle: 'italic' }}>no WX</span>}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                        {alt.name}{alt.state ? `, ${alt.state}` : ''}
                      </div>
                    </div>
                    <button onClick={() => setAlts(prev => prev.filter(a => a.icaoId !== alt.icaoId))}
                      style={{ background: 'none', border: 'none', cursor: 'pointer',
                        fontSize: 13, color: 'var(--text-tertiary)', padding: '0 0 0 8px', lineHeight: 1 }}>✕</button>
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginBottom: alt.wx ? 8 : 0 }}>
                    {alt.distNm != null && (
                      <div style={{ flex: 1, background: 'var(--bg)', borderRadius: 7, padding: '6px 9px' }}>
                        <div style={{ fontSize: 14, fontWeight: 800, fontFamily: 'monospace', color: 'var(--text)' }}>{alt.distNm} <span style={{ fontSize: 10, fontWeight: 500 }}>NM</span></div>
                        <div style={{ fontSize: 9, color: 'var(--text-tertiary)', marginTop: 1, textTransform: 'uppercase', letterSpacing: '0.4px' }}>from {alt.refIcao || refIcao} · {alt.bearing}°</div>
                      </div>
                    )}
                    {fuel != null && (
                      <div style={{ flex: 1, background: 'var(--bg)', borderRadius: 7, padding: '6px 9px' }}>
                        <div style={{ fontSize: 14, fontWeight: 800, fontFamily: 'monospace', color: 'var(--text)' }}>{fuel} <span style={{ fontSize: 10, fontWeight: 500 }}>gal</span></div>
                        <div style={{ fontSize: 9, color: 'var(--text-tertiary)', marginTop: 1, textTransform: 'uppercase', letterSpacing: '0.4px' }}>est. fuel @ {burnRate} GPH</div>
                      </div>
                    )}
                    {alt.elev && (
                      <div style={{ flex: 1, background: 'var(--bg)', borderRadius: 7, padding: '6px 9px' }}>
                        <div style={{ fontSize: 14, fontWeight: 800, fontFamily: 'monospace', color: 'var(--text)' }}>{alt.elev}</div>
                        <div style={{ fontSize: 9, color: 'var(--text-tertiary)', marginTop: 1, textTransform: 'uppercase', letterSpacing: '0.4px' }}>elevation</div>
                      </div>
                    )}
                  </div>
                  {alt.wx && (() => {
                    const w = alt.wx
                    return (
                      <div style={{ background: 'var(--bg)', borderRadius: 7, padding: '7px 9px', display: 'flex', flexWrap: 'wrap', gap: '3px 12px' }}>
                        {w.wind && <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}><span style={{ opacity: 0.5, marginRight: 3 }}>WND</span>{w.wind}</div>}
                        {w.vis  && <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}><span style={{ opacity: 0.5, marginRight: 3 }}>VIS</span>{w.vis}</div>}
                        {w.clouds && <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}><span style={{ opacity: 0.5, marginRight: 3 }}>SKY</span>{w.clouds}</div>}
                        {w.temp && <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}><span style={{ opacity: 0.5, marginRight: 3 }}>TMP</span>{w.temp}</div>}
                        {w.qnh  && <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}><span style={{ opacity: 0.5, marginRight: 3 }}>ALT</span>{w.qnh}</div>}
                        {w.wx   && <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}><span style={{ opacity: 0.5, marginRight: 3 }}>WX</span>{w.wx}</div>}
                      </div>
                    )
                  })()}
                </div>
              )
            })}
          </div>
        )}

        {/* Alternate Minimums link */}
        {altMinLink && (
          <a href={altMinLink} target="_blank" rel="noreferrer" style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            margin: '6px 10px 10px', background: 'var(--bg)', border: '0.5px solid var(--border)',
            borderRadius: 8, padding: '8px 10px', textDecoration: 'none',
          }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>Alternate Minimums</div>
              <div style={{ fontSize: 9, color: 'var(--text-tertiary)', marginTop: 1 }}>{refIcao} · FAA Official · PDF</div>
            </div>
            <svg width={12} height={12} viewBox="0 0 24 24" fill="none" style={{ color: 'var(--text-tertiary)', flexShrink: 0 }}>
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <polyline points="15 3 21 3 21 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <line x1="10" y1="14" x2="21" y2="3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </a>
        )}
        {!altMinLink && <div style={{ height: 10 }} />}
      </div>
    )
  }

  return (
    <ExpandableCard item={item} isChecked={isChecked} onToggle={onToggle} open={open} setOpen={setOpen}>

      {/* No route set — prompt */}
      {!depPos && !destPos && !toSuggestLoad && !ldSuggestLoad && (
        <div style={{ padding: '16px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-tertiary)', flexShrink: 0 }}><path d="M22 2L11 13"/><path d="M22 2L15 22l-4-9-9-4 20-7z"/></svg>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Set your route first</div>
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>
              Enter departure and destination in Route &amp; Altitude — nearby alternates will auto-suggest here.
            </div>
          </div>
        </div>
      )}

      <AltCard
        title="Takeoff Alternate"
        refIcao={depIcao} refPos={depPos}
        alts={toAlts} setAlts={setToAlts}
        query={toQuery} setQuery={setToQuery}
        showList={toShowList} setShowList={setToShowList}
        loading={toLoading} setLoading={setToLoading}
        error={toError} setError={setToError}
        suggestions={toSuggestions} suggestLoad={toSuggestLoad}
      />

      <AltCard
        title="Landing Alternate"
        refIcao={destIcao} refPos={destPos}
        alts={ldAlts} setAlts={setLdAlts}
        query={ldQuery} setQuery={setLdQuery}
        showList={ldShowList} setShowList={setLdShowList}
        loading={ldLoading} setLoading={setLdLoading}
        error={ldError} setError={setLdError}
        suggestions={ldSuggestions} suggestLoad={ldSuggestLoad}
      />

      {/* IFR 1-2-3 rule */}
      <div style={{ margin: '10px 14px 12px', background: 'var(--accent-light)', borderRadius: 8,
        padding: '8px 10px', border: '0.5px solid rgba(0,122,255,0.2)' }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent)', letterSpacing: '0.5px', marginBottom: 3 }}>IFR 1-2-3 RULE</div>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          Alternate required if, from 1 hr before to 1 hr after ETA, forecast ceiling &lt; 2,000 ft or visibility &lt; 3 SM at destination.
        </div>
      </div>

      <DoneButton isChecked={isChecked} onDone={() => { onToggle(item.id); setOpen(false) }} />
    </ExpandableCard>
  )
}

/* ── METAR parser ────────────────────────────────────────────── */
function parseMetar(raw) {
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

/* ── Shared Done button ──────────────────────────────────────── */
function DoneButton({ isChecked, onDone, checkedIds, subIds }) {
  const hasChecklist = subIds && subIds.length > 0
  const pct = hasChecklist
    ? subIds.filter(id => checkedIds?.has(id)).length / subIds.length
    : 1
  const complete = isChecked || pct >= 1

  return (
    <div style={{ padding: '10px 14px 12px' }}>
      <button
        onClick={onDone}
        style={{
          position: 'relative', width: '100%', height: 44,
          borderRadius: 10, border: 'none', cursor: 'pointer',
          overflow: 'hidden',
          background: complete ? 'var(--text)' : 'var(--bg-card-2)',
          transition: 'background 0.4s ease', outline: 'none',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        {!complete && (
          <div style={{
            position: 'absolute', inset: 0,
            width: `${pct * 100}%`,
            background: 'var(--border)',
            transition: 'width 0.4s ease',
            borderRadius: 10,
          }} />
        )}
        <span style={{
          position: 'relative', zIndex: 1,
          fontSize: 14, fontWeight: 600, letterSpacing: '-0.1px',
          color: complete ? 'var(--bg)' : 'var(--text-tertiary)',
          transition: 'color 0.4s ease',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        }}>
          {complete ? (
            <>
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none">
                <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Done
            </>
          ) : 'Done'}
        </span>
      </button>
    </div>
  )
}

/* ── Density Altitude calculator ────────────────────────────── */
function DensityAltItem({ item, isChecked, onToggle }) {
  const [open, setOpen] = useState(false)
  const [tab, setTab]   = useState('dep') // 'dep' | 'dest'

  // Per-tab state: { elev, altSetting, oat, sourceLabel }
  const EMPTY = { elev: '', altSetting: '', oat: '', sourceLabel: '' }
  const [dep,  setDep]  = useState(EMPTY)
  const [dest, setDest] = useState(EMPTY)
  const cur  = tab === 'dep' ? dep  : dest
  const setCur = tab === 'dep' ? setDep : setDest

  const setField = (field, val) => setCur(prev => ({ ...prev, [field]: val }))

  // Persist both tabs to IndexedDB on any change
  useEffect(() => {
    if (!dep.elev && !dep.altSetting && !dep.oat && !dest.elev && !dest.altSetting && !dest.oat) return
    put('settings', { key: 'densityalt', dep, dest }).catch(() => {})
  }, [dep, dest])

  const [loading, setLoading] = useState(false)
  const [noRoute, setNoRoute] = useState(false)
  const [manualIcao, setManual] = useState('')

  const fetchForTab = useCallback(async (icao, tabKey) => {
    if (!icao) return
    try {
      const [apt, metar] = await Promise.allSettled([
        proxyJSON(`${AWC}/airport?ids=${icao}&format=json`),
        proxyJSON(`${AWC}/metar?ids=${icao}&format=json`),
      ])
      let autoElev = '', autoAlt = '', autoOat = ''
      if (apt.status === 'fulfilled' && apt.value?.[0]) {
        const e = apt.value[0].elev
        if (e != null) autoElev = String(Math.round(e * 3.28084))
      }
      if (metar.status === 'fulfilled' && metar.value?.[0]) {
        const d = metar.value[0]
        if (d.altim != null) autoAlt = (d.altim * 0.02953).toFixed(2)
        if (d.temp  != null) autoOat  = String(Math.round(d.temp))
        if (!autoElev && d.elev != null) autoElev = String(Math.round(d.elev * 3.28084))
      }
      if (autoElev || autoAlt || autoOat) {
        const update = { elev: autoElev, altSetting: autoAlt, oat: autoOat, sourceLabel: icao.toUpperCase() }
        if (tabKey === 'dep')  setDep(update)
        else                   setDest(update)
      }
    } catch { /* ignore */ }
  }, [])

  // On open: restore saved, then refresh both tabs from live METARs
  useEffect(() => {
    if (!open) return
    get('settings', 'densityalt').then(saved => {
      if (saved?.dep || saved?.dest) {
        if (saved.dep)  setDep(prev => ({ ...EMPTY, ...saved.dep }))
        if (saved.dest) setDest(prev => ({ ...EMPTY, ...saved.dest }))
      }
      get('settings', 'route').then(async r => {
        if (!r?.dep && !r?.dest) { setNoRoute(true); return }
        setNoRoute(false)
        setLoading(true)
        await Promise.allSettled([
          r.dep  ? fetchForTab(r.dep,  'dep')  : Promise.resolve(),
          r.dest ? fetchForTab(r.dest, 'dest') : Promise.resolve(),
        ])
        setLoading(false)
      })
    })
  }, [open])

  // Calculations for current tab
  const elevN = parseFloat(cur.elev)
  const altN  = parseFloat(cur.altSetting)
  const oatN  = parseFloat(cur.oat)
  const valid = !isNaN(elevN) && !isNaN(altN) && !isNaN(oatN)

  // Both tabs need valid data to mark complete
  const depValid  = !isNaN(parseFloat(dep.elev))  && !isNaN(parseFloat(dep.altSetting))  && !isNaN(parseFloat(dep.oat))
  const destValid = !isNaN(parseFloat(dest.elev)) && !isNaN(parseFloat(dest.altSetting)) && !isNaN(parseFloat(dest.oat))
  const bothValid = depValid && destValid

  function tabDaColor(s) {
    const e = parseFloat(s.elev), a = parseFloat(s.altSetting), o = parseFloat(s.oat)
    if (isNaN(e) || isNaN(a) || isNaN(o)) return null
    const pa  = Math.round(e + (29.92 - a) * 1000)
    const isa = 15 - 2 * (e / 1000)
    const da  = Math.round(pa + 120 * (o - isa))
    return da > 8000 ? '#FF3B30' : da > 5000 ? '#FF9500' : da > 2000 ? '#FFD60A' : 'var(--ok)'
  }

  const pressureAlt = valid ? Math.round(elevN + (29.92 - altN) * 1000) : null
  const isaTemp     = valid ? 15 - 2 * (elevN / 1000) : null
  const densityAlt  = valid ? Math.round(pressureAlt + 120 * (oatN - isaTemp)) : null

  const daColor = densityAlt == null ? 'var(--text-tertiary)'
    : densityAlt > 8000 ? '#FF3B30'
    : densityAlt > 5000 ? '#FF9500'
    : densityAlt > 2000 ? '#FFD60A'
    : 'var(--ok)'
  const daLabel = densityAlt == null ? '—'
    : densityAlt > 8000 ? 'HIGH — significant perf loss'
    : densityAlt > 5000 ? 'ELEVATED — check POH tables'
    : densityAlt > 2000 ? 'MODERATE — verify climb gradient'
    : 'NORMAL — standard conditions'

  const Field = ({ label, value, onChange, unit, placeholder }) => (
    <div style={{ flex: 1, minWidth: 80 }}>
      <div style={{ fontSize: 10, color: 'var(--text-tertiary)', fontWeight: 600, letterSpacing: '0.4px', marginBottom: 4, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', background: 'var(--bg-card-2)', borderRadius: 8, padding: '7px 10px', gap: 4 }}>
        <input type="number" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
          style={{ flex: 1, background: 'none', border: 'none', outline: 'none', fontSize: 15, fontWeight: 600,
            color: 'var(--text)', fontFamily: 'monospace', width: 0, minWidth: 0 }} />
        <span style={{ fontSize: 11, color: 'var(--text-tertiary)', flexShrink: 0 }}>{unit}</span>
      </div>
    </div>
  )

  return (
    <ExpandableCard item={item} isChecked={isChecked} onToggle={onToggle} open={open} setOpen={setOpen}>

      {/* ── Tab pill switcher ── */}
      <div style={{ padding: '10px 14px 0' }}>
        <div onClick={() => setTab(t => t === 'dep' ? 'dest' : 'dep')} style={{
          position: 'relative', display: 'flex',
          background: 'var(--bg-card-2)', borderRadius: 10, padding: 3,
          cursor: 'pointer', userSelect: 'none',
        }}>
          <div style={{
            position: 'absolute', top: 3, bottom: 3, width: 'calc(50% - 3px)',
            left: tab === 'dep' ? 3 : 'calc(50%)',
            background: 'var(--accent)', borderRadius: 7,
            transition: 'left 0.22s cubic-bezier(0.4,0,0.2,1)',
            pointerEvents: 'none',
          }} />
          {[['dep', dep], ['dest', dest]].map(([key, state]) => {
            const isActive = tab === key
            const dotColor = tabDaColor(state)
            return (
              <div key={key} style={{
                flex: 1, padding: '5px 10px', zIndex: 1,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                color: isActive ? 'var(--accent-fg)' : 'var(--text-secondary)',
              }}>
                <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'monospace', letterSpacing: '1px' }}>
                  {state.sourceLabel || (key === 'dep' ? 'DEP' : 'ARR')}
                </span>
                {dotColor && (
                  <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
                    background: dotColor, flexShrink: 0,
                  }} />
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div style={{ padding: '0 14px 0' }}>

        {/* ── Airport header ── */}
        <div style={{ paddingTop: 14, paddingBottom: 12, marginBottom: 14 }}>
          {loading ? (
            <div style={{ height: 36, display: 'flex', alignItems: 'center' }}>
              <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>Fetching METAR…</div>
            </div>
          ) : noRoute ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={manualIcao} onChange={e => setManual(e.target.value.toUpperCase())}
                placeholder={tab === 'dep' ? 'Departure ICAO' : 'Arrival ICAO'} maxLength={6}
                style={{ flex: 1, background: 'var(--bg-card-2)', border: '0.5px solid var(--border)',
                  borderRadius: 8, padding: '10px 12px', fontSize: 16, fontWeight: 700,
                  color: 'var(--text)', outline: 'none', fontFamily: 'monospace', letterSpacing: '1px' }} />
              <button onClick={async () => { if (manualIcao.length >= 3) { setNoRoute(false); setLoading(true); await fetchForTab(manualIcao, tab); setLoading(false) } }}
                style={{ padding: '10px 16px', borderRadius: 8, background: 'var(--text)', color: 'var(--bg)',
                  border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Fill</button>
            </div>
          ) : (
            <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.5px',
              fontFamily: 'monospace', lineHeight: 1 }}>
              {cur.sourceLabel || (tab === 'dep' ? 'DEP' : 'ARR')}
            </div>
          )}
        </div>

        {/* ── Input fields ── */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <Field label="Elevation" value={cur.elev} onChange={v => setField('elev', v)} unit="ft" placeholder="0" />
          <Field label="Altimeter" value={cur.altSetting} onChange={v => setField('altSetting', v)} unit="inHg" placeholder="29.92" />
          <Field label="OAT" value={cur.oat} onChange={v => setField('oat', v)} unit="°C" placeholder="15" />
        </div>

        {/* ── Results ── */}
        {valid && (
          <>
            {/* PA + ISA row */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <div style={{ flex: 1, background: 'var(--bg-card-2)', borderRadius: 10, padding: '10px 12px' }}>
                <div style={{ fontSize: 9, color: 'var(--text-tertiary)', fontWeight: 700, letterSpacing: '0.6px',
                  textTransform: 'uppercase', marginBottom: 5 }}>Pressure Alt</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                  <span style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)', fontFamily: 'monospace' }}>
                    {pressureAlt.toLocaleString()}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>ft</span>
                </div>
              </div>
              <div style={{ flex: 1, background: 'var(--bg-card-2)', borderRadius: 10, padding: '10px 12px' }}>
                <div style={{ fontSize: 9, color: 'var(--text-tertiary)', fontWeight: 700, letterSpacing: '0.6px',
                  textTransform: 'uppercase', marginBottom: 5 }}>ISA Deviation</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                  <span style={{ fontSize: 22, fontWeight: 800, fontFamily: 'monospace', color: 'var(--text)' }}>
                    {oatN - isaTemp >= 0 ? '+' : ''}{(oatN - isaTemp).toFixed(0)}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>°C</span>
                </div>
                <div style={{ fontSize: 9, color: 'var(--text-tertiary)', marginTop: 2 }}>
                  ISA at this elev: {isaTemp.toFixed(0)}°C
                </div>
              </div>
            </div>

            {/* Density altitude hero */}
            <div style={{ background: 'var(--bg-card-2)', borderRadius: 12, padding: '14px 14px 12px',
              marginBottom: 14 }}>
              <div style={{ fontSize: 9, color: 'var(--text-tertiary)', fontWeight: 700,
                letterSpacing: '0.6px', textTransform: 'uppercase', marginBottom: 6 }}>Density Altitude</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 42, fontWeight: 900, color: 'var(--text)', fontFamily: 'monospace',
                  letterSpacing: '-2px', lineHeight: 1 }}>
                  {densityAlt.toLocaleString()}
                </span>
                <span style={{ fontSize: 16, color: 'var(--text-tertiary)', fontWeight: 500 }}>ft</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600, letterSpacing: '0.2px' }}>
                {daLabel}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Blocked Done */}
      {!bothValid && !isChecked && (
        <div style={{ borderTop: '0.5px solid var(--border)', padding: '10px 14px 12px' }}>
          <div style={{ width: '100%', padding: '11px 0', borderRadius: 10,
            background: 'var(--bg-card-2)', border: '0.5px solid var(--border)',
            color: 'var(--text-tertiary)', fontSize: 13, fontWeight: 600,
            textAlign: 'center' }}>
            {!depValid && !destValid ? 'Fill Departure and Arrival to complete'
              : depValid  ? 'Check Arrival tab to complete'
              : 'Check Departure tab to complete'}
          </div>
        </div>
      )}
      {(bothValid || isChecked) && (
        <DoneButton isChecked={isChecked} onDone={() => { onToggle(item.id); setOpen(false) }} />
      )}
    </ExpandableCard>
  )
}

/* ── Cardinal direction helper ── */
function toCardinal(deg) {
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW']
  return dirs[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16]
}

/* ── Field tooltip — fixed position, escapes any overflow:hidden parent ── */
function FieldTip({ label, tip, children, style: outerStyle }) {
  const [pos, setPos] = useState(null)
  const labelRef = useRef(null)

  const show = (e) => {
    const r = labelRef.current?.getBoundingClientRect()
    if (!r) return
    // Position below the label, clamp to viewport width
    const left = Math.min(r.left, window.innerWidth - 212)
    setPos({ top: r.bottom + 6, left })
  }
  const hide = () => setPos(null)
  const toggle = () => pos ? hide() : show()

  return (
    <div style={{ flex: 1, ...outerStyle }}>
      <div
        ref={labelRef}
        onMouseEnter={show}
        onMouseLeave={hide}
        onClick={toggle}
        style={{ fontSize: 9, color: 'var(--text-tertiary)', fontWeight: 700,
          letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: 4,
          cursor: 'default', userSelect: 'none', display: 'inline-block' }}
      >
        {label}
      </div>
      {pos && (
        <div style={{
          position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999,
          fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5,
          background: 'var(--bg-card)', borderRadius: 8, padding: '8px 10px',
          border: '0.5px solid var(--border-strong)',
          boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
          width: 200, pointerEvents: 'none',
        }}>
          {tip}
        </div>
      )}
      {children}
    </div>
  )
}

/* ── Shared input for PerfDistItem (must be module-level to keep identity stable) ── */
function PerfSmallInput({ label, value, onChange, unit }) {
  return (
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 9, color: 'var(--text-tertiary)', fontWeight: 700,
        letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', background: 'var(--bg-card-2)',
        borderRadius: 7, padding: '7px 9px', gap: 3 }}>
        <input type="number" value={value} onChange={e => onChange(e.target.value)}
          placeholder="—" style={{ flex: 1, background: 'none', border: 'none', outline: 'none',
            fontSize: 15, fontWeight: 700, color: 'var(--text)', fontFamily: 'monospace',
            width: 0, minWidth: 0 }} />
        <span style={{ fontSize: 10, color: 'var(--text-tertiary)', flexShrink: 0 }}>{unit}</span>
      </div>
    </div>
  )
}

/* ── Takeoff / Landing distance calculator ───────────────────── */
function PerfDistItem({ item, isChecked, onToggle }) {
  const [open,    setOpen]   = useState(false)
  const [tab,     setTab]    = useState('dep') // 'dep' = Takeoff | 'arr' = Landing

  // ── POH reference ─────────────────────────────────────────────
  const [toGR,    setToGR]   = useState('')    // TO ground roll
  const [toOver,  setToOver] = useState('')    // TO over 50ft
  const [ldgGR,   setLdgGR]  = useState('')    // LDG ground roll
  const [ldgOver, setLdgOver]= useState('')    // LDG over 50ft

  // ── Per-tab conditions (pohBase is per-tab) ───────────────────
  const ECOND = { da: null, icao: '', runways: [], selRwy: null, windDir: '', windSpd: '', surface: 'dry', slope: '0', pohBase: '0', loading: false }
  const [dep,  setDep]  = useState(ECOND)
  const [arr,  setArr]  = useState(ECOND)
  const cur    = tab === 'dep' ? dep  : arr
  const setCur = tab === 'dep' ? setDep : setArr
  const updCur = patch => setCur(prev => ({ ...prev, ...patch }))

  // ── DA helper ─────────────────────────────────────────────────
  const calcDA = (tabData) => {
    const { elev, altSetting, oat } = tabData || {}
    const e = parseFloat(elev), a = parseFloat(altSetting), o = parseFloat(oat)
    if (isNaN(e) || isNaN(a) || isNaN(o)) return null
    const pa = e + (29.92 - a) * 1000
    return Math.round(pa + 120 * (o - (15 - 2 * (e / 1000))))
  }

  // ── Fetch airport conditions for one tab ─────────────────────
  const fetchTab = useCallback(async (icao, isArr) => {
    const setter = isArr ? setArr : setDep
    setter(prev => ({ ...prev, loading: true }))
    try {
      const [aptRes, metarRes] = await Promise.allSettled([
        proxyJSON(`${AWC}/airport?ids=${icao}&format=json`),
        proxyJSON(`${AWC}/metar?ids=${icao}&format=json`),
      ])
      const patch = { icao: icao.toUpperCase(), loading: false }
      // Elevation
      if (aptRes.status === 'fulfilled' && aptRes.value?.[0]) {
        const apt = aptRes.value[0]
        if (apt.elev != null) patch.elevFt = Math.round(apt.elev * 3.28084)
        // Runways
        const rwyList = []
        for (const rwy of (apt.runways || [])) {
          const ids = (rwy.id || '').split('/')
          const align = rwy.alignment
          const grad  = rwy.gradient ?? null // slope % (positive = uphill for first end)
          if (ids[0] && align != null) {
            rwyList.push({ id: ids[0], hdg: align % 360, slope: grad })
            if (ids[1]) rwyList.push({ id: ids[1], hdg: (align + 180) % 360, slope: grad != null ? -grad : null })
          }
        }
        // Auto-fill slope from first runway if available
        if (rwyList.length && rwyList[0].slope != null) patch.slope = String(rwyList[0].slope)
        patch.runways = rwyList
        if (rwyList.length) patch.selRwy = rwyList[0]
      }
      // METAR
      if (metarRes.status === 'fulfilled' && metarRes.value?.[0]) {
        const d = metarRes.value[0]
        if (d.altim != null) patch.altSetting = (d.altim * 0.02953).toFixed(2)
        if (d.temp  != null) patch.oat = String(Math.round(d.temp))
        if (!patch.elevFt && d.elev != null) patch.elevFt = Math.round(d.elev * 3.28084)
        if (d.wdir  != null) patch.windDir = String(d.wdir)
        else if (d.wspd != null && /\bVRB\d/i.test(d.rawOb || '')) patch.windDir = 'VRB'
        if (d.wspd  != null) patch.windSpd = String(d.wspd)
      }
      // DA from fetched data
      patch.da = calcDA({ elev: patch.elevFt, altSetting: patch.altSetting, oat: patch.oat })
      setter(prev => ({ ...prev, ...patch }))
      // Auto-fill baseline altitude from airport elevation (dep tab only)
      if (patch.elevFt != null) (isArr ? setArr : setDep)(prev => ({ ...prev, pohBase: String(patch.elevFt) }))
    } catch {
      setter(prev => ({ ...prev, loading: false }))
    }
  }, [])

  // ── On open: restore + refresh ───────────────────────────────
  useEffect(() => {
    if (!open) return
    const parsePerf = v => v ? String(parseFloat(String(v).replace(/,/g, '')) || '') : ''
    Promise.all([get('settings', 'perfdist'), get('aircraft', 'profile')]).then(([saved, profile]) => {
      if (saved?.dep?.pohBase != null) setDep(prev => ({ ...prev, pohBase: saved.dep.pohBase }))
      if (saved?.arr?.pohBase != null) setArr(prev => ({ ...prev, pohBase: saved.arr.pohBase }))
      if (saved?.toGR     != null) setToGR(saved.toGR)
      if (saved?.toOver   != null) setToOver(saved.toOver)
      if (saved?.ldgGR    != null) setLdgGR(saved.ldgGR)
      if (saved?.ldgOver  != null) setLdgOver(saved.ldgOver)
      if (saved?.dep) setDep(prev => ({ ...prev, ...saved.dep }))
      if (saved?.arr) setArr(prev => ({ ...prev, ...saved.arr }))
      // Auto-fill POH values from aircraft profile when fields are empty
      if (!saved?.toGR    && profile?.perf?.toRoll)  setToGR(parsePerf(profile.perf.toRoll))
      if (!saved?.toOver  && profile?.perf?.to50ft)  setToOver(parsePerf(profile.perf.to50ft))
      if (!saved?.ldgGR   && profile?.perf?.ldgRoll) setLdgGR(parsePerf(profile.perf.ldgRoll))
      if (!saved?.ldgOver && profile?.perf?.ldg50ft) setLdgOver(parsePerf(profile.perf.ldg50ft))
    })
    // Also pull DA from the DA card as a fallback
    get('settings', 'densityalt').then(da => {
      if (da?.dep) { const d = calcDA(da.dep); if (d) setDep(prev => ({ ...prev, da: d })) }
      if (da?.dest){ const d = calcDA(da.dest); if (d) setArr(prev => ({ ...prev, da: d })) }
    })
    get('settings', 'route').then(async r => {
      await Promise.allSettled([
        r?.dep  ? fetchTab(r.dep,  false) : Promise.resolve(),
        r?.dest ? fetchTab(r.dest, true)  : Promise.resolve(),
      ])
    })
  }, [open])

  // ── Persist ───────────────────────────────────────────────────
  useEffect(() => {
    put('settings', { key: 'perfdist', toGR, toOver, ldgGR, ldgOver, dep, arr }).catch(() => {})
  }, [toGR, toOver, ldgGR, ldgOver, dep, arr])

  // ── Calculations for current tab ─────────────────────────────
  const baseFt   = parseFloat(cur.pohBase) || 0
  const daFt     = cur.da ?? 0
  const slopePct = parseFloat(cur.slope) || 0
  const wDir     = parseFloat(cur.windDir)
  const wSpd     = parseFloat(cur.windSpd)
  const rwyHdg   = cur.selRwy?.hdg ?? 0
  const hwComp   = (!isNaN(wDir) && !isNaN(wSpd))
    ? Math.round(wSpd * Math.cos((wDir - rwyHdg) * Math.PI / 180)) : 0

  const daFactor   = 1 + Math.max(0, daFt - baseFt) / 1000 * 0.10
  const windFactor = hwComp >= 0
    ? Math.max(0.5, 1 - (hwComp / 9) * 0.10)
    : Math.min(2.5, 1 + (Math.abs(hwComp) / 2) * 0.10)
  const surfFactor    = cur.surface === 'wet' ? 1.20 : 1.00
  const slopeFactorTO = 1 + Math.max(0, slopePct) * 0.07 - Math.max(0, -slopePct) * 0.02
  const slopeFactorLD = 1 + Math.max(0, -slopePct) * 0.05 - Math.max(0, slopePct) * 0.02

  const combinedTO = daFactor * windFactor * surfFactor * slopeFactorTO
  const combinedLD = daFactor * windFactor * surfFactor * slopeFactorLD

  const calc = (base, f) => base && !isNaN(parseFloat(base)) ? Math.round(parseFloat(base) * f) : null
  const isDepTab = tab === 'dep'
  const toGRc    = calc(toGR,   combinedTO)
  const toOverc  = calc(toOver, combinedTO)
  const ldgGRc   = calc(ldgGR,  combinedLD)
  const ldgOverc = calc(ldgOver, combinedLD)
  const accelStop= calc(toGR,   combinedTO * 1.25)

  // POH filled enough to show results
  const allFilled = toGR && toOver && ldgGR && ldgOver

  // ── Sub-components ────────────────────────────────────────────
  const SmallInput = PerfSmallInput

  const HeroResult = ({ label, value, sub }) => (
    <div style={{ flex: 1, background: 'var(--bg-card-2)', borderRadius: 10,
      padding: '11px 12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={{ fontSize: 9, color: 'var(--text-tertiary)', fontWeight: 700,
        letterSpacing: '0.5px', textTransform: 'uppercase' }}>{label}</div>
      {value != null
        ? <>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
              <span style={{ fontSize: 26, fontWeight: 900, fontFamily: 'monospace',
                color: 'var(--text)', letterSpacing: '-0.5px' }}>{value.toLocaleString()}</span>
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>ft</span>
            </div>
            {sub && <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{sub}</div>}
          </>
        : <div style={{ fontSize: 13, color: 'var(--text-tertiary)', paddingTop: 4 }}>Enter POH values</div>
      }
    </div>
  )

  const pct = f => `${f >= 1 ? '+' : ''}${((f - 1) * 100).toFixed(0)}%`

  return (
    <ExpandableCard item={item} isChecked={isChecked} onToggle={onToggle} open={open} setOpen={setOpen}>

      {/* ── Tab toggle ── */}
      <div style={{ padding: '10px 12px', borderBottom: '0.5px solid var(--border)' }}>
        <div style={{ position: 'relative', display: 'flex', background: 'var(--bg-card-2)', borderRadius: 10, padding: 3 }}>
          <div style={{
            position: 'absolute', top: 3, bottom: 3,
            width: 'calc(50% - 3px)',
            left: tab === 'dep' ? 3 : 'calc(50%)',
            background: 'var(--accent)', borderRadius: 7,
            transition: 'left 0.22s cubic-bezier(0.4,0,0.2,1)',
            pointerEvents: 'none',
          }} />
          {[['dep', 'Takeoff'], ['arr', 'Landing']].map(([key, label]) => (
            <div key={key} onClick={() => setTab(key)} style={{
              flex: 1, padding: '6px 10px', zIndex: 1, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 700, letterSpacing: '0.3px',
              color: tab === key ? 'var(--accent-fg)' : 'var(--text-secondary)',
              transition: 'color 0.22s', userSelect: 'none',
            }}>
              {label}
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding: '14px 14px 0' }}>

        {/* ── Airport header ── */}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
          marginBottom: 14, paddingBottom: 14, borderBottom: '0.5px solid var(--border)' }}>
          <div>
            {cur.loading
              ? <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>Fetching…</div>
              : <>
                  <div style={{ fontSize: 34, fontWeight: 800, fontFamily: 'monospace',
                    color: 'var(--text)', letterSpacing: '-0.5px', lineHeight: 1 }}>
                    {cur.icao || (tab === 'dep' ? 'DEP' : 'ARR')}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>
                    {tab === 'dep' ? 'Takeoff airport' : 'Landing airport'}
                  </div>
                </>
            }
          </div>
          {/* DA badge */}
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 9, color: 'var(--text-tertiary)', fontWeight: 700,
              letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: 2 }}>Density Alt</div>
            {cur.da != null
              ? <div style={{ fontSize: 16, fontWeight: 800, fontFamily: 'monospace', color: 'var(--text)' }}>
                  {cur.da.toLocaleString()} ft
                </div>
              : <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Fill DA card</div>
            }
          </div>
        </div>

        {/* ── Runway picker ── */}
        {cur.runways.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 9, color: 'var(--text-tertiary)', fontWeight: 700,
              letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: 6 }}>
              {tab === 'dep' ? 'Takeoff Runway' : 'Landing Runway'}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 5 }}>
              {cur.runways.map(r => (
                <button key={r.id} onClick={() => {
                  updCur({ selRwy: r, ...(r.slope != null ? { slope: String(r.slope) } : {}) })
                }} style={{
                  padding: '6px 8px', borderRadius: 7, cursor: 'pointer', textAlign: 'center',
                  fontSize: 12, fontWeight: 700, fontFamily: 'monospace', border: '0.5px solid',
                  borderColor: cur.selRwy?.id === r.id ? 'var(--text)' : 'var(--border)',
                  background: cur.selRwy?.id === r.id ? 'var(--text)' : 'transparent',
                  color: cur.selRwy?.id === r.id ? 'var(--bg)' : 'var(--text-secondary)',
                  transition: 'all 0.15s',
                }}>
                  {r.id}
                  <span style={{ fontSize: 10, opacity: 0.5, marginLeft: 3, fontWeight: 400 }}>{r.hdg}°</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Wind row ── */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
          {/* Wind direction with cardinal */}
          <FieldTip label="Wind Dir" tip="Wind direction in degrees magnetic. Auto-filled from METAR. 360=N, 090=E, 180=S, 270=W.">
            <div style={{ display: 'flex', alignItems: 'center', background: 'var(--bg-card-2)',
              borderRadius: 7, padding: '0 9px', height: 36, gap: 4 }}>
              <input type="text" inputMode="numeric" value={cur.windDir} onChange={e => updCur({ windDir: e.target.value })}
                placeholder="—" style={{ flex: 1, background: 'none', border: 'none', outline: 'none',
                  fontSize: 15, fontWeight: 700, color: 'var(--text)', fontFamily: 'monospace',
                  width: 0, minWidth: 0 }} />
              <span style={{ fontSize: 10, color: 'var(--text-tertiary)', flexShrink: 0 }}>
                {cur.windDir === 'VRB' ? '' : '°'}
              </span>
              {!isNaN(wDir) && (
                <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-secondary)',
                  flexShrink: 0, letterSpacing: '0.3px' }}>{toCardinal(wDir)}</span>
              )}
            </div>
          </FieldTip>

          {/* Wind speed */}
          <FieldTip label="Wind Spd" tip="Wind speed in knots from the METAR. Auto-filled on open.">
            <div style={{ display: 'flex', alignItems: 'center', background: 'var(--bg-card-2)',
              borderRadius: 7, padding: '0 9px', height: 36, gap: 3 }}>
              <input type="number" value={cur.windSpd} onChange={e => updCur({ windSpd: e.target.value })}
                placeholder="—" style={{ flex: 1, background: 'none', border: 'none', outline: 'none',
                  fontSize: 15, fontWeight: 700, color: 'var(--text)', fontFamily: 'monospace',
                  width: 0, minWidth: 0 }} />
              <span style={{ fontSize: 10, color: 'var(--text-tertiary)', flexShrink: 0 }}>kt</span>
            </div>
          </FieldTip>

          {/* Wind component */}
          <FieldTip label="Wind Comp" tip="Headwind (HW) shortens distances. Tailwind (TW) increases them — a 10kt tailwind adds ~50% to your roll.">
            <div style={{ height: 36, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'var(--bg-card-2)', borderRadius: 7 }}>
              {cur.windDir === 'VRB' && !isNaN(wSpd)
                ? <span style={{ fontSize: 13, fontWeight: 800, fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
                    VRB {wSpd}kt
                  </span>
                : (!isNaN(wDir) && !isNaN(wSpd) && cur.selRwy)
                ? <span style={{ fontSize: 13, fontWeight: 800, fontFamily: 'monospace', color: 'var(--text)' }}>
                    {hwComp >= 0 ? '+' : ''}{hwComp}kt {hwComp >= 0 ? 'HW' : 'TW'}
                  </span>
                : <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>—</span>
              }
            </div>
          </FieldTip>
        </div>

        {/* ── Surface + slope ── */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
          <FieldTip label="Surface" tip="Wet runway increases landing roll by ~20%. Takeoff roll is less affected but still longer.">
            <div style={{ display: 'flex', background: 'var(--bg-card-2)', borderRadius: 7, padding: 3 }}>
              {['dry', 'wet'].map(s => (
                <button key={s} onClick={() => updCur({ surface: s })} style={{
                  flex: 1, padding: '6px 0', borderRadius: 5, border: 'none', cursor: 'pointer',
                  fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                  background: cur.surface === s ? 'var(--bg-card)' : 'transparent',
                  color: cur.surface === s ? 'var(--text)' : 'var(--text-tertiary)',
                  transition: 'all 0.15s',
                }}>{s}</button>
              ))}
            </div>
          </FieldTip>
          <FieldTip label="Slope" tip="Auto-filled from FAA runway data when available. Positive = uphill for takeoff (longer roll). Negative = downhill (shorter takeoff, longer landing).">
            <div style={{ display: 'flex', alignItems: 'center', background: 'var(--bg-card-2)',
              borderRadius: 7, padding: '7px 9px', gap: 3 }}>
              <input type="number" step="0.1" value={cur.slope} onChange={e => updCur({ slope: e.target.value })}
                placeholder="0" style={{ flex: 1, background: 'none', border: 'none', outline: 'none',
                  fontSize: 15, fontWeight: 700, color: 'var(--text)', fontFamily: 'monospace',
                  width: 0, minWidth: 0 }} />
              <span style={{ fontSize: 10, color: 'var(--text-tertiary)', flexShrink: 0 }}>%</span>
            </div>
          </FieldTip>
        </div>

        {/* ── POH reference (shared) ── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ fontSize: 9, color: 'var(--text-tertiary)', fontWeight: 700,
            letterSpacing: '0.5px', textTransform: 'uppercase' }}>
            POH Reference · Sea Level / Std Day
          </div>
        </div>

        {/* Baseline alt — full width, compact */}
        <div style={{ marginBottom: 8 }}>
          <FieldTip label="Baseline Altitude" tip="The reference altitude your POH table is based on. Almost all light aircraft use sea level (0 ft).">
            <div style={{ display: 'flex', alignItems: 'center', background: 'var(--bg-card-2)',
              borderRadius: 8, padding: '8px 12px', gap: 8 }}>
              <input type="number" value={cur.pohBase} onChange={e => updCur({ pohBase: e.target.value })}
                placeholder="0" style={{ flex: 1, background: 'none', border: 'none', outline: 'none',
                  fontSize: 15, fontWeight: 700, color: 'var(--text)', fontFamily: 'monospace' }} />
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>ft  ·  sea level = 0</span>
            </div>
          </FieldTip>
        </div>

        {/* 2×2 grid: Takeoff left, Landing right */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 16 }}>
          {[
            { label: 'TO Ground Roll',  tip: 'Distance from brake release to lift-off, per your POH.',             val: toGR,   set: setToGR   },
            { label: 'LDG Ground Roll', tip: 'Distance from touchdown to full stop, per your POH.',                val: ldgGR,  set: setLdgGR  },
            { label: 'TO Over 50ft',    tip: 'Distance from brake release to clearing a 50ft obstacle, POH value.',val: toOver, set: setToOver  },
            { label: 'LDG Over 50ft',   tip: 'Distance from 50ft height to full stop. Compare against runway length.',val:ldgOver,set: setLdgOver },
          ].map(({ label, tip, val, set }) => (
            <FieldTip key={label} label={label} tip={tip}>
              <div style={{ display: 'flex', alignItems: 'center', background: 'var(--bg-card-2)',
                borderRadius: 8, padding: '8px 10px', gap: 3 }}>
                <input type="number" value={val} onChange={e => set(e.target.value)} placeholder="—"
                  style={{ flex: 1, background: 'none', border: 'none', outline: 'none',
                    fontSize: 17, fontWeight: 700, color: 'var(--text)', fontFamily: 'monospace',
                    width: 0, minWidth: 0 }} />
                <span style={{ fontSize: 10, color: 'var(--text-tertiary)', flexShrink: 0 }}>ft</span>
              </div>
            </FieldTip>
          ))}
        </div>

        {/* ── Results ── */}
        {allFilled && (
          <>
            {/* Hero result cards */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
              {isDepTab ? (
                <>
                  <div style={{ flex: 1, position: 'relative' }}>
                    <FieldTip label="TO Ground Roll" tip="How far you'll roll on the runway before lifting off today, with all conditions applied." style={{ flex: 'unset' }}>
                      <div style={{ background: 'var(--bg-card-2)', borderRadius: 10, padding: '10px 12px' }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                          <span style={{ fontSize: 26, fontWeight: 900, fontFamily: 'monospace', color: 'var(--text)', letterSpacing: '-0.5px' }}>{toGRc?.toLocaleString() ?? '—'}</span>
                          <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>ft</span>
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2 }}>lift-off distance</div>
                      </div>
                    </FieldTip>
                  </div>
                  <div style={{ flex: 1, position: 'relative' }}>
                    <FieldTip label="Accel-Stop" tip="If you abort the takeoff, this is how much runway you need to accelerate and then brake to a full stop. Must fit within available runway." style={{ flex: 'unset' }}>
                      <div style={{ background: 'var(--bg-card-2)', borderRadius: 10, padding: '10px 12px' }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                          <span style={{ fontSize: 26, fontWeight: 900, fontFamily: 'monospace', color: 'var(--text)', letterSpacing: '-0.5px' }}>{accelStop?.toLocaleString() ?? '—'}</span>
                          <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>ft</span>
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2 }}>abort by here</div>
                      </div>
                    </FieldTip>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ flex: 1, position: 'relative' }}>
                    <FieldTip label="LDG Ground Roll" tip="Distance from touchdown to full stop today, with all conditions applied." style={{ flex: 'unset' }}>
                      <div style={{ background: 'var(--bg-card-2)', borderRadius: 10, padding: '10px 12px' }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                          <span style={{ fontSize: 26, fontWeight: 900, fontFamily: 'monospace', color: 'var(--text)', letterSpacing: '-0.5px' }}>{ldgGRc?.toLocaleString() ?? '—'}</span>
                          <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>ft</span>
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2 }}>full-stop distance</div>
                      </div>
                    </FieldTip>
                  </div>
                  <div style={{ flex: 1, position: 'relative' }}>
                    <FieldTip label="LDG Over 50ft" tip="Total distance from 50ft height to full stop. This is what you compare against available runway length." style={{ flex: 'unset' }}>
                      <div style={{ background: 'var(--bg-card-2)', borderRadius: 10, padding: '10px 12px' }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                          <span style={{ fontSize: 26, fontWeight: 900, fontFamily: 'monospace', color: 'var(--text)', letterSpacing: '-0.5px' }}>{ldgOverc?.toLocaleString() ?? '—'}</span>
                          <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>ft</span>
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2 }}>from 50ft to stop</div>
                      </div>
                    </FieldTip>
                  </div>
                </>
              )}
            </div>

            {/* Critical number */}
            <div style={{ position: 'relative', marginBottom: 6 }}>
              <FieldTip label="Required Runway" tip="The minimum runway length needed today. Your available runway must exceed this number — if it doesn't, do not depart." style={{ flex: 'unset' }}>
                {(() => {
                  const warn = (isDepTab ? toOverc : ldgOverc) > 3000
                  return (
                    <div style={{ background: 'var(--bg-card-2)', borderRadius: 10, padding: '12px 14px',
                      border: `1px solid ${warn ? '#FF950040' : 'transparent'}`, position: 'relative' }}>
                      {warn && (
                        <div style={{ position: 'absolute', top: 10, right: 12,
                          animation: 'warn-blink 2.4s ease-in-out infinite' }}>
                          <svg width={14} height={14} viewBox="0 0 24 24" fill="none"
                            stroke="#FF9500" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                            <line x1="12" y1="9" x2="12" y2="13"/>
                            <line x1="12" y1="17" x2="12.01" y2="17"/>
                          </svg>
                        </div>
                      )}
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                        <span style={{ fontSize: 40, fontWeight: 900, fontFamily: 'monospace', letterSpacing: '-1px', color: 'var(--text)' }}>
                          {(isDepTab ? toOverc : ldgOverc)?.toLocaleString() ?? '—'}
                        </span>
                        <span style={{ fontSize: 15, color: 'var(--text-tertiary)' }}>ft</span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>
                        Your runway must be longer than this number
                      </div>
                    </div>
                  )
                })()}
              </FieldTip>
            </div>

            {/* Correction summary strip */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
              {[
                { label: 'DA',      factor: daFactor,                              tip: 'Effect of density altitude on distances. Higher DA = thinner air = longer roll.' },
                { label: 'Wind',    factor: windFactor,                            tip: 'Headwind shortens distances (good). Tailwind increases them significantly (bad).' },
                { label: 'Surface', factor: surfFactor,                            tip: 'Wet runway adds ~20% to landing roll. Dry has no penalty.' },
                { label: 'Slope',   factor: isDepTab ? slopeFactorTO : slopeFactorLD, tip: 'Uphill takeoff = longer roll. Downhill landing = longer roll.' },
              ].map(({ label, factor, tip }) => (
                <FieldTip key={label} label={label} tip={tip} style={{ flex: 1, minWidth: 0, textAlign: 'center' }}>
                  <div style={{ background: 'var(--bg-card-2)', borderRadius: 7, padding: '5px 4px' }}>
                    <div style={{ fontSize: 12, fontWeight: 800, fontFamily: 'monospace', color: 'var(--text-tertiary)' }}>
                      {pct(factor)}
                    </div>
                  </div>
                </FieldTip>
              ))}
              <FieldTip label="Total" tip="Combined effect of all corrections. This multiplier is applied to your POH book numbers." style={{ flex: 1, minWidth: 0, textAlign: 'center' }}>
                <div style={{ background: 'var(--bg-card-2)', borderRadius: 7, padding: '5px 4px',
                  border: '0.5px solid var(--border-strong)' }}>
                  <div style={{ fontSize: 12, fontWeight: 800, fontFamily: 'monospace', color: 'var(--text)' }}>
                    {pct(isDepTab ? combinedTO : combinedLD)}
                  </div>
                </div>
              </FieldTip>
            </div>
          </>
        )}
      </div>

      {!allFilled && !isChecked && (
        <div style={{ borderTop: '0.5px solid var(--border)', padding: '10px 14px 12px' }}>
          <div style={{ width: '100%', padding: '11px 0', borderRadius: 10,
            background: 'var(--bg-card-2)', border: '0.5px solid var(--border)',
            color: 'var(--text-tertiary)', fontSize: 13, fontWeight: 600, textAlign: 'center' }}>
            Enter POH reference values to complete
          </div>
        </div>
      )}
      {(allFilled || isChecked) && (
        <DoneButton isChecked={isChecked} onDone={() => { onToggle(item.id); setOpen(false) }} />
      )}
    </ExpandableCard>
  )
}

/* ── Cruise / Fuel / Endurance calculator ────────────────────── */
function CruiseItem({ item, isChecked, onToggle }) {
  const [open, setOpen] = useState(false)

  // POH inputs
  const [tas,       setTas]       = useState('')   // cruise TAS knots
  const [burnRate,  setBurnRate]  = useState('')   // GPH
  const [fuelOnBoard, setFuelOnBoard] = useState('') // usable gallons
  const [flightRules, setFlightRules] = useState('VFR') // VFR | IFR

  // Auto-filled
  const [routeDist, setRouteDist] = useState(null) // nm
  const [windsAloft, setWindsAloft] = useState(null) // { dir, spd, temp } at altitude
  const [cruiseAlt, setCruiseAlt] = useState('')   // ft — from altitude card or manual
  const [winding, setWinding]     = useState(false)
  const [routeBearing, setRouteBearing] = useState(null) // magnetic track dep→dest
  const [depIcao, setDepIcao]     = useState('')
  const [destIcao, setDestIcao]   = useState('')

  // Tracks whether we've done the first restore (prevents save from firing before restore)
  const cruiseRestored = useRef(false)
  useEffect(() => {
    if (!cruiseRestored.current) return
    put('settings', { key: 'cruise', tas, burnRate, fuelOnBoard, flightRules, cruiseAlt }).catch(() => {})
  }, [tas, burnRate, fuelOnBoard, flightRules, cruiseAlt])

  useEffect(() => {
    if (!open) return
    Promise.all([get('settings', 'cruise'), get('aircraft', 'profile')]).then(([s, profile]) => {
      if (!cruiseRestored.current) {
        // First open: seed from aircraft profile, then overlay any saved user values
        const profileTas      = profile?.vspeeds?.cruise ? String(parseFloat(profile.vspeeds.cruise) || '') : ''
        const profileBurn     = profile?.burnRate?.cruise ? String(parseFloat(profile.burnRate.cruise) || '') : ''
        const profileFuel     = profile?.fuel?.usable     ? String(parseFloat(profile.fuel.usable)     || '') : ''
        setTas(s?.tas           || profileTas)
        setBurnRate(s?.burnRate || profileBurn)
        setFuelOnBoard(s?.fuelOnBoard || profileFuel)
      }
      // Always restore non-performance fields and label
      if (profile?.fullName) setAircraftLabel(profile.fullName)
      if (s?.flightRules) setFlightRules(s.flightRules)
      if (s?.cruiseAlt)   setCruiseAlt(s.cruiseAlt)
      cruiseRestored.current = true
    })

    // Route distance + bearing
    get('settings', 'route').then(async r => {
      if (!r?.depPos && !r?.destPos) return
      setDepIcao(r.dep || '')
      setDestIcao(r.dest || '')
      if (r.depPos && r.destPos) {
        const [lat1, lon1] = r.depPos, [lat2, lon2] = r.destPos
        // Haversine distance
        const R = 3440.065 // nm
        const dLat = (lat2 - lat1) * Math.PI / 180
        const dLon = (lon2 - lon1) * Math.PI / 180
        const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2
        setRouteDist(Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))))
        // True bearing dep→dest
        const y = Math.sin(dLon) * Math.cos(lat2*Math.PI/180)
        const x = Math.cos(lat1*Math.PI/180)*Math.sin(lat2*Math.PI/180) - Math.sin(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.cos(dLon)
        setRouteBearing(((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360)
      }
    })
    // Cruise altitude — saved alongside route
    get('settings', 'route').then(r => {
      if (r?.cruiseAlt) setCruiseAlt(String(r.cruiseAlt))
    })

  }, [open])

  // Always-on listener — reacts to aircraft preset changes from the takeoff/landing card
  useEffect(() => {
    const onPresetChange = e => {
      const { label, tas, fuelBurn, fuelUsable } = e.detail
      if (tas)        setTas(tas)
      if (fuelBurn)   setBurnRate(fuelBurn)
      if (fuelUsable) setFuelOnBoard(fuelUsable)
      if (label)      setAircraftLabel(label)
    }
    window.addEventListener('aircraft-preset-changed', onPresetChange)
    return () => window.removeEventListener('aircraft-preset-changed', onPresetChange)
  }, [])

  const [windError, setWindError] = useState(null)
  const [aircraftLabel, setAircraftLabel] = useState('')

  // Fetch winds aloft when altitude is set
  useEffect(() => {
    const alt = parseFloat(cruiseAlt)
    if (!open || isNaN(alt) || alt < 1000) return
    setWinding(true)
    setWindError(null)
    setWindsAloft(null)

    // AWC windtemp returns plain text — parse the FAA winds aloft format
    // e.g. "MIA 1105 0305+16 3505+11 9900+06 3607-07 3506-18 301633 291844 332153"
    // Columns correspond to: 3000 6000 9000 12000 18000 24000 30000 34000 39000
    const ALL_LEVELS = [3000, 6000, 9000, 12000, 18000, 24000, 30000, 34000, 39000]
    const closest = ALL_LEVELS.reduce((a, b) => Math.abs(b - alt) < Math.abs(a - alt) ? b : a)
    const colIdx  = ALL_LEVELS.indexOf(closest) // 0-based column after station name

    const parseToken = (token, lvl) => {
      if (!token || token.trim() === '') return null
      token = token.trim()
      // Tokens: "DDSS", "DDSS+TT", "DDSS-TT", "9900", "9900+TT", "////+TT", "------"
      if (token.startsWith('/') || token.startsWith('-') || token.length < 4) return null
      const dirCode = parseInt(token.substring(0, 2))
      let spd = parseInt(token.substring(2, 4))
      let dir = dirCode * 10
      // Speed ≥100kt: dir encoded as dir/10 + 50
      if (dirCode > 36 && dirCode <= 86) { dir = (dirCode - 50) * 10; spd += 100 }
      if (dirCode === 99) { dir = 0; spd = 0 } // light & variable
      if (isNaN(dir) || isNaN(spd)) return null
      const tempMatch = token.match(/([+-]\d+)$/)
      const temp = tempMatch ? parseInt(tempMatch[1]) : null
      return { dir, spd, temp, level: lvl }
    }

    const parseText = (text) => {
      const lines = text.split('\n')
      // Find the FT header line to confirm column order
      const ftLine = lines.find(l => l.match(/^\s*FT\s+3000/))
      // Extract column positions from FT line if available
      let colStarts = null
      if (ftLine) {
        const matches = [...ftLine.matchAll(/\b(\d{4,5})\b/g)]
        colStarts = matches.map(m => ({ lvl: parseInt(m[1]), idx: m.index }))
      }

      // Station ID to look for (strip ICAO prefix K/C)
      const stationId = depIcao.replace(/^[KC]/, '').toUpperCase()

      // Score lines: prefer match to dep airport, fall back to any valid line
      let bestLine = null
      let fallbackLine = null
      for (const line of lines) {
        const m = line.match(/^([A-Z]{3})\s+(.+)/)
        if (!m) continue
        if (m[1] === stationId) { bestLine = line; break }
        if (!fallbackLine) fallbackLine = line
      }
      const dataLine = bestLine || fallbackLine
      if (!dataLine) return null

      const parts = dataLine.trim().split(/\s+/)
      // parts[0] = station, parts[1..] = wind values
      // 3000ft has no temp so only 4 chars; others 7-8 chars
      // Map by column index
      if (colStarts) {
        // Use column positions for precise mapping
        for (const { lvl, idx } of colStarts) {
          if (Math.abs(lvl - alt) <= Math.abs(closest - alt) + 1500) {
            const token = dataLine.substring(idx, idx + 9).trim().split(/\s/)[0]
            const parsed = parseToken(token, lvl)
            if (parsed) return parsed
          }
        }
      }
      // Fallback: positional — parts[1] = 3000, parts[2] = 6000, etc.
      const tryIndices = [colIdx + 1, colIdx, colIdx + 2].filter(i => i >= 1 && i < parts.length)
      for (const i of tryIndices) {
        const parsed = parseToken(parts[i], ALL_LEVELS[i - 1] || closest)
        if (parsed) return parsed
      }
      return null
    }

    ;(async () => {
      let text = null
      for (const fcst of ['06', '12', '24']) {
        const url = `${AWC}/windtemp?region=us&fcst=${fcst}`
        try {
          const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
          if (res.ok) { text = await res.text(); break }
        } catch { /* ignore */ }
        try { text = await proxyFetch(url, 8000); break } catch { /* ignore */ }
      }

      if (!text || text.length < 50) {
        setWindError('Forecast unavailable')
        setWinding(false)
        return
      }

      const result = parseText(text)
      if (result) {
        setWindsAloft(result)
      } else {
        setWindError('No data for this altitude')
      }
      setWinding(false)
    })()
  }, [open, cruiseAlt, depIcao])

  // ── Calculations ─────────────────────────────────────────────
  const tasN   = parseFloat(tas)
  const burnN  = parseFloat(burnRate)
  const fobN   = parseFloat(fuelOnBoard)
  const distN  = routeDist
  const altN   = parseFloat(cruiseAlt)

  // Wind correction angle & ground speed
  let groundSpeed = tasN
  let hwComponent = 0
  if (windsAloft && routeBearing != null && !isNaN(tasN)) {
    hwComponent = Math.round(windsAloft.spd * Math.cos((windsAloft.dir - routeBearing) * Math.PI / 180))
    groundSpeed = Math.max(1, tasN - hwComponent)
  }

  const flightTimeH  = (distN && groundSpeed > 0) ? distN / groundSpeed : null
  const flightTimeMin = flightTimeH ? Math.round(flightTimeH * 60) : null
  const fuelRequired  = (flightTimeH && !isNaN(burnN)) ? flightTimeH * burnN : null
  const enduranceH    = (!isNaN(fobN) && !isNaN(burnN) && burnN > 0) ? fobN / burnN : null
  const reserveH      = (enduranceH != null && flightTimeH != null) ? enduranceH - flightTimeH : null
  const reserveMin    = reserveH != null ? Math.round(reserveH * 60) : null
  const reqReserveMin = flightRules === 'IFR' ? 45 : 30
  const goNoGo        = reserveMin != null ? reserveMin >= reqReserveMin : null

  const fmtTime = (h) => {
    if (h == null || isNaN(h)) return '—'
    const hh = Math.floor(Math.abs(h)), mm = Math.round((Math.abs(h) % 1) * 60)
    return `${hh}h ${mm.toString().padStart(2,'0')}m`
  }

  const hasBasics = !isNaN(tasN) && !isNaN(burnN)
  const hasAll    = hasBasics && !isNaN(fobN) && distN

  // Fuel bar segments (0–1)
  const tripFrac    = (fuelRequired != null && !isNaN(fobN) && fobN > 0) ? Math.min(fuelRequired / fobN, 1) : 0
  const reqResFrac  = (!isNaN(burnN) && !isNaN(fobN) && fobN > 0) ? Math.min((reqReserveMin/60*burnN) / fobN, 1 - tripFrac) : 0
  const extraFrac   = Math.max(0, 1 - tripFrac - reqResFrac)
  const reserveFuelGal = (reqReserveMin / 60) * burnN

  // Persist fuel state for AircraftItem to read
  if (!isNaN(fobN) && fobN > 0) {
    localStorage.setItem('cruise_fuel_state', JSON.stringify({
      fobN, tripFrac, reqResFrac, extraFrac,
      fuelRequired: fuelRequired ?? null,
      reserveFuelGal: !isNaN(reserveFuelGal) ? reserveFuelGal : null,
      extraGal: !isNaN(fobN) && fuelRequired != null ? Math.max(0, fobN - (fuelRequired ?? 0) - reserveFuelGal) : null,
    }))
  }

  return (
    <ExpandableCard item={item} isChecked={isChecked} onToggle={onToggle} open={open} setOpen={setOpen}>
      <div style={{ padding: '14px 14px 0' }}>

        {/* ── Route summary ── */}
        {(depIcao || destIcao || distN) && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: 14, paddingBottom: 14, borderBottom: '0.5px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 20, fontWeight: 800, fontFamily: 'monospace', color: 'var(--text)' }}>
                {depIcao || '—'}
              </span>
              <div style={{ width: 32, height: 1, background: 'var(--border-strong)' }} />
              <span style={{ fontSize: 20, fontWeight: 800, fontFamily: 'monospace', color: 'var(--text)' }}>
                {destIcao || '—'}
              </span>
            </div>
            {distN && (
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 9, color: 'var(--text-tertiary)', fontWeight: 700,
                  letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: 2 }}>Distance</div>
                <div style={{ fontSize: 16, fontWeight: 800, fontFamily: 'monospace', color: 'var(--text)' }}>
                  {distN} nm
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Cruise altitude + flight rules ── */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <FieldTip label="Cruise Altitude" tip="Your planned cruise altitude. Used to fetch winds aloft from the FAA forecast." style={{ flex: 2 }}>
            <div style={{ display: 'flex', alignItems: 'center', background: 'var(--bg-card-2)',
              borderRadius: 8, padding: '8px 10px', gap: 4 }}>
              <input type="number" value={cruiseAlt} onChange={e => setCruiseAlt(e.target.value)}
                placeholder="e.g. 6500" style={{ flex: 1, background: 'none', border: 'none',
                  outline: 'none', fontSize: 15, fontWeight: 700, color: 'var(--text)',
                  fontFamily: 'monospace', width: 0, minWidth: 0 }} />
              <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>ft</span>
            </div>
          </FieldTip>
          <FieldTip label="Flight Rules" tip="VFR requires 30 min fuel reserve. IFR requires 45 min. This sets your minimum reserve check." style={{ flex: 1 }}>
            <div style={{ display: 'flex', background: 'var(--bg-card-2)', borderRadius: 8, padding: 3 }}>
              {['VFR','IFR'].map(r => (
                <button key={r} onClick={() => setFlightRules(r)} style={{
                  flex: 1, padding: '6px 0', borderRadius: 6, border: 'none', cursor: 'pointer',
                  fontSize: 11, fontWeight: 700, background: flightRules === r ? 'var(--bg-card)' : 'transparent',
                  color: flightRules === r ? 'var(--text)' : 'var(--text-tertiary)', transition: 'all 0.15s',
                }}>{r}</button>
              ))}
            </div>
          </FieldTip>
        </div>

        {/* ── Winds aloft ── */}
        <div style={{ background: 'var(--bg-card-2)', borderRadius: 10, overflow: 'hidden', marginBottom: 12 }}>
          {/* Header */}
          <div style={{ padding: '8px 12px 6px', borderBottom: '0.5px solid var(--border)' }}>
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.6px',
              textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>
              Winds Aloft{windsAloft ? ` · ${windsAloft.level.toLocaleString()} ft` : ''}
            </span>
          </div>

          {winding && (
            <div style={{ padding: '10px 12px', fontSize: 11, color: 'var(--text-tertiary)' }}>Fetching forecast…</div>
          )}
          {!winding && windError && (
            <div style={{ padding: '10px 12px', fontSize: 11, color: 'var(--danger)' }}>{windError}</div>
          )}
          {!winding && !windsAloft && !windError && (
            <div style={{ padding: '10px 12px', fontSize: 11, color: 'var(--text-tertiary)' }}>Enter cruise altitude to fetch</div>
          )}

          {!winding && windsAloft && (
            <>
              {/* Data row */}
              <div style={{ display: 'flex', borderBottom: routeBearing != null ? '0.5px solid var(--border)' : 'none' }}>
                {windsAloft.dir === 0 && windsAloft.spd === 0
                  ? <div style={{ flex: 1, padding: '10px 12px', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>Light &amp; variable</div>
                  : <>
                      <div style={{ flex: 1, padding: '10px 12px', borderRight: '0.5px solid var(--border)' }}>
                        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 4 }}>Direction</div>
                        <div style={{ fontSize: 18, fontWeight: 800, fontFamily: 'monospace', color: 'var(--text)', letterSpacing: '-0.5px' }}>{windsAloft.dir}°</div>
                      </div>
                      <div style={{ flex: 1, padding: '10px 12px', borderRight: '0.5px solid var(--border)' }}>
                        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 4 }}>Speed</div>
                        <div style={{ fontSize: 18, fontWeight: 800, fontFamily: 'monospace', color: 'var(--text)', letterSpacing: '-0.5px' }}>{windsAloft.spd}<span style={{ fontSize: 11, fontWeight: 600, marginLeft: 2 }}>kt</span></div>
                      </div>
                      <div style={{ flex: 1, padding: '10px 12px' }}>
                        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 4 }}>Temp</div>
                        <div style={{ fontSize: 18, fontWeight: 800, fontFamily: 'monospace', color: 'var(--text)', letterSpacing: '-0.5px' }}>
                          {windsAloft.temp != null ? `${windsAloft.temp > 0 ? '+' : ''}${windsAloft.temp}°C` : '—'}
                        </div>
                      </div>
                    </>
                }
              </div>

              {/* Route component */}
              {routeBearing != null && (
                <div style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>On Route</span>
                  <span style={{ fontSize: 15, fontWeight: 800, fontFamily: 'monospace',
                    color: hwComponent >= 0 ? 'var(--text)' : 'var(--ok)' }}>
                    {hwComponent >= 0 ? '+' : ''}{hwComponent}kt {hwComponent >= 0 ? 'HW' : 'TW'}
                  </span>
                </div>
              )}
            </>
          )}
        </div>

        {/* ── POH inputs ── */}
        {aircraftLabel && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0 }} />
            <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
              Auto-filled from <span style={{ fontWeight: 700, color: 'var(--text-secondary)' }}>{aircraftLabel}</span> — edit to override
            </span>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <FieldTip label="Cruise TAS" tip="True Airspeed from your POH at your planned power setting and altitude. Usually found in the cruise performance table.">
            <div style={{ display: 'flex', alignItems: 'center', background: 'var(--bg-card-2)',
              borderRadius: 8, padding: '8px 10px', gap: 4 }}>
              <input type="number" value={tas} onChange={e => setTas(e.target.value)}
                placeholder="—" style={{ flex: 1, background: 'none', border: 'none', outline: 'none',
                  fontSize: 15, fontWeight: 700, color: 'var(--text)', fontFamily: 'monospace',
                  width: 0, minWidth: 0 }} />
              <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>kt</span>
            </div>
          </FieldTip>
          <FieldTip label="Fuel Burn" tip="How many gallons per hour your engine burns at cruise. From POH cruise performance table at your power setting.">
            <div style={{ display: 'flex', alignItems: 'center', background: 'var(--bg-card-2)',
              borderRadius: 8, padding: '8px 10px', gap: 4 }}>
              <input type="number" value={burnRate} onChange={e => setBurnRate(e.target.value)}
                placeholder="—" style={{ flex: 1, background: 'none', border: 'none', outline: 'none',
                  fontSize: 15, fontWeight: 700, color: 'var(--text)', fontFamily: 'monospace',
                  width: 0, minWidth: 0 }} />
              <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>GPH</span>
            </div>
          </FieldTip>
          <FieldTip label="Fuel on Board" tip="Usable fuel you're departing with. Do not include unusable fuel — check your POH for usable fuel capacity.">
            <div style={{ display: 'flex', alignItems: 'center', background: 'var(--bg-card-2)',
              borderRadius: 8, padding: '8px 10px', gap: 4 }}>
              <input type="number" value={fuelOnBoard} onChange={e => setFuelOnBoard(e.target.value)}
                placeholder="—" style={{ flex: 1, background: 'none', border: 'none', outline: 'none',
                  fontSize: 15, fontWeight: 700, color: 'var(--text)', fontFamily: 'monospace',
                  width: 0, minWidth: 0 }} />
              <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>gal</span>
            </div>
          </FieldTip>
        </div>

        {/* ── Results ── */}
        {hasBasics && distN && (() => {
          // Reserve fuel in gallons
          const reserveFuel     = (reqReserveMin / 60) * burnN
          // Usable fuel per leg (full tank minus reserve)
          const usablePerLeg    = Math.max(0, fobN - reserveFuel)
          // Max range per full tank with reserve
          const rangePerLeg     = (usablePerLeg / burnN) * groundSpeed  // nm
          // Is this a multi-leg trip?
          const needsStops      = hasAll && fuelRequired != null && fuelRequired > fobN && rangePerLeg > 0
          // Number of legs needed (ceil)
          const numLegs         = needsStops ? Math.ceil(distN / rangePerLeg) : 1
          const numStops        = numLegs - 1
          // Suggested equal leg distance
          const legDist         = needsStops ? Math.round(distN / numLegs) : null
          // Leg flight time
          const legTimeH        = needsStops ? legDist / groundSpeed : null
          // Fuel per leg
          const fuelPerLeg      = needsStops ? (legTimeH * burnN) : null
          // Total trip time (legs only, no ground time)
          const totalFlightH    = needsStops ? numLegs * legTimeH : flightTimeH

          return (<>
            {/* ── Top stats row: GS · Flight Time (or Total Time) ── */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
              <div style={{ flex: 1, background: 'var(--bg-card-2)', borderRadius: 10, padding: '10px 12px' }}>
                <div style={{ fontSize: 9, color: 'var(--text-tertiary)', fontWeight: 700,
                  letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: 4 }}>Ground Speed</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                  <span style={{ fontSize: 24, fontWeight: 900, fontFamily: 'monospace', color: 'var(--text)' }}>
                    {Math.round(groundSpeed)}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>kt</span>
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2 }}>
                  TAS {Math.round(tasN)}kt{hwComponent !== 0 ? ` · ${hwComponent > 0 ? '−' : '+'}${Math.abs(hwComponent)}kt wind` : ''}
                </div>
              </div>
              <div style={{ flex: 1, background: 'var(--bg-card-2)', borderRadius: 10, padding: '10px 12px' }}>
                <div style={{ fontSize: 9, color: 'var(--text-tertiary)', fontWeight: 700,
                  letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: 4 }}>
                  {needsStops ? 'Total Flight Time' : 'Flight Time'}
                </div>
                <div style={{ fontSize: 24, fontWeight: 900, fontFamily: 'monospace', color: 'var(--text)' }}>
                  {fmtTime(totalFlightH)}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2 }}>
                  {needsStops ? `${numLegs} legs · excl. ground time` : `${distN} nm at ${Math.round(groundSpeed)}kt`}
                </div>
              </div>
            </div>

            {/* ── SINGLE-LEG: Fuel Required + Endurance + GO/NO-GO ── */}
            {!needsStops && hasAll && (() => {
              const extraGal = Math.max(0, fobN - (fuelRequired ?? 0) - reserveFuel)
              return (<>
                <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                  <div style={{ flex: 1, background: 'var(--bg-card-2)', borderRadius: 10, padding: '10px 12px' }}>
                    <div style={{ fontSize: 9, color: 'var(--text-tertiary)', fontWeight: 700,
                      letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: 4 }}>Fuel Required</div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                      <span style={{ fontSize: 24, fontWeight: 900, fontFamily: 'monospace', color: 'var(--text)' }}>
                        {fuelRequired?.toFixed(1)}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>gal</span>
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2 }}>
                      {burnN} GPH × {fmtTime(flightTimeH)}
                    </div>
                  </div>
                  <div style={{ flex: 1, background: 'var(--bg-card-2)', borderRadius: 10, padding: '10px 12px' }}>
                    <div style={{ fontSize: 9, color: 'var(--text-tertiary)', fontWeight: 700,
                      letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: 4 }}>Endurance</div>
                    <div style={{ fontSize: 24, fontWeight: 900, fontFamily: 'monospace', color: 'var(--text)' }}>
                      {fmtTime(enduranceH)}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2 }}>
                      {fuelOnBoard} gal ÷ {burnN} GPH
                    </div>
                  </div>
                </div>


                {/* GO / NO-GO */}
                <div style={{ borderRadius: 12, padding: '12px 14px', marginBottom: 14,
                  background: 'var(--bg-card-2)', border: '0.5px solid var(--border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontSize: 9, color: 'var(--text-tertiary)', fontWeight: 700,
                        letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: 4 }}>
                        Reserve after landing
                      </div>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                        <span style={{ fontSize: 32, fontWeight: 900, fontFamily: 'monospace',
                          color: 'var(--text)', letterSpacing: '-0.5px' }}>
                          {reserveMin != null ? Math.max(0, reserveMin) : '—'}
                        </span>
                        <span style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>min</span>
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2 }}>
                        {flightRules} minimum: {reqReserveMin} min
                      </div>
                    </div>
                    <div style={{ padding: '8px 18px', borderRadius: 20,
                      background: goNoGo ? 'var(--ok)' : 'var(--danger)',
                      color: '#fff', fontSize: 13, fontWeight: 800, letterSpacing: '0.5px' }}>
                      {goNoGo ? 'GO' : 'NO GO'}
                    </div>
                  </div>
                </div>

              </>)
            })()}

            {/* ── MULTI-LEG: Fuel stops plan ── */}
            {needsStops && (() => {
              const legRangeNm = Math.round((usablePerLeg / burnN) * groundSpeed)
              return (
                <div style={{ borderRadius: 12, overflow: 'hidden', marginBottom: 14,
                  border: '1px solid var(--border)', background: 'var(--bg-card-2)' }}>

                  {/* Header */}
                  <div style={{ padding: '11px 14px 10px',
                    borderBottom: '0.5px solid var(--border)',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                        stroke="var(--text-secondary)" strokeWidth="2.5"
                        strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 12h18M3 6l9-3 9 3M3 18l9 3 9-3"/>
                      </svg>
                      <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-secondary)',
                        letterSpacing: '0.5px', textTransform: 'uppercase' }}>
                        Fuel Stops Required
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                      <span style={{ fontSize: 22, fontWeight: 900, fontFamily: 'monospace',
                        color: 'var(--text)' }}>{numStops}</span>
                      <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
                        {numStops === 1 ? 'stop' : 'stops'}
                      </span>
                    </div>
                  </div>

                  {/* Stats row */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
                    borderBottom: '0.5px solid var(--border)' }}>
                    {[
                      { label: 'Range / tank',  val: `${legRangeNm}`,  unit: 'nm',  sub: `with ${reqReserveMin}min reserve` },
                      { label: 'Leg distance',   val: `${legDist}`,     unit: 'nm',  sub: `${numLegs} equal legs` },
                      { label: 'Fuel / leg',     val: fuelPerLeg?.toFixed(1), unit: 'gal', sub: fmtTime(legTimeH) },
                    ].map(({ label, val, unit, sub }, idx, arr) => (
                      <div key={label} style={{
                        padding: '10px 0 10px',
                        textAlign: 'center',
                        borderRight: idx < arr.length - 1 ? '0.5px solid var(--border)' : 'none',
                      }}>
                        <div style={{ fontSize: 9, color: 'var(--text-tertiary)', fontWeight: 700,
                          letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
                        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 3 }}>
                          <span style={{ fontSize: 18, fontWeight: 800, fontFamily: 'monospace',
                            color: 'var(--text)' }}>{val}</span>
                          <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{unit}</span>
                        </div>
                        <div style={{ fontSize: 9, color: 'var(--text-tertiary)', marginTop: 3 }}>{sub}</div>
                      </div>
                    ))}
                  </div>

                  {/* Leg timeline */}
                  <div style={{ padding: '12px 14px 10px' }}>
                    <div style={{ fontSize: 9, color: 'var(--text-tertiary)', fontWeight: 700,
                      letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: 10 }}>Trip breakdown</div>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 0 }}>
                      {Array.from({ length: numLegs }).map((_, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0 }}>
                          {/* Node */}
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                            <div style={{
                              width: 8, height: 8, borderRadius: '50%',
                              background: i === 0 ? 'var(--text)' : 'var(--text-tertiary)',
                              border: '1.5px solid ' + (i === 0 ? 'var(--text)' : 'var(--border)'),
                            }} />
                            <div style={{ fontSize: 8, color: 'var(--text-tertiary)', marginTop: 4,
                              whiteSpace: 'nowrap', letterSpacing: '0.3px' }}>
                              {i === 0 ? (depIcao || 'DEP') : `Stop ${i}`}
                            </div>
                          </div>
                          {/* Connector */}
                          <div style={{ flex: 1, display: 'flex', flexDirection: 'column',
                            alignItems: 'center', margin: '0 3px', marginTop: -10 }}>
                            <div style={{ fontSize: 8, color: 'var(--text-tertiary)', marginBottom: 3 }}>
                              {legDist} nm
                            </div>
                            <div style={{ width: '100%', height: 1,
                              backgroundImage: 'repeating-linear-gradient(90deg, var(--text-tertiary) 0, var(--text-tertiary) 4px, transparent 4px, transparent 8px)',
                              opacity: 0.4 }} />
                          </div>
                        </div>
                      ))}
                      {/* Destination node */}
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%',
                          background: 'var(--ok)', border: '1.5px solid var(--ok)' }} />
                        <div style={{ fontSize: 8, color: 'var(--text-tertiary)', marginTop: 4,
                          letterSpacing: '0.3px' }}>{destIcao || 'DEST'}</div>
                      </div>
                    </div>
                  </div>

                  {/* Footer note */}
                  <div style={{ padding: '0 14px 11px' }}>
                    <div style={{ fontSize: 9, color: 'var(--text-tertiary)', lineHeight: 1.6,
                      borderTop: '0.5px solid var(--border)', paddingTop: 9 }}>
                      Equal-split estimates only. Verify fuel availability at each stop before flight.
                    </div>
                  </div>
                </div>
              )
            })()}

            {/* Show prompt when basics entered but no FOB yet */}
            {hasBasics && !hasAll && (
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textAlign: 'center',
                padding: '4px 0 12px' }}>
                Enter fuel on board to complete
              </div>
            )}
          </>)
        })()}

        {!hasBasics && (
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textAlign: 'center',
            padding: '8px 0 12px' }}>
            Enter TAS and fuel burn to calculate
          </div>
        )}
      </div>

      {!hasAll && !isChecked && (
        <div style={{ borderTop: '0.5px solid var(--border)', padding: '10px 14px 12px' }}>
          <div style={{ width: '100%', padding: '11px 0', borderRadius: 10,
            background: 'var(--bg-card-2)', border: '0.5px solid var(--border)',
            color: 'var(--text-tertiary)', fontSize: 13, fontWeight: 600, textAlign: 'center' }}>
            Fill all fields to complete
          </div>
        </div>
      )}
      {(hasAll || isChecked) && (
        <DoneButton isChecked={isChecked} onDone={() => { onToggle(item.id); setOpen(false) }} />
      )}
    </ExpandableCard>
  )
}

/* ── METAR expandable item ───────────────────────────────────── */
function MetarItem({ item, isChecked, onToggle }) {
  const [open, setOpen]         = useState(false)
  const [dep, setDep]           = useState('')
  const [dest, setDest]         = useState('')
  const [depData, setDepData]   = useState(null)
  const [destData, setDestData] = useState(null)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState(null)
  const FIELDS = [
    ['Wind', 'wind'], ['Variable', 'windVar'], ['Visibility', 'vis'],
    ['Weather', 'wx'], ['Clouds', 'clouds'], ['Temp', 'temp'],
    ['Dew point', 'dew'], ['QNH', 'qnh'], ['Trend', 'trend'],
  ]

  const fetchMetar = async icao => {
    if (!icao) return null
    try {
      const data = await proxyJSON(`${AWC}/metar?ids=${icao}&format=json&hours=3`)
      const raw  = Array.isArray(data) && data.length ? data[0].rawOb || data[0].rawob || '' : ''
      return raw ? { raw, decoded: parseMetar(raw) } : null
    } catch { return null }
  }

  async function doFetch(d, x) {
    if (!d && !x) return
    setLoading(true); setError(null)
    const [dRes, xRes] = await Promise.all([fetchMetar(d), fetchMetar(x)])
    setDepData(dRes); setDestData(xRes)
    if (!dRes && !xRes) setError('METAR unavailable — check aviationweather.gov')
    setLoading(false)
  }

  // Fetch when card opens — always reads current saved route
  useEffect(() => {
    if (!open) return
    get('settings', 'route').then(r => {
      const d = (r?.dep  || '').toUpperCase().trim()
      const x = (r?.dest || '').toUpperCase().trim()
      setDep(d); setDest(x)
      doFetch(d, x)
    })
  }, [open])

  const MetarCard = ({ label, icao, data, isLoading }) => (
    <div style={{
      margin: '10px 12px 0',
      background: 'var(--bg-card-2)',
      border: '0.5px solid var(--border)',
      borderRadius: 14,
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{ padding: '10px 12px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '0.5px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.5px',
            textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>{label}</span>
          {icao && <span style={{ fontSize: 14, fontWeight: 800, fontFamily: 'monospace',
            color: 'var(--text)', letterSpacing: '1px' }}>{icao}</span>}
        </div>
        {data?.decoded?.time && (
          <span style={{ fontSize: 10, color: 'var(--text-tertiary)',
            background: 'var(--bg)', border: '0.5px solid var(--border)',
            borderRadius: 20, padding: '2px 8px' }}>{data.decoded.time}</span>
        )}
        {isLoading && !data && (
          <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>Fetching…</span>
        )}
      </div>

      {/* Raw string */}
      {data?.raw && (
        <div style={{ padding: '8px 12px 4px' }}>
          <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-secondary)',
            background: 'var(--bg)', borderRadius: 8, padding: '8px 10px',
            lineHeight: 1.5, letterSpacing: '0.2px', wordBreak: 'break-all' }}>
            {data.raw}
          </div>
        </div>
      )}

      {/* Decoded fields */}
      {data?.decoded && (
        <div style={{ padding: '4px 12px 10px' }}>
          {FIELDS.filter(([, key]) => data.decoded[key]).map(([lbl, key], i, arr) => (
            <div key={key} style={{
              display: 'flex', alignItems: 'baseline', gap: 10, padding: '6px 0',
              borderBottom: i < arr.length - 1 ? '0.5px solid var(--border)' : 'none',
            }}>
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)', width: 68, flexShrink: 0 }}>{lbl}</span>
              <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', flex: 1, lineHeight: 1.4 }}>
                {data.decoded[key]}
              </span>
            </div>
          ))}
        </div>
      )}

      {!data && !isLoading && icao && (
        <div style={{ padding: '10px 12px 12px', fontSize: 11, color: 'var(--text-tertiary)' }}>
          No METAR available for {icao}
        </div>
      )}
    </div>
  )

  return (
    <ExpandableCard item={item} isChecked={isChecked} onToggle={onToggle} open={open} setOpen={setOpen}>

      {/* No route set */}
      {!dep && !dest && !loading && (
        <div style={{ padding: '14px 14px 12px', borderTop: '0.5px solid var(--border)',
          fontSize: 11, color: 'var(--text-tertiary)' }}>
          Set a departure and destination in Route and Altitude to auto-load METARs.
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div style={{ padding: '10px 14px', borderTop: '0.5px solid var(--border)',
          fontSize: 11, color: 'var(--danger)' }}>{error}</div>
      )}

      {/* Departure METAR */}
      {(dep || depData) && (
        <MetarCard label="Departure" icao={dep} data={depData} isLoading={loading} />
      )}

      {/* Destination METAR */}
      {(dest || destData) && (
        <MetarCard label="Destination" icao={dest} data={destData} isLoading={loading} />
      )}

      {/* Reference links */}
      <div style={{ borderTop: '0.5px solid var(--border)', padding: '10px 14px 10px', marginTop: 10 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <a href="https://aviationweather.gov" target="_blank" rel="noreferrer" style={{
            flex: 1, textAlign: 'center', padding: '8px 0',
            borderRadius: 9, border: '0.5px solid var(--border)',
            background: 'var(--bg-card-2)', textDecoration: 'none',
            fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)',
          }}>aviationweather.gov</a>
          <button onClick={() => { setDepData(null); setDestData(null); doFetch(dep, dest) }} style={{
            flex: 1, textAlign: 'center', padding: '8px 0',
            borderRadius: 9, border: '0.5px solid var(--border)',
            background: 'var(--bg-card-2)',
            fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)',
            cursor: 'pointer',
          }}>Refresh</button>
        </div>
      </div>

      <DoneButton isChecked={isChecked} onDone={() => { onToggle(item.id); setOpen(false) }} />
    </ExpandableCard>
  )
}

/* ── Route math helpers ──────────────────────────────────────── */
function bearingDeg(lat1, lon1, lat2, lon2) {
  const φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180
  const Δλ = (lon2 - lon1) * Math.PI / 180
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360
}
function haversineNm(lat1, lon1, lat2, lon2) {
  const R = 3440.065
  const φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180
  const Δφ = (lat2 - lat1) * Math.PI / 180, Δλ = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(Δφ/2)**2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2)**2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
}

/* ── Altitude + Route calculator ─────────────────────────────── */
function AltitudeItem({ item, isChecked, onToggle }) {
  const [open, setOpen]           = useState(false)
  const [course, setCourse]       = useState('')
  const [selectedAlt, setSelectedAlt] = useState(null)

  // Route inputs
  const [dep, setDep]              = useState('')
  const [depValidated, setDepVal]  = useState(false)
  const [depChecking, setDepChk]   = useState(false)
  const [depError, setDepErr]      = useState(null)
  const [dest, setDest]            = useState('')
  const [destValidated, setDestVal] = useState(false)
  const [destChecking, setDestChk]  = useState(false)
  const [destError, setDestErr]     = useState(null)
  const [routeLoading, setRL]     = useState(false)
  const [route, setRoute]         = useState(null)
  const [routeError, setRE]       = useState(null)

  // Map layers
  const [layers, setLayers]         = useState({ sectional: false, airspace: false, tfr: false })
  const [mapFullscreen, setMapFS]   = useState(false)
  const [showRefs, setShowRefs]     = useState(false)
  const [activeChip, setActiveChip] = useState(null) // id of chip whose popup is open

  // Restore saved route on mount; fall back to homeAirport for the FROM field
  useEffect(() => {
    get('settings', 'route').then(r => {
      if (r?.depPos && r?.destPos) {
        if (r.dep) { setDep(r.dep); setDepVal(true) }
        if (r.dest) { setDest(r.dest); setDestVal(true) }
        setRoute(r)
        if (r.mc != null) setCourse(String(r.mc))
        if (r.cruiseAlt != null) setSelectedAlt(r.cruiseAlt)
        if (!r.dep) get('settings', 'homeAirport').then(h => { if (h?.value) { setDep(h.value); setDepVal(true) } })
      } else {
        get('settings', 'homeAirport').then(h => { if (h?.value) { setDep(h.value); setDepVal(true) } })
      }
    })
  }, [])

  async function validateDep() {
    const id = dep.trim().toUpperCase()
    if (id.length < 3) return
    setDepChk(true); setDepErr(null)
    const result = await fetchAWC(id)
    setDepChk(false)
    if (result) { setDep(id); setDepVal(true) }
    else setDepErr('Airport not found')
  }

  async function validateDest() {
    const id = dest.trim().toUpperCase()
    if (id.length < 3) return
    setDestChk(true); setDestErr(null)
    const result = await fetchAWC(id)
    setDestChk(false)
    if (result) { setDest(id); setDestVal(true) }
    else setDestErr('Airport not found')
  }

  // Editable waypoints — dep + optional intermediates + dest
  const [waypoints, setWaypoints] = useState([])
  useEffect(() => {
    if (route?.depPos && route?.destPos) {
      setWaypoints([
        { id: 'dep',  lat: route.depPos[0],  lon: route.depPos[1],  name: dep },
        { id: 'dest', lat: route.destPos[0], lon: route.destPos[1], name: dest },
      ])
    }
  }, [route?.depPos?.[0], route?.depPos?.[1], route?.destPos?.[0], route?.destPos?.[1]])

  function insertWaypoint(index, lat, lon) {
    setWaypoints(prev => {
      const next = [...prev]
      next.splice(index, 0, { id: `wp-${Date.now()}`, lat, lon, name: null })
      return next
    })
  }
  function moveWaypoint(index, latlng) {
    setWaypoints(prev => prev.map((w, i) => i === index ? { ...w, lat: latlng.lat, lon: latlng.lng } : w))
  }
  function removeWaypoint(index) {
    setWaypoints(prev => prev.filter((_, i) => i !== index))
  }

  // Route string for display — dep / intermediates in aviation coords / dest
  const routeString = useMemo(() => {
    if (waypoints.length < 2) return null
    return waypoints.map((w, i) => {
      if (i === 0 || i === waypoints.length - 1) return w.name || fmtAvCoord(w.lat, w.lon)
      return fmtAvCoord(w.lat, w.lon)
    }).join(' / ')
  }, [waypoints])

  // Real terrain detection via OpenTopoData elevation + FAA airport corridor check
  const [detectedTerrain, setDetectedTerrain] = useState([])
  const [detectedParkNames, setDetectedParkNames] = useState([])
  const [detectedSUANames, setDetectedSUANames]   = useState([])
  const [detectedSUAPolys, setDetectedSUAPolys]   = useState([]) // [{name, typeCode, poly:[lat,lon][]}]
  useEffect(() => {
    if (waypoints.length < 2) { setDetectedTerrain([]); return }
    let cancelled = false

    async function detect() {
      // Sample 15 points evenly along all segments
      const segs = waypoints.length - 1
      const ptsPerSeg = Math.ceil(15 / segs)
      const pts = []
      for (let s = 0; s < segs; s++) {
        const a = waypoints[s], b = waypoints[s + 1]
        for (let i = 0; i < ptsPerSeg; i++) {
          const t = i / ptsPerSeg
          pts.push([a.lat + (b.lat - a.lat) * t, a.lon + (b.lon - a.lon) * t])
        }
      }
      pts.push([waypoints[waypoints.length-1].lat, waypoints[waypoints.length-1].lon])

      // Open-Elevation API (SRTM data, free, CORS-enabled)
      let elevations = []
      try {
        const locations = pts.map(([la, lo]) => ({ latitude: parseFloat(la.toFixed(4)), longitude: parseFloat(lo.toFixed(4)) }))
        const res = await fetch('https://api.open-elevation.com/api/v1/lookup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({ locations }),
          signal: AbortSignal.timeout(8000),
        })
        if (res.ok) {
          const d = await res.json()
          elevations = (d.results || []).map(r => r.elevation ?? 0)
        }
      } catch { /* ignore */ }

      if (cancelled) return

      const det = []
      const ftElev = elevations.map(e => e * 3.28084) // metres → feet

      // Water: elevation at/near sea level (≤ 5m) — crude but catches ocean/coastal routes
      const hasWater = ftElev.some(e => e <= 15) || pts.some(([la, lo]) =>
        (la < 24.5 && la > 8 && lo > -90 && lo < -58)   // Caribbean
        || (lo < -130 && la < 55)                         // Pacific
        || (la < 30 && la > 17 && lo > -98 && lo < -80)  // Gulf of Mexico
      )
      // Mountains: any point above 5000 ft terrain, or pilot selected high altitude
      const hasMountains = ftElev.some(e => e > 5000) || (selectedAlt && selectedAlt > 9500)
      // High terrain: above 8000 ft
      const hasHighTerrain = ftElev.some(e => e > 8000)

      if (hasWater) det.push('water')
      if (hasMountains) det.push('mountains')

      // Aerodromes: query FAA ArcGIS for airports within route bounding box, then filter by corridor
      // FAA returns lat/lon as DMS strings e.g. "25-48-51.42N" / "080-17-24.42W"
      const parseDMS = str => {
        if (!str) return null
        const m = str.match(/^(\d+)-(\d+)-([\d.]+)([NSEW])$/)
        if (!m) return null
        const dec = +m[1] + +m[2]/60 + +m[3]/3600
        return (m[4] === 'S' || m[4] === 'W') ? -dec : dec
      }
      let hasAero = false
      try {
        const lats = pts.map(p => p[0]), lons = pts.map(p => p[1])
        const pad = 0.3 // ~18 NM buffer on bbox
        const bbox = `${Math.min(...lons)-pad},${Math.min(...lats)-pad},${Math.max(...lons)+pad},${Math.max(...lats)+pad}`
        const url = `https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/US_Airport/FeatureServer/0/query?where=1%3D1&geometry=${encodeURIComponent(bbox)}&geometryType=esriGeometryEnvelope&spatialRel=esriSpatialRelIntersects&outFields=LATITUDE,LONGITUDE&returnGeometry=false&f=json`
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
        if (res.ok) {
          const d = await res.json()
          const airports = (d.features || []).map(f => ({
            lat: parseDMS(f.attributes.LATITUDE),
            lon: parseDMS(f.attributes.LONGITUDE),
          })).filter(a => a.lat !== null && a.lon !== null)
          hasAero = airports.some(ap => {
            for (let s = 0; s < waypoints.length - 1; s++) {
              const dist = crossTrackNM(ap.lat, ap.lon, [waypoints[s].lat, waypoints[s].lon], [waypoints[s+1].lat, waypoints[s+1].lon])
              if (dist < 15) return true
            }
            return false
          })
        }
      } catch { /* ignore */ }

      if (hasAero) det.push('aero')
      if (hasAero) det.push('builtup')
      if (selectedAlt && selectedAlt > 10000) det.push('oxygen')

      // Bounding box for park + SUA queries
      const lats2 = pts.map(p => p[0]), lons2 = pts.map(p => p[1])
      const pad2 = 0.1
      const bbox2 = `${Math.min(...lons2)-pad2},${Math.min(...lats2)-pad2},${Math.max(...lons2)+pad2},${Math.max(...lats2)+pad2}`

      // Esri ring → [lat, lon][] polygon
      const ringToPoly = ring => ring.map(([x, y]) => [y, x])

      // National Parks (NPS ArcGIS)
      const [npsRes, suaRes] = await Promise.allSettled([
        fetch(`https://mapservices.nps.gov/arcgis/rest/services/LandResourcesDivisionTractAndBoundaryService/MapServer/1/query?where=1%3D1&geometry=${encodeURIComponent(bbox2)}&geometryType=esriGeometryEnvelope&spatialRel=esriSpatialRelIntersects&outFields=UNIT_NAME,UNIT_TYPE&returnGeometry=true&f=json`, { signal: AbortSignal.timeout(8000) }),
        fetch(`https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/Special_Use_Airspace/FeatureServer/0/query?where=1%3D1&geometry=${encodeURIComponent(bbox2)}&geometryType=esriGeometryEnvelope&spatialRel=esriSpatialRelIntersects&outFields=NAME,TYPE_CODE&returnGeometry=true&f=json`, { signal: AbortSignal.timeout(8000) }),
      ])

      if (cancelled) return

      // Parks
      const parkNames = []
      if (npsRes.status === 'fulfilled' && npsRes.value.ok) {
        try {
          const d = await npsRes.value.json()
          for (const f of (d.features || [])) {
            const rings = f.geometry?.rings || []
            const hit = rings.some(r => routeIntersectsPoly(waypoints, ringToPoly(r)))
            if (hit) parkNames.push(f.attributes?.UNIT_NAME || 'National Park')
          }
        } catch { /* ignore */ }
      }
      if (parkNames.length) det.push('parks')
      setDetectedParkNames(parkNames)

      // Special Use Airspace
      const suaNames = []
      const suaPolys = []
      if (suaRes.status === 'fulfilled' && suaRes.value.ok) {
        try {
          const d = await suaRes.value.json()
          for (const f of (d.features || [])) {
            const rings = f.geometry?.rings || []
            const hitRing = rings.find(r => routeIntersectsPoly(waypoints, ringToPoly(r)))
            if (hitRing) {
              const label = [f.attributes?.TYPE_CODE, f.attributes?.NAME].filter(Boolean).join(' ')
              if (label) {
                suaNames.push(label)
                suaPolys.push({ name: label, typeCode: f.attributes?.TYPE_CODE || '', poly: ringToPoly(hitRing) })
              }
            }
          }
        } catch { /* ignore */ }
      }
      if (suaNames.length) det.push('sua')
      setDetectedSUANames(suaNames)
      setDetectedSUAPolys(suaPolys)

      setDetectedTerrain(det)
    }

    detect()
    return () => { cancelled = true }
  }, [JSON.stringify(waypoints.map(w => [+w.lat.toFixed(3), +w.lon.toFixed(3)])), selectedAlt])

  const OPENAIP_KEY = 'b640e75c082134fd6f1524246478f301'
  const [openaipKey, setOAKey] = useState(() => localStorage.getItem('openaip_key') || OPENAIP_KEY)

  // Persist key to localStorage + IndexedDB on mount so it's always available
  useEffect(() => {
    localStorage.setItem('openaip_key', OPENAIP_KEY)
    put('settings', { key: 'openaip_key', value: OPENAIP_KEY }).catch(() => {})
    setOAKey(OPENAIP_KEY)
  }, [])
  const [tfrData, setTfrData]    = useState(null)
  const [tfrLoading, setTfrLoad] = useState(false)
  const [mapFlyTarget, setMapFlyTarget] = useState(null)

  // TFR conflict detection — uses shared routeIntersectsPoly
  const tfrConflicts = useMemo(() => {
    if (!tfrData?.length || waypoints.length < 2) return []
    const hits = []
    for (const tfr of tfrData) {
      if (tfr.polygon?.length > 2) {
        if (routeIntersectsPoly(waypoints, tfr.polygon)) hits.push(tfr)
      } else if (tfr.lat && tfr.lon) {
        const near = waypoints.slice(0, -1).some((w, s) => {
          const d = crossTrackNM(tfr.lat, tfr.lon, [w.lat, w.lon], [waypoints[s+1].lat, waypoints[s+1].lon])
          return d < 5
        })
        if (near) hits.push(tfr)
      }
    }
    return hits
  }, [tfrData, JSON.stringify(waypoints.map(w => [+w.lat.toFixed(3), +w.lon.toFixed(3)]))])

  function saveKey(k) {
    const trimmed = k.trim()
    setOAKey(trimmed)
    localStorage.setItem('openaip_key', trimmed)
    put('settings', { key: 'openaip_key', value: trimmed }).catch(() => {})
  }

  function toggleLayer(name) {
    setLayers(prev => {
      const next = { ...prev, [name]: !prev[name] }
      if (name === 'tfr' && next.tfr && !tfrData) loadTFRs()
      return next
    })
  }

  async function loadTFRs() {
    setTfrLoad(true)
    setTfrData(null)

    // FAA GeoServer WFS — the actual endpoint tfr3 uses internally
    // No CORS headers, must proxy. corsproxy.io confirmed working.
    const WFS_URL = 'https://tfr.faa.gov/geoserver/TFR/ows?service=WFS&version=1.1.0&request=GetFeature&typeName=TFR:V_TFR_LOC&maxFeatures=300&outputFormat=application/json&srsname=EPSG:4326'
    try {
      const raw = await proxyFetch(WFS_URL, 15000)
      const geo = JSON.parse(raw)
      if (geo?.features?.length) {
        const tfrs = (geo.features || []).map(f => {
          const p = f.properties
          // GeoJSON coords are [lon, lat] — Leaflet needs [lat, lon]
          let polygon = null, lat = null, lon = null
          if (f.geometry?.type === 'Polygon') {
            polygon = f.geometry.coordinates[0].map(([lo, la]) => [la, lo])
            lat = polygon[0][0]; lon = polygon[0][1]
          } else if (f.geometry?.type === 'Point') {
            [lon, lat] = f.geometry.coordinates
          } else if (f.geometry?.type === 'MultiPolygon') {
            polygon = f.geometry.coordinates[0][0].map(([lo, la]) => [la, lo])
            lat = polygon[0][0]; lon = polygon[0][1]
          }
          return {
            id:      p.NOTAM_KEY ?? f.id ?? '?',
            type:    p.LEGAL ?? 'TFR',
            desc:    p.TITLE ?? '',
            state:   p.STATE ?? '',
            lat, lon, polygon,
          }
        }).filter(t => t.lat !== null)
        setTfrData(tfrs)
        setTfrLoad(false)
        return
      }
    } catch { /* ignore */ }

    // Parse GeoRSS XML — returns TFRs with polygon/point geometry for map rendering
    const parseGeoRss = xml => {
      const doc = new DOMParser().parseFromString(xml, 'text/xml')
      const items = [...doc.querySelectorAll('item')]
      return items.map(item => {
        const title = item.querySelector('title')?.textContent?.trim() ?? '?'
        const desc  = item.querySelector('description')?.textContent?.trim() ?? ''

        // GeoRSS polygon: space-separated "lat lon lat lon ..."
        const polyNode = [...item.childNodes].find(n => n.localName === 'polygon')
        // GeoRSS point: "lat lon"
        const ptNode   = [...item.childNodes].find(n => n.localName === 'point')
        // where element: may contain gml:polygon
        const whereNode = [...item.childNodes].find(n => n.localName === 'where')

        let polygon = null, lat = null, lon = null

        if (polyNode) {
          const nums = polyNode.textContent.trim().split(/\s+/).map(Number).filter(n => !isNaN(n))
          if (nums.length >= 4) {
            polygon = []
            for (let i = 0; i < nums.length - 1; i += 2) polygon.push([nums[i], nums[i+1]])
            lat = polygon[0][0]; lon = polygon[0][1]
          }
        }
        if (!polygon && whereNode) {
          const coords = whereNode.textContent.trim().split(/\s+/).map(Number).filter(n => !isNaN(n))
          if (coords.length >= 4) {
            polygon = []
            for (let i = 0; i < coords.length - 1; i += 2) polygon.push([coords[i], coords[i+1]])
            lat = polygon[0][0]; lon = polygon[0][1]
          }
        }
        if (!lat && ptNode) {
          const [la, lo] = ptNode.textContent.trim().split(/\s+/).map(Number)
          lat = la; lon = lo
        }

        // Extract type from description HTML
        const typeMatch = desc.match(/(?:type|scenario)[^>]*?>([^<]+)/i)
        const type = typeMatch?.[1]?.trim().toUpperCase() ?? 'TFR'

        return { id: title, type, desc: desc.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(), lat, lon, polygon }
      }).filter(t => t.lat !== null)
    }

    // Parse tfr2 JSON (no coords — list only fallback)
    const parseTfr2Json = raw => {
      const data = JSON.parse(raw)
      const list = Array.isArray(data) ? data : (data.TFRAreaList || data.tfr || data.items || [])
      return list.map(t => ({
        id:      t.notam_id ?? t.notamID ?? t.id ?? '?',
        type:    t.type ?? 'TFR',
        desc:    t.description ?? t.facilityName ?? '',
        date:    t.creation_date ?? '',
        lat:     null, lon: null, polygon: null,
      }))
    }

    let tfrs = null

    // 1. FAA GeoRSS feeds — have actual coordinates for map rendering
    const GEORSS_URLS = [
      'https://tfr.faa.gov/tfr2/georss.xml',
      'https://tfr.faa.gov/save_pages/tfrRssALL.xml',
      'https://tfr.faa.gov/tfr2/tfr.rss',
    ]
    for (const url of GEORSS_URLS) {
      try {
        const raw = await proxyFetch(url, 12000)
        if (raw.includes('<item') || raw.includes('<entry')) {
          const parsed = parseGeoRss(raw)
          if (parsed.length) { tfrs = parsed; break }
        }
      } catch { /* ignore */ }
    }

    // 2. AWC NOTAM API — CORS-friendly, no proxy needed
    if (!tfrs) {
      try {
        const res = await fetch(
          `${AWC}/notam?format=json&hazard=tfr`,
          { signal: AbortSignal.timeout(8000) }
        )
        if (res.ok) {
          const data = await res.json()
          const list = Array.isArray(data) ? data : (data.items || data.notams || [])
          if (list.length) {
            tfrs = list.map(t => {
              // AWC may include geometry in WKT or GeoJSON
              let polygon = null, lat = t.lat ?? null, lon = t.lon ?? null
              if (t.geometry?.coordinates) {
                const coords = t.geometry.coordinates[0]
                if (coords) { polygon = coords.map(([lo, la]) => [la, lo]); lat = polygon[0][0]; lon = polygon[0][1] }
              }
              return { id: t.notamID ?? t.icaoId ?? '?', type: t.hazard ?? 'TFR', desc: t.rawNOTAM ?? '', lat, lon, polygon }
            }).filter(t => t.lat !== null)
          }
        }
      } catch { /* ignore */ }
    }

    // 3. tfr2 JSON fallback (list only, no map geometry)
    if (!tfrs) {
      try {
        const raw = await proxyFetch('https://tfr.faa.gov/tfr2/list.json', 15000)
        tfrs = parseTfr2Json(raw)
      } catch { /* ignore */ }
    }

    setTfrData(tfrs ?? [])
    setTfrLoad(false)
  }


  async function calcRoute() {
    if (!dep.trim() || !dest.trim()) return
    setRL(true); setRE(null); setRoute(null)
    try {
      const [da, dsta] = await Promise.all([
        fetchAWC(dep.trim().toUpperCase()),
        fetchAWC(dest.trim().toUpperCase()),
      ])
      if (!da?.lat || !dsta?.lat) throw new Error('Coordinates not found')

      const depLat = parseFloat(da.lat), depLon = parseFloat(da.lon)
      const dstLat = parseFloat(dsta.lat), dstLon = parseFloat(dsta.lon)
      const tc   = bearingDeg(depLat, depLon, dstLat, dstLon)
      const dist = haversineNm(depLat, depLon, dstLat, dstLon)

      // NOAA magnetic declination at route midpoint
      const midLat = (depLat + dstLat) / 2
      const midLon = (depLon + dstLon) / 2
      let magVar = 0
      try {
        const r = await fetch(
          `https://www.ngdc.noaa.gov/geomag-web/calculators/calculateDeclination?lat1=${midLat.toFixed(4)}&lon1=${midLon.toFixed(4)}&key=zNEw7&resultFormat=json`
        )
        const d = await r.json()
        magVar = d.result?.[0]?.declination ?? 0
      } catch { /* ignore */ }

      const mc = ((tc - magVar) + 360) % 360
      const mcRounded = Math.round(mc)

      const routeObj = {
        tc: Math.round(tc), mc: mcRounded,
        distNm: Math.round(dist),
        magVar: magVar.toFixed(1),
        depName: da.name || dep.toUpperCase(),
        destName: dsta.name || dest.toUpperCase(),
        depPos:  [depLat, depLon],
        destPos: [dstLat, dstLon],
        dep: dep.trim().toUpperCase(),
        dest: dest.trim().toUpperCase(),
      }
      setRoute(routeObj)
      setLayers(prev => ({ ...prev, sectional: true }))
      setMapFlyTarget({ lat: depLat, lon: depLon, zoom: 10, _t: Date.now() })
      put('settings', { key: 'route', ...routeObj }).catch(() => {})
      setCourse(String(mcRounded))
      setSelectedAlt(null)
    } catch (e) {
      setRE('Could not calculate — check both ICAO codes')
    } finally {
      setRL(false)
    }
  }

  const c        = parseInt(course)
  const valid    = !isNaN(c) && c >= 0 && c <= 360
  const isEast   = valid && c <= 179
  const direction = valid ? (isEast ? 'Eastbound' : 'Westbound') : null
  const altitudes = valid
    ? (isEast ? [3500,5500,7500,9500,11500,13500,15500,17500]
              : [4500,6500,8500,10500,12500,14500,16500])
    : null

  return (
    <ExpandableCard item={item} isChecked={isChecked} onToggle={onToggle} open={open} setOpen={setOpen}>
      <div style={{ padding: '14px 12px 12px', borderTop: '0.5px solid var(--border)' }}>

        {/* ── Route calculator ── */}
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 10 }}>
          Route
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginBottom: 4, letterSpacing: '0.3px', textTransform: 'uppercase' }}>From</div>
            {depValidated ? (
              <div style={{
                width: '100%', background: 'var(--bg-card-2)', border: '0.5px solid var(--border)',
                borderRadius: 9, padding: '9px 11px', boxSizing: 'border-box',
                display: 'flex', alignItems: 'center',
              }}>
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 7,
                  background: 'var(--bg-card)', border: '0.5px solid var(--border)',
                  borderRadius: 6, padding: '3px 8px 3px 10px',
                }}>
                  <span style={{
                    fontSize: 16, fontWeight: 700, fontFamily: 'monospace',
                    letterSpacing: '1px', color: 'var(--text)', lineHeight: 1,
                  }}>
                    {dep}
                  </span>
                  <button
                    onClick={() => { setDep(''); setDepVal(false); setDepErr(null); setRoute(null); setRE(null) }}
                    style={{
                      background: 'none', border: 'none', padding: '2px',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      cursor: 'pointer', color: 'var(--text-tertiary)',
                    }}>
                    <svg width={9} height={9} viewBox="0 0 24 24" fill="none">
                      <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
                    </svg>
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <input
                  value={dep}
                  onChange={e => { setDep(e.target.value.toUpperCase()); setDepErr(null); setRoute(null); setRE(null) }}
                  onKeyDown={e => e.key === 'Enter' && validateDep()}
                  onBlur={() => dep.trim().length >= 3 && validateDep()}
                  placeholder="KMIA"
                  maxLength={4}
                  style={{
                    width: '100%', background: 'var(--bg-card-2)', border: `0.5px solid ${depError ? 'var(--danger)' : 'var(--border)'}`,
                    borderRadius: 9, padding: '9px 11px', color: 'var(--text)',
                    fontSize: 16, fontWeight: 700, fontFamily: 'monospace',
                    letterSpacing: '1px', outline: 'none', boxSizing: 'border-box',
                    opacity: depChecking ? 0.6 : 1,
                  }}
                />
                {depError && <div style={{ fontSize: 10, color: 'var(--danger)', marginTop: 3 }}>{depError}</div>}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', paddingBottom: 0, color: 'var(--text-tertiary)', fontSize: 16 }}>→</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginBottom: 4, letterSpacing: '0.3px', textTransform: 'uppercase' }}>To</div>
            {destValidated ? (
              <div style={{
                width: '100%', background: 'var(--bg-card-2)', border: '0.5px solid var(--border)',
                borderRadius: 9, padding: '9px 11px', boxSizing: 'border-box',
                display: 'flex', alignItems: 'center',
              }}>
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 7,
                  background: 'var(--bg-card)', border: '0.5px solid var(--border)',
                  borderRadius: 6, padding: '3px 8px 3px 10px',
                }}>
                  <span style={{ fontSize: 16, fontWeight: 700, fontFamily: 'monospace', letterSpacing: '1px', color: 'var(--text)', lineHeight: 1 }}>
                    {dest}
                  </span>
                  <button
                    onClick={() => { setDest(''); setDestVal(false); setDestErr(null); setRoute(null); setRE(null) }}
                    style={{
                      background: 'none', border: 'none', padding: '2px',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      cursor: 'pointer', color: 'var(--text-tertiary)',
                    }}>
                    <svg width={9} height={9} viewBox="0 0 24 24" fill="none">
                      <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
                    </svg>
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <input
                  value={dest}
                  onChange={e => { setDest(e.target.value.toUpperCase()); setDestErr(null); setRoute(null); setRE(null) }}
                  onKeyDown={e => e.key === 'Enter' && validateDest()}
                  onBlur={() => dest.trim().length >= 3 && validateDest()}
                  placeholder="MGGT"
                  maxLength={4}
                  style={{
                    width: '100%', background: 'var(--bg-card-2)', border: `0.5px solid ${destError ? 'var(--danger)' : 'var(--border)'}`,
                    borderRadius: 9, padding: '9px 11px', color: 'var(--text)',
                    fontSize: 16, fontWeight: 700, fontFamily: 'monospace',
                    letterSpacing: '1px', outline: 'none', boxSizing: 'border-box',
                    opacity: destChecking ? 0.6 : 1,
                  }}
                />
                {destError && <div style={{ fontSize: 10, color: 'var(--danger)', marginTop: 3 }}>{destError}</div>}
              </div>
            )}
          </div>
        </div>

        <button
          onClick={calcRoute}
          disabled={routeLoading || !dep.trim() || !dest.trim()}
          style={{
            width: '100%', padding: '9px 0', borderRadius: 9,
            background: dep.trim() && dest.trim() && !routeLoading ? 'var(--text)' : 'var(--bg-card-2)',
            color: dep.trim() && dest.trim() && !routeLoading ? 'var(--bg)' : 'var(--text-tertiary)',
            border: '0.5px solid var(--border)',
            fontSize: 13, fontWeight: 600, cursor: dep.trim() && dest.trim() ? 'pointer' : 'default',
            transition: 'all 0.15s',
          }}>
          {routeLoading ? 'Calculating…' : 'Calculate Route'}
        </button>

        {routeError && <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 8 }}>{routeError}</div>}

        {/* Route result */}
        {route && (
          <div style={{ marginTop: 10, background: 'var(--bg-card-2)', borderRadius: 10, padding: '10px 12px' }}>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 8 }}>
              {route.depName} → {route.destName}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
              {[
                { label: 'Distance',    val: `${route.distNm} NM` },
                { label: 'True Course', val: `${route.tc}°` },
                { label: 'Mag Var',     val: `${parseFloat(route.magVar) >= 0 ? '+' : ''}${route.magVar}°` },
              ].map(r => (
                <div key={r.label} style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', fontFamily: 'monospace' }}>{r.val}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.3px' }}>{r.label}</div>
                </div>
              ))}
            </div>
            <div style={{
              marginTop: 10, padding: '7px 10px', borderRadius: 8,
              background: 'var(--bg-card)', border: '0.5px solid var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Magnetic Course</span>
              <span style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)', fontFamily: 'monospace' }}>{route.mc}°</span>
            </div>
          </div>
        )}

        {/* ── Route map ── */}
        {route?.depPos && route?.destPos && (
          <div style={{ marginTop: 10 }}>

            {/* Layer toggles */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
              {[
                { id: 'sectional', label: 'Sectional' },
                { id: 'airspace',  label: 'Airspace' },
                { id: 'tfr',       label: tfrLoading ? 'TFR…' : 'TFR' },
              ].map(l => (
                <button key={l.id} onClick={() => toggleLayer(l.id)} style={{
                  padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                  cursor: 'pointer', transition: 'all 0.15s',
                  background: layers[l.id] ? 'var(--text)' : 'var(--bg-card-2)',
                  color:      layers[l.id] ? 'var(--bg)' : 'var(--text-secondary)',
                  border: `0.5px solid ${layers[l.id] ? 'var(--text)' : 'var(--border)'}`,
                }}>{l.label}</button>
              ))}
            </div>

            {layers.tfr && tfrLoading && (
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 6 }}>Loading TFRs…</div>
            )}
            {layers.tfr && !tfrLoading && tfrData !== null && (
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 6, display: 'flex', justifyContent: 'space-between' }}>
                <span>{tfrData.length === 0 ? 'FAA server unreachable' : `${tfrData.length} TFRs loaded — open map to view`}</span>
                <a href="https://tfr.faa.gov/tfr2/list.html" target="_blank" rel="noreferrer"
                  style={{ color: 'var(--accent)', textDecoration: 'none' }}>FAA Map ↗</a>
              </div>
            )}

            {/* Map — inline + fullscreen modal */}
            {(() => {
              const mapCenter = [
                (route.depPos[0] + route.destPos[0]) / 2,
                (route.depPos[1] + route.destPos[1]) / 2,
              ]
              const MapLayers = ({ fit }) => (<>
                <TileLayer url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png" />
                {layers.sectional && (
                  <TileLayer url="https://vfrmap.com/20260319/tiles/vfrc/{z}/{y}/{x}.jpg"
                    tms={true} opacity={0.9} maxZoom={12}
                    className="sectional-layer"
                    errorTileUrl="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
                    attribution='&copy; <a href="https://vfrmap.com">VFRMap.com</a>' />
                )}
                {layers.airspace && openaipKey && (
                  <TileLayer key={openaipKey}
                    url={`https://api.tiles.openaip.net/api/data/openaip/{z}/{x}/{y}.png?apiKey=${openaipKey}`}
                    opacity={0.9} minZoom={4} maxZoom={17}
                    attribution='&copy; <a href="https://www.openaip.net">openAIP</a>' />
                )}
                {layers.tfr && tfrData?.filter(t => t.lat !== null).map((t, i) => {
                  const tfrColor = (() => {
                    const type = (t.type || '').toUpperCase()
                    if (type.includes('VIP') || type.includes('SECURITY') || type.includes('MILITARY')) return '#FF3B30'
                    if (type.includes('HAZARD') || type.includes('WILDFIRE') || type.includes('DISASTER')) return '#FF9500'
                    if (type.includes('AIR SHOW') || type.includes('SPORT')) return '#5AC8FA'
                    if (type.includes('SPACE')) return '#AF52DE'
                    if (type.includes('UAS') || type.includes('DRONE') || type.includes('GATHERING')) return '#FFD60A'
                    return '#FF3B30'
                  })()
                  return t.polygon?.length > 2 ? (
                    <Polygon key={i} positions={t.polygon}
                      pathOptions={{ color: tfrColor, fillColor: tfrColor, fillOpacity: 0.18, weight: 2, opacity: 0.9 }}>
                      <Popup><div style={{ fontSize: 12, lineHeight: 1.5, maxWidth: 200 }}>
                        <strong style={{ color: tfrColor }}>{t.type}</strong> · {t.id}<br/>
                        <span style={{ fontSize: 11 }}>{t.desc.slice(0, 120)}</span>
                      </div></Popup>
                    </Polygon>
                  ) : (
                    <CircleMarker key={i} center={[t.lat, t.lon]} radius={10}
                      pathOptions={{ color: tfrColor, fillColor: tfrColor, fillOpacity: 0.25, weight: 2 }}>
                      <Popup><div style={{ fontSize: 12, lineHeight: 1.5, maxWidth: 200 }}>
                        <strong style={{ color: tfrColor }}>{t.type}</strong> · {t.id}<br/>
                        <span style={{ fontSize: 11 }}>{t.desc.slice(0, 120)}</span>
                      </div></Popup>
                    </CircleMarker>
                  )
                })}
                {/* SUA polygons — always shown when detected, no layer toggle needed */}
                {detectedSUAPolys.map((s, i) => {
                  const tc = s.typeCode.toUpperCase()
                  const suaColor = tc.startsWith('P') ? '#FF3B30'
                    : tc.startsWith('R') ? '#FF9500'
                    : tc.includes('MOA') ? '#FFD60A'
                    : tc.startsWith('W') ? '#5AC8FA'
                    : '#AF52DE' // Alert
                  return (
                    <Polygon key={`sua-${i}`} positions={s.poly}
                      pathOptions={{ color: suaColor, fillColor: suaColor, fillOpacity: 0.15, weight: 1.5, opacity: 0.85, dashArray: '5 4' }}>
                      <Popup><div style={{ fontSize: 12, lineHeight: 1.5, maxWidth: 200 }}>
                        <strong style={{ color: suaColor }}>{s.name}</strong>
                      </div></Popup>
                    </Polygon>
                  )
                })}
                {fit && <RouteFitter positions={waypoints.map(w => [w.lat, w.lon])} />}
                <AirspaceZoomer active={layers.airspace} />
                <SectionalZoomer active={layers.sectional} />
                <Marker position={waypoints[0] ? [waypoints[0].lat, waypoints[0].lon] : route.depPos}  icon={airportIcon} />
                <Marker position={waypoints[waypoints.length-1] ? [waypoints[waypoints.length-1].lat, waypoints[waypoints.length-1].lon] : route.destPos} icon={airportIcon} />
                {waypoints.length >= 2 && <PolylineEditor waypoints={waypoints} onInsert={insertWaypoint} />}
                {waypoints.slice(1, -1).map((w, i) => (
                  <DraggableWaypoint key={w.id} position={[w.lat, w.lon]} index={i + 1} onMove={moveWaypoint} onRemove={removeWaypoint} />
                ))}
              </>)

              const AirportLabels = () => (
                <div style={{
                  position: 'absolute', bottom: 8, left: 8, right: 8, zIndex: 999,
                  display: 'flex', justifyContent: 'space-between', pointerEvents: 'none',
                }}>
                  {[
                    { icao: dep,  pos: route.depPos },
                    { icao: dest, pos: route.destPos },
                  ].map(({ icao, pos }, i) => (
                    <div key={i}
                      onClick={e => { e.stopPropagation(); setMapFlyTarget({ lat: pos[0], lon: pos[1], zoom: 10, _t: Date.now() }) }}
                      style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)', borderRadius: 6, padding: '3px 8px', pointerEvents: 'auto', cursor: 'pointer' }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', fontFamily: 'monospace' }}>{icao}</span>
                    </div>
                  ))}
                </div>
              )

              return (<>
                {/* Inline map */}
                <div style={{ borderRadius: 10, overflow: 'hidden', height: 240, border: '0.5px solid var(--border)', position: 'relative', cursor: 'pointer' }}
                  onClick={() => setMapFS(true)}>
                  <MapContainer center={route.depPos} zoom={10}
                    style={{ height: '100%', width: '100%' }}
                    zoomControl={false} attributionControl={false}
                    dragging={false} scrollWheelZoom={false} doubleClickZoom={false} touchZoom={false}>
                    <MapLayers fit={false} />
                    <MapFlyTo target={mapFlyTarget} instant={true} />
                  </MapContainer>
                  {/* Expand hint */}
                  <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 999,
                    background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)',
                    borderRadius: 6, padding: '4px 7px', pointerEvents: 'none' }}>
                    <span style={{ fontSize: 13, color: '#fff' }}>⤢</span>
                  </div>
                  <AirportLabels />
                </div>

                {/* Fullscreen modal */}
                {mapFullscreen && (() => {
                  const TERRAIN_DATA = {
                    water:     { label: 'Water',         items: ['Life jacket / flotation device aboard','Glide range reaches shore or vessel','Survival equipment for water temp','Filed flight plan with overwater leg'] },
                    mountains: { label: 'Mountains',     items: ['Terrain clearance — 1,000 ft above highest within 5 NM','Escape route identified for each leg','Turbulence / downdraft margins planned','Density altitude checked at cruise level'] },
                    builtup:   { label: 'Built-up Areas',items: ['Min 1,000 ft AGL above highest obstacle within 2,000 ft','Emergency landing area identified','Noise abatement procedures noted'] },
                    aero:      { label: 'Aerodromes',    items: ['Cross at min 500 ft above circuit altitude','Monitor CTAF / MF frequency','Note traffic pattern direction'] },
                    oxygen:    { label: 'Oxygen',        items: ['Above 10,000 ft MSL >30 min: O₂ required (crew)','Above 12,500 ft MSL: O₂ required','Passengers: O₂ available above 10,000 ft'] },
                    parks:     { label: 'Nat. Park',     items: ['Check NPS overflight rules — many parks have voluntary/mandatory altitude corridors','Noise-sensitive wildlife areas may have seasonal restrictions','Review park-specific SFAR or LOA if applicable'] },
                    sua:       { label: 'Spec. Use Airspace', items: ['Verify SUA active status via NOTAM / 1800wxbrief','MOA — contact controlling agency for advisories','Restricted / Prohibited — do not enter without clearance','Alert area — extra vigilance required'] },
                  }
                  const REFS = [
                    { label: 'FAA NOTAM Search', sub: 'Official FAA NOTAM system',          url: 'https://notams.aim.faa.gov/notamSearch/' },
                    { label: 'FAA TFR Map',       sub: 'Active TFRs plotted on a map',       url: 'https://tfr.faa.gov/tfr2/list.html' },
                    { label: '1800wxbrief.com',   sub: 'Leidos — full preflight briefing',   url: 'https://www.1800wxbrief.com' },
                    { label: 'SkyVector',         sub: 'NOTAMs and TFRs overlaid on chart',  url: 'https://skyvector.com' },
                  ]
                  const TFR_LEGEND = [
                    { label: 'Security / VIP', color: '#FF3B30' },
                    { label: 'Hazard',         color: '#FF9500' },
                    { label: 'Air Show',       color: '#5AC8FA' },
                    { label: 'Space Ops',      color: '#AF52DE' },
                    { label: 'UAS',            color: '#FFD60A' },
                  ]
                  const tfrCounts = {}
                  if (tfrData) {
                    tfrData.forEach(t => {
                      const type = (t.type || '').toUpperCase()
                      const key = type.includes('HAZARD') || type.includes('WILDFIRE') ? 'Hazard'
                        : type.includes('AIR SHOW') || type.includes('SPORT') ? 'Air Show'
                        : type.includes('SPACE') ? 'Space Ops'
                        : type.includes('UAS') || type.includes('GATHERING') ? 'UAS'
                        : 'Security / VIP'
                      tfrCounts[key] = (tfrCounts[key] || 0) + 1
                    })
                  }

                  return (
                    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: '#e8e0d8' }}>
                      {/* Map — full height */}
                      <div style={{ position: 'absolute', inset: 0, background: '#e8e0d8' }}>
                        <MapContainer center={mapCenter} zoom={7}
                          style={{ height: '100%', width: '100%' }}
                          zoomControl={true} attributionControl={false}>
                          <MapInvalidator />
                          <MapLayers fit={true} />
                          <MapFlyTo target={mapFlyTarget} />
                        </MapContainer>
                      </div>

                      {/* Route edit hint — fades after 4s */}
                      <RouteHint />

                      {/* Top bar */}
                      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10001,
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '14px 16px', background: 'linear-gradient(to bottom, rgba(0,0,0,0.75) 0%, transparent 100%)',
                      }}>
                        {/* Layer toggles */}
                        <div style={{ display: 'flex', gap: 7 }}>
                          {[['sectional','SECT'],['airspace','ARSP'],['tfr','TFR']].map(([k,label]) => (
                            <button key={k} onClick={() => toggleLayer(k)} style={{
                              background: layers[k] ? 'rgba(255,255,255,0.95)' : 'rgba(10,10,10,0.75)',
                              backdropFilter: 'blur(12px)',
                              border: layers[k] ? 'none' : '0.5px solid rgba(255,255,255,0.18)',
                              borderRadius: 7, color: layers[k] ? '#000' : 'rgba(255,255,255,0.85)',
                              fontSize: 11, fontWeight: 700, letterSpacing: '0.5px',
                              padding: '7px 11px', cursor: 'pointer',
                            }}>{label}</button>
                          ))}
                        </div>
                        {/* Close */}
                        <button onClick={() => setMapFS(false)} style={{
                          background: 'rgba(10,10,10,0.75)', backdropFilter: 'blur(12px)',
                          border: '0.5px solid rgba(255,255,255,0.18)', borderRadius: 7,
                          color: 'rgba(255,255,255,0.85)', fontSize: 11, fontWeight: 700,
                          letterSpacing: '0.5px', padding: '7px 13px', cursor: 'pointer',
                        }}>✕ CLOSE</button>
                      </div>

                      {/* Bottom panel */}
                      <div style={{
                        position: 'absolute', bottom: 16, left: 16, right: 16, zIndex: 10001,
                        height: 'auto', minHeight: 210,
                        background: 'rgba(8,8,10,0.92)',
                        backdropFilter: 'blur(28px)',
                        WebkitBackdropFilter: 'blur(28px)',
                        border: '0.5px solid rgba(255,255,255,0.12)',
                        borderRadius: 18,
                        boxShadow: '0 8px 40px rgba(0,0,0,0.55), 0 1px 0 rgba(255,255,255,0.06) inset',
                        display: 'flex', flexDirection: 'column',
                        overflow: 'visible',
                      }}>
                        {/* Route strip */}
                        <div style={{
                          padding: '10px 18px 8px',
                          borderBottom: '0.5px solid rgba(255,255,255,0.07)',
                          flexShrink: 0,
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            {/* ICAO pair */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                              <span style={{ fontSize: 15, fontWeight: 800, color: '#fff', fontFamily: 'monospace', letterSpacing: '1px' }}>{dep}</span>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                <div style={{ width: 18, height: 0.5, background: 'rgba(255,255,255,0.35)' }} />
                                <div style={{ width: 3, height: 3, borderRadius: '50%', background: 'rgba(255,255,255,0.35)' }} />
                                <div style={{ width: 18, height: 0.5, background: 'rgba(255,255,255,0.35)' }} />
                              </div>
                              <span style={{ fontSize: 15, fontWeight: 800, color: '#fff', fontFamily: 'monospace', letterSpacing: '1px' }}>{dest}</span>
                              {waypoints.length > 2 && (
                                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.08)', borderRadius: 4, padding: '2px 6px', fontWeight: 600 }}>
                                  +{waypoints.length - 2} WPT
                                </span>
                              )}
                            </div>
                            {/* Stats */}
                            <div style={{ display: 'flex', gap: 16 }}>
                              {[
                                { val: `${route.distNm} NM`, lbl: 'DIST' },
                                { val: `${route.mc}°`,       lbl: 'MC' },
                              ].map(({ val, lbl }) => (
                                <div key={lbl} style={{ textAlign: 'right' }}>
                                  <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', fontFamily: 'monospace' }}>{val}</div>
                                  <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.6px', marginTop: 1 }}>{lbl}</div>
                                </div>
                              ))}
                            </div>
                          </div>
                          {waypoints.length > 2 && routeString && (
                            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.38)', fontFamily: 'monospace', letterSpacing: '0.3px', lineHeight: 1.4, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {routeString}
                            </div>
                          )}
                        </div>

                        {/* Content — vertical stack, everything fits */}
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'visible', padding: '8px 18px 10px', gap: 0, position: 'relative' }}>

                          {/* ── TFR section ── */}
                          {layers.tfr && tfrData && (() => {
                            const flyToConflict = () => {
                              const tfr = tfrConflicts[0]
                              let lat = tfr.lat, lon = tfr.lon
                              if (!lat && tfr.polygon?.length) {
                                lat = tfr.polygon.reduce((s,p) => s + p[0], 0) / tfr.polygon.length
                                lon = tfr.polygon.reduce((s,p) => s + p[1], 0) / tfr.polygon.length
                              }
                              if (lat && lon) setMapFlyTarget({ lat, lon, zoom: 10, _t: Date.now() })
                            }
                            return (<>
                              {/* Conflict warning — full width, compact single line */}
                              {tfrConflicts.length > 0 && (
                                <div
                                  onClick={flyToConflict}
                                  style={{
                                    background: 'rgba(255,59,48,0.2)', border: '1px solid rgba(255,59,48,0.6)',
                                    borderRadius: 6, padding: '5px 10px', marginBottom: 7,
                                    display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer',
                                    transition: 'background 0.15s',
                                  }}
                                  onMouseEnter={e => e.currentTarget.style.background='rgba(255,59,48,0.30)'}
                                  onMouseLeave={e => e.currentTarget.style.background='rgba(255,59,48,0.2)'}
                                >
                                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#FF3B30" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                                  <span style={{ fontSize: 10, fontWeight: 800, color: '#FF3B30', letterSpacing: '0.3px', flex: 1 }}>ROUTE ENTERS TFR</span>
                                  <span style={{ fontSize: 9, color: 'rgba(255,100,90,0.8)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>
                                    {tfrConflicts.slice(0,3).map(t => t.type || 'TFR').join(' · ')}{tfrConflicts.length > 3 ? ` +${tfrConflicts.length-3}` : ''}
                                  </span>
                                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(255,100,90,0.6)" strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0 }}>
                                    <circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>
                                  </svg>
                                </div>
                              )}
                              {/* TFR count row — label + dots inline, all on one line */}
                              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', rowGap: 4 }}>
                                <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.7px', color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                                  TFR · {tfrData.length}
                                </span>
                                {TFR_LEGEND.map(({ label, color }) => tfrCounts[label] ? (
                                  <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
                                    <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.65)', fontWeight: 500, whiteSpace: 'nowrap' }}>{label}</span>
                                    <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace' }}>{tfrCounts[label]}</span>
                                  </div>
                                ) : null)}
                              </div>
                            </>)
                          })()}

                          {/* Divider between TFR and Overflight */}
                          {layers.tfr && tfrData && detectedTerrain.length > 0 && (
                            <div style={{ height: '0.5px', background: 'rgba(255,255,255,0.07)', margin: '8px 0' }} />
                          )}

                          {/* ── Overflight section ── */}
                          {detectedTerrain.length > 0 && (() => {
                            const chipColor = id =>
                              id === 'parks' ? { bg: 'rgba(52,199,89,0.15)', fg: 'rgba(52,199,89,0.9)', activeBg: 'rgba(52,199,89,0.28)', border: 'rgba(52,199,89,0.4)' }
                              : id === 'sua' ? { bg: 'rgba(255,149,0,0.15)', fg: 'rgba(255,149,0,0.9)', activeBg: 'rgba(255,149,0,0.28)', border: 'rgba(255,149,0,0.4)' }
                              : { bg: 'rgba(255,255,255,0.08)', fg: 'rgba(255,255,255,0.65)', activeBg: 'rgba(255,255,255,0.16)', border: 'rgba(255,255,255,0.25)' }
                            const subNames = id =>
                              id === 'parks' ? detectedParkNames
                              : id === 'sua' ? detectedSUANames
                              : []
                            return (
                              <div style={{ minWidth: 0, position: 'relative' }}>
                                {/* Label + chips all on one line */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', rowGap: 5 }}>
                                  <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.7px', color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                                    Overflight
                                  </span>
                                  {detectedTerrain.map(id => {
                                    const c = chipColor(id)
                                    const names = subNames(id)
                                    const isActive = activeChip === id
                                    return (
                                      <div key={id} style={{ position: 'relative' }}>
                                        <span
                                          onClick={() => setActiveChip(isActive ? null : id)}
                                          onMouseEnter={() => setActiveChip(id)}
                                          onMouseLeave={() => setActiveChip(null)}
                                          style={{
                                            fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 4,
                                            background: isActive ? c.activeBg : c.bg,
                                            color: c.fg,
                                            letterSpacing: '0.2px',
                                            cursor: 'pointer',
                                            border: `0.5px solid ${isActive ? c.border : 'transparent'}`,
                                            transition: 'background 0.15s',
                                            userSelect: 'none',
                                            display: 'inline-flex', alignItems: 'center', gap: 4,
                                            whiteSpace: 'nowrap',
                                          }}>
                                          {TERRAIN_DATA[id]?.label}
                                          {names.length > 0 && <span style={{ opacity: 0.5, fontSize: 8 }}>{names.length}</span>}
                                          <span style={{ opacity: 0.5, fontSize: 9 }}>ⓘ</span>
                                        </span>
                                      </div>
                                    )
                                  })}
                                </div>
                              </div>
                            )
                          })()}

                          {/* Chip popup — rendered inside bottom panel, above it */}
                          {activeChip && TERRAIN_DATA[activeChip] && (() => {
                            const c = activeChip === 'parks' ? { accent: 'rgba(52,199,89,0.9)', border: 'rgba(52,199,89,0.25)' }
                              : activeChip === 'sua' ? { accent: 'rgba(255,149,0,0.9)', border: 'rgba(255,149,0,0.25)' }
                              : { accent: 'rgba(255,255,255,0.7)', border: 'rgba(255,255,255,0.15)' }
                            const names = activeChip === 'parks' ? detectedParkNames : activeChip === 'sua' ? detectedSUANames : []
                            const td = TERRAIN_DATA[activeChip]
                            return (
                              <div
                                onMouseEnter={() => setActiveChip(activeChip)}
                                onMouseLeave={() => setActiveChip(null)}
                                style={{
                                  position: 'absolute', bottom: 'calc(100% + 10px)', left: 0, right: 0,
                                  zIndex: 10010,
                                  background: 'rgba(12,12,16,0.97)',
                                  backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
                                  border: `0.5px solid ${c.border}`,
                                  borderRadius: 14,
                                  padding: '14px 16px',
                                  boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
                                  pointerEvents: 'auto',
                                }}>
                                {/* Header */}
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                                  <div style={{ fontSize: 13, fontWeight: 700, color: c.accent, letterSpacing: '0.2px' }}>{td.label}</div>
                                  <span onClick={() => setActiveChip(null)} style={{ fontSize: 16, color: 'rgba(255,255,255,0.3)', cursor: 'pointer', padding: '0 4px', lineHeight: 1 }}>✕</span>
                                </div>
                                {activeChip === 'sua' && (
                                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginBottom: 10, lineHeight: 1.4 }}>
                                    Your route passes through or crosses the boundary of the following airspaces. Each requires a specific action before flight.
                                  </div>
                                )}

                                {/* SUA — smart breakdown by airspace type */}
                                {activeChip === 'sua' && names.length > 0 ? (() => {
                                  const SUA_TYPES = [
                                    { key: 'P',   match: n => /^P[-\s]/i.test(n),   label: 'Prohibited Area',         color: '#FF3B30', desc: 'Flight strictly prohibited. Do not enter under any circumstances.', action: 'Do not enter — no exceptions' },
                                    { key: 'R',   match: n => /^R[-\s]/i.test(n),   label: 'Restricted Area',         color: '#FF9500', desc: 'Hazardous activities (live fire, missiles). Entry requires ATC clearance — check NOTAM for active times.', action: 'Obtain clearance or reroute' },
                                    { key: 'MOA', match: n => /MOA/i.test(n),        label: 'Military Ops Area (MOA)', color: '#FFD60A', desc: 'High-speed military training. VFR flight is legal but contact controlling agency (usually Center) for advisories.', action: 'Call ATC Center for advisory' },
                                    { key: 'W',   match: n => /^W[-\s]/i.test(n),   label: 'Warning Area',            color: '#5AC8FA', desc: 'Offshore international airspace with hazardous activity. Similar to Restricted but no clearance authority — avoid or proceed with extreme caution.', action: 'Avoid or monitor advisory' },
                                    { key: 'A',   match: n => /^A[-\s]/i.test(n),   label: 'Alert Area',              color: '#AF52DE', desc: 'Unusually high volume of flight training or unusual aerial activity. Pilots must be especially vigilant.', action: 'Extra vigilance — see and avoid' },
                                  ]
                                  const grouped = SUA_TYPES.map(t => ({
                                    ...t,
                                    names: names.filter(t.match),
                                  })).filter(t => t.names.length > 0)

                                  return (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                      {grouped.map(g => (
                                        <div key={g.key} style={{ borderRadius: 8, background: 'rgba(255,255,255,0.04)', padding: '9px 11px' }}>
                                          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 }}>
                                            <div style={{ width: 8, height: 8, borderRadius: '50%', background: g.color, flexShrink: 0 }} />
                                            <span style={{ fontSize: 11, fontWeight: 700, color: g.color, letterSpacing: '0.3px' }}>{g.label}</span>
                                          </div>
                                          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginBottom: 5, fontFamily: 'monospace', lineHeight: 1.4 }}>
                                            {g.names.join('  ·  ')}
                                          </div>
                                          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)', lineHeight: 1.45, marginBottom: 5 }}>{g.desc}</div>
                                          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                            <div style={{ width: 3, height: 3, borderRadius: '50%', background: g.color, flexShrink: 0 }} />
                                            <span style={{ fontSize: 10.5, fontWeight: 600, color: g.color }}>{g.action}</span>
                                          </div>
                                        </div>
                                      ))}
                                      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', textAlign: 'center', marginTop: 2 }}>
                                        Always verify active status via NOTAM · 1800wxbrief
                                      </div>
                                    </div>
                                  )
                                })() : (
                                  /* Generic checklist for non-SUA chips */
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    {td.items.map((item, i) => (
                                      <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                                        <div style={{ width: 18, height: 18, borderRadius: 4, border: `1px solid ${c.border}`, flexShrink: 0, marginTop: 1,
                                          display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                          <div style={{ width: 6, height: 6, borderRadius: '50%', background: c.accent, opacity: 0.5 }} />
                                        </div>
                                        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.75)', lineHeight: 1.5 }}>{item}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )
                          })()}

                          {/* References button — pushed to right */}
                          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'flex-end', flexShrink: 0 }}>
                            <button onClick={() => setShowRefs(r => !r)} style={{
                              background: showRefs ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.07)',
                              border: '0.5px solid rgba(255,255,255,0.15)',
                              borderRadius: 8, color: 'rgba(255,255,255,0.7)',
                              fontSize: 11, fontWeight: 700, letterSpacing: '0.5px',
                              padding: '8px 13px', cursor: 'pointer', whiteSpace: 'nowrap',
                            }}>REFS ↗</button>
                          </div>
                        </div>
                      </div>

                      {/* References sheet */}
                      {showRefs && (
                        <div style={{
                          position: 'absolute', bottom: 242, left: 'auto', right: 16, zIndex: 10002,
                          width: 260,
                          background: 'rgba(14,14,18,0.97)', backdropFilter: 'blur(20px)',
                          border: '0.5px solid rgba(255,255,255,0.1)', borderRadius: 12,
                          overflow: 'hidden',
                        }}>
                          <div style={{ padding: '11px 15px 8px', borderBottom: '0.5px solid rgba(255,255,255,0.07)' }}>
                            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.7px', color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase' }}>NOTAM &amp; TFR References</span>
                          </div>
                          {REFS.map((r, i) => (
                            <a key={r.url} href={r.url} target="_blank" rel="noreferrer" style={{
                              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                              padding: '11px 15px',
                              borderTop: i > 0 ? '0.5px solid rgba(255,255,255,0.06)' : 'none',
                              textDecoration: 'none',
                            }}>
                              <div>
                                <div style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>{r.label}</div>
                                <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>{r.sub}</div>
                              </div>
                              <svg width={12} height={12} viewBox="0 0 24 24" fill="none" style={{ color: 'rgba(255,255,255,0.3)', flexShrink: 0, marginLeft: 10 }}>
                                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                                <polyline points="15 3 21 3 21 9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                                <line x1="10" y1="14" x2="21" y2="3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                              </svg>
                            </a>
                          ))}
                          <div style={{ padding: '8px 15px 10px', borderTop: '0.5px solid rgba(255,255,255,0.06)' }}>
                            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.22)', fontStyle: 'italic' }}>NOTAMs change daily — always check day of flight.</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })()}
              </>)
            })()}
          </div>
        )}

        {/* ── Altitude calculator ── */}
        {altitudes && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, marginTop: 12 }}>
            <span style={{
              fontSize: 12, fontWeight: 700, color: 'var(--text)',
              background: 'var(--bg-card-2)', border: '0.5px solid var(--border)',
              borderRadius: 20, padding: '4px 10px', whiteSpace: 'nowrap',
            }}>
              {isEast ? '↗ Eastbound' : '↙ Westbound'}
            </span>
          </div>
        )}

        {altitudes && (
          <>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 8 }}>
              {isEast ? 'Odd thousands + 500 ft' : 'Even thousands + 500 ft'}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {altitudes.map(alt => {
                const selected = selectedAlt === alt
                return (
                  <button key={alt} onClick={() => {
                  const next = selected ? null : alt
                  setSelectedAlt(next)
                  get('settings', 'route').then(r => {
                    if (r) put('settings', { ...r, cruiseAlt: next }).catch(() => {})
                  })
                }} style={{
                    background: selected ? 'var(--text)' : 'var(--bg-card-2)',
                    border: `0.5px solid ${selected ? 'var(--text)' : 'var(--border)'}`,
                    borderRadius: 8, padding: '7px 0',
                    fontSize: 13, fontWeight: 600,
                    color: selected ? 'var(--bg)' : 'var(--text)',
                    cursor: 'pointer', transition: 'all 0.18s', textAlign: 'center',
                  }}>
                    {alt.toLocaleString()} ft
                  </button>
                )
              })}
            </div>
            {selectedAlt && (
              <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 9, background: 'var(--bg-card-2)', border: '0.5px solid var(--border)' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                  Planned: {selectedAlt.toLocaleString()} ft MSL
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
                  {direction} · {isEast ? 'Odd' : 'Even'} thousands + 500 ft · §91.159
                </div>
              </div>
            )}
            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
              Above 18,000 ft MSL is Class A airspace, IFR only.
            </div>
          </>
        )}
      </div>

      <div style={{ borderTop: '0.5px solid var(--border)', padding: '10px 12px 12px' }}>
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 8 }}>For reference</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <a href="https://www.faa.gov/air_traffic/publications/atpubs/aim_html/chap4_section_4.html#$paragraph4-4-6" target="_blank" rel="noreferrer" style={{ flex: 1, textAlign: 'center', padding: '8px 0', borderRadius: 9, border: '0.5px solid var(--border)', background: 'var(--bg-card-2)', textDecoration: 'none', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>
            AIM 4-4-6
          </a>
          <a href="https://www.ecfr.gov/current/title-14/chapter-I/subchapter-F/part-91/subpart-B/section-91.159" target="_blank" rel="noreferrer" style={{ flex: 1, textAlign: 'center', padding: '8px 0', borderRadius: 9, border: '0.5px solid var(--border)', background: 'var(--bg-card-2)', textDecoration: 'none', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>
            14 CFR §91.159
          </a>
        </div>
      </div>
      <DoneButton isChecked={isChecked} onDone={() => { onToggle(item.id); setOpen(false) }} />
    </ExpandableCard>
  )
}

/* ── VFR Chart map ───────────────────────────────────────────── */
/* ── Skeleton bone ───────────────────────────────────────────── */
function Bone({ w = '100%', h = 14, r = 6, mb = 0 }) {
  return (
    <div style={{
      width: w, height: h, borderRadius: r,
      background: 'var(--border)',
      animation: 'skeleton-pulse 1.4s ease-in-out infinite',
      marginBottom: mb,
      flexShrink: 0,
    }} />
  )
}

function fmtZ(iso) {
  if (!iso) return null
  const d = new Date(iso)
  return d.getUTCHours().toString().padStart(2,'0') + ':' + d.getUTCMinutes().toString().padStart(2,'0') + 'Z'
}

// FAA chart code → human label + sort order
// codes from d-TPP metafile: APD, IAP, DP, DAU (DP AAUP), STR (STAR), MIN, HOT, LAHSO
const CHART_META = {
  APD:   { label: 'Airport Diagram',  order: 0 },
  IAP:   { label: 'Approaches',       order: 1 },
  DP:    { label: 'Departures',       order: 2 },
  DAU:   { label: 'DP AAUP',          order: 3 },
  STR:   { label: 'Arrivals (STAR)',  order: 4 },
  MIN:   { label: 'Minimums',         order: 5 },
  HOT:   { label: 'Hot Spots',        order: 6 },
  LAHSO: { label: 'LAHSO',            order: 7 },
}
// Bundled FAA charts index (cycle 2606, ~1MB, updates with each airac cycle)
const FAA_CHART_CYCLE = '2606'

function ChartsItem({ item, isChecked, onToggle }) {
  const [open, setOpen]           = useState(false)
  const [tab, setTab]             = useState('dep')   // 'dep' | 'arr'
  const [depIcao, setDepIcao]     = useState(null)
  const [arrIcao, setArrIcao]     = useState(null)
  // per-tab data: { airport, sun, faaCharts, loading, error, openGroup }
  const [depState, setDepState]   = useState({ airport: null, sun: null, faaCharts: null, loading: false, error: null, openGroup: null })
  const [arrState, setArrState]   = useState({ airport: null, sun: null, faaCharts: null, loading: false, error: null, openGroup: null })

  const active   = tab === 'dep' ? depState : arrState
  const setActive = tab === 'dep' ? setDepState : setArrState

  // Load route ICAOs when card opens
  useEffect(() => {
    if (!open) return
    get('settings', 'route').then(r => {
      if (r?.dep)  setDepIcao(r.dep.toUpperCase())
      if (r?.dest) setArrIcao(r.dest.toUpperCase())
    })
  }, [open])

  // Load airport data when tab becomes active and icao is known but not yet loaded
  useEffect(() => {
    const icao = tab === 'dep' ? depIcao : arrIcao
    const state = tab === 'dep' ? depState : arrState
    if (!icao || state.airport || state.loading || state.error) return
    loadAirport(icao, tab === 'dep' ? setDepState : setArrState)
  }, [tab, depIcao, arrIcao])

  async function loadAirport(icao, setState) {
    setState(s => ({ ...s, loading: true, error: null }))
    try {
      const apt = await lookupAirport(icao)
      setState(s => ({ ...s, airport: apt, loading: false }))
      // Sunrise
      if (apt.lat && apt.lon) {
        fetch(`https://api.open-meteo.com/v1/forecast?latitude=${apt.lat}&longitude=${apt.lon}&timezone=auto&forecast_days=0`)
          .then(r => r.json())
          .then(tzData => {
            const tz = tzData?.timezone || null
            const localDate = tz
              ? new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
              : new Date().toISOString().slice(0, 10)
            return fetch(`https://api.sunrise-sunset.org/json?lat=${apt.lat}&lng=${apt.lon}&date=${localDate}&formatted=0`)
              .then(r => r.json())
              .then(sunData => { if (sunData?.status === 'OK') setState(s => ({ ...s, sun: { ...sunData.results, tz } })) })
          })
          .catch(() => {
            fetch(`https://api.sunrise-sunset.org/json?lat=${apt.lat}&lng=${apt.lon}&date=today&formatted=0`)
              .then(r => r.json())
              .then(d => { if (d?.status === 'OK') setState(s => ({ ...s, sun: { ...d.results, tz: null } })) })
              .catch(() => {})
          })
      }
      // FAA charts
      const rawIdent = (apt.faaId || apt.icaoId || icao).replace(/^K/, '').toUpperCase()
      const charts = (FAA_CHARTS_DATA[rawIdent] || []).map(([chart_code, chart_name, pdf_name]) => ({ chart_code, chart_name, pdf_name }))
      setState(s => ({ ...s, faaCharts: { edition: FAA_CHART_CYCLE, charts } }))
    } catch {
      setState(s => ({ ...s, loading: false, error: 'Airport not found' }))
    }
  }

  const airport  = active.airport
  const sun      = active.sun
  const faaCharts = active.faaCharts
  const loading  = active.loading
  const openGroup = active.openGroup

  const lat    = airport?.lat ? parseFloat(airport.lat).toFixed(4) : null
  const lon    = airport?.lon ? parseFloat(airport.lon).toFixed(4) : null
  const svBase = lat && lon ? `?ll=${lat},${lon}` : ''
  const svPage = airport ? `https://skyvector.com/airport/${airport.icaoId}` : 'https://skyvector.com'

  const routeLoaded = depIcao || arrIcao

  return (
    <ExpandableCard item={item} isChecked={isChecked} onToggle={onToggle} open={open} setOpen={setOpen}>

          {/* Segmented tab switcher */}
          {routeLoaded && (
            <div style={{ padding: '10px 12px 0' }}>
              <div onClick={() => setTab(t => t === 'dep' ? 'arr' : 'dep')} style={{
                position: 'relative', display: 'flex',
                background: 'var(--bg-card-2)', borderRadius: 12, padding: 3,
                cursor: 'pointer', userSelect: 'none',
              }}>
                {/* Sliding pill */}
                <div style={{
                  position: 'absolute', top: 3, bottom: 3,
                  width: 'calc(50% - 3px)',
                  left: tab === 'dep' ? 3 : 'calc(50%)',
                  background: 'var(--accent)', borderRadius: 9,
                  transition: 'left 0.22s cubic-bezier(0.4,0,0.2,1)',
                  pointerEvents: 'none',
                }} />
                {[
                  { key: 'dep', label: 'Takeoff', icao: depIcao },
                  { key: 'arr', label: 'Arrival', icao: arrIcao },
                ].map(t => (
                  <div key={t.key} style={{
                    flex: 1, padding: '6px 10px', zIndex: 1,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'color 0.22s',
                    color: tab === t.key ? 'var(--accent-fg)' : 'var(--text-secondary)',
                  }}>
                    <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'monospace', letterSpacing: '1px' }}>
                      {t.icao || '—'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Manual search — only shown if no route airports */}
          {!routeLoaded && (
          <div style={{ padding: '12px 12px 10px', position: 'relative' }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 8 }}>
              ICAO Airport
            </div>
            <div style={{ position: 'relative' }}>
              <input
                value={''}
                onChange={() => {}}
                placeholder="Set a route first, or search…"
                style={{
                  width: '100%', background: 'var(--bg-card-2)', border: '0.5px solid var(--border)',
                  borderRadius: 9,
                  padding: '10px 12px', color: 'var(--text)',
                  fontSize: 14, outline: 'none', boxSizing: 'border-box',
                }}
              />
              {loading && (
                <div style={{
                  position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                  fontSize: 12, color: 'var(--text-tertiary)',
                }}>…</div>
              )}
            </div>

          </div>
          )}

          {/* Loading skeleton */}
          {active.error && (
            <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--danger)' }}>{active.error}</div>
          )}

          {loading && (
            <div style={{ borderTop: '0.5px solid var(--border)', padding: '14px 12px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Bone w={56} h={22} r={4} />
                <Bone w={70} h={16} r={20} />
              </div>
              <Bone w="75%" h={14} r={5} />
              <Bone w="40%" h={11} r={4} />

              {/* Facts grid */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 4 }}>
                <Bone h={44} r={8} />
                <Bone h={44} r={8} />
              </div>

              {/* Sun row */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                <Bone h={44} r={8} />
                <Bone h={44} r={8} />
                <Bone h={44} r={8} />
                <Bone h={44} r={8} />
              </div>

              {/* Frequencies */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                {[80, 60, 90, 55, 70].map((w, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Bone w={`${w}px`} h={12} r={4} />
                    <Bone w="52px" h={14} r={4} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Airport result */}
          {!loading && airport && (
            <>
              {/* Header */}
              <div style={{ padding: '12px 12px 8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', fontFamily: '"SF Mono", monospace', letterSpacing: '1px' }}>
                      {airport.icaoId}
                    </span>
                    {airport.tower != null && (
                      <span style={{
                        fontSize: 10, fontWeight: 700, letterSpacing: '0.4px', textTransform: 'uppercase',
                        color: airport.tower ? 'var(--ok)' : 'var(--text-tertiary)',
                        background: airport.tower ? 'var(--ok-light)' : 'var(--bg-card-2)',
                        border: `0.5px solid ${airport.tower ? 'var(--ok)' : 'var(--border)'}`,
                        borderRadius: 20, padding: '2px 7px',
                      }}>{airport.tower ? 'Towered' : 'Uncontrolled'}</span>
                    )}
                  </div>
                  <a href={svPage} target="_blank" rel="noreferrer" style={{
                    fontSize: 11, fontWeight: 600, color: 'var(--accent)',
                    textDecoration: 'none',
                  }}>SkyVector ↗</a>
                </div>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', marginTop: 3 }}>{airport.name}</div>
                {(airport.state || airport.country) && (
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
                    {[airport.state, airport.country].filter(Boolean).join(', ')}
                  </div>
                )}
              </div>

              {/* Key facts — compact row */}
              {(airport.elev || lat) && (
                <div style={{ padding: '0 12px 10px', display: 'flex', gap: 6 }}>
                  {airport.elev && (
                    <div style={{ background: 'var(--bg-card-2)', borderRadius: 8, padding: '6px 10px', flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{airport.elev}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.3px', marginTop: 2 }}>Elevation</div>
                    </div>
                  )}
                  {lat && lon && (
                    <div style={{ background: 'var(--bg-card-2)', borderRadius: 8, padding: '6px 10px', flex: 2 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', fontFamily: 'monospace' }}>{fmtAvCoord(parseFloat(lat), parseFloat(lon))}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.3px', marginTop: 2 }}>Coordinates</div>
                    </div>
                  )}
                </div>
              )}

              {/* Sunrise / Sunset */}
              {sun && (() => {
                // Format ISO → local time at airport using IANA tz, fallback to UTC
                function fmtLocal(iso) {
                  if (!iso) return '—'
                  try {
                    const d = new Date(iso)
                    const fmt = new Intl.DateTimeFormat('en-US', {
                      hour: 'numeric', minute: '2-digit', hour12: true,
                      timeZone: sun.tz || undefined,
                    })
                    return fmt.format(d).toLowerCase().replace(' ', ' ') // narrow no-break space
                  } catch {
                    return fmtZ(iso)
                  }
                }

                // Reference-matched icons: solid circle sun, short rays, horizon, double-chevron arrows
                const SunriseIcon = ({ size = 30 }) => (
                  <svg width={size} height={size} viewBox="0 0 32 28" fill="none" strokeLinecap="round" strokeLinejoin="round" stroke="currentColor" strokeWidth="1.9" style={{ color: 'var(--text)' }}>
                    {/* solid sun circle */}
                    <circle cx="16" cy="10" r="3.2" fill="currentColor" stroke="none"/>
                    {/* rays — top, upper-L, upper-R, left, right */}
                    <line x1="16"  y1="2.5" x2="16"  y2="5.2"/>
                    <line x1="9.2" y1="4.8" x2="11.1" y2="6.7"/>
                    <line x1="22.8" y1="4.8" x2="20.9" y2="6.7"/>
                    <line x1="7"   y1="10"  x2="9.8"  y2="10"/>
                    <line x1="25"  y1="10"  x2="22.2" y2="10"/>
                    {/* horizon */}
                    <line x1="2" y1="16" x2="30" y2="16" strokeWidth="1.7"/>
                    {/* double upward chevron */}
                    <polyline points="7,24.5 16,19 25,24.5"/>
                    <polyline points="7,28   16,22.5 25,28" opacity="0.45"/>
                  </svg>
                )

                const SunsetIcon = ({ size = 30 }) => (
                  <svg width={size} height={size} viewBox="0 0 32 28" fill="none" strokeLinecap="round" strokeLinejoin="round" stroke="currentColor" strokeWidth="1.9" style={{ color: 'var(--text)' }}>
                    {/* solid sun circle */}
                    <circle cx="16" cy="10" r="3.2" fill="currentColor" stroke="none"/>
                    {/* rays */}
                    <line x1="16"  y1="2.5" x2="16"  y2="5.2"/>
                    <line x1="9.2" y1="4.8" x2="11.1" y2="6.7"/>
                    <line x1="22.8" y1="4.8" x2="20.9" y2="6.7"/>
                    <line x1="7"   y1="10"  x2="9.8"  y2="10"/>
                    <line x1="25"  y1="10"  x2="22.2" y2="10"/>
                    {/* horizon */}
                    <line x1="2" y1="16" x2="30" y2="16" strokeWidth="1.7"/>
                    {/* double downward chevron */}
                    <polyline points="7,19 16,24.5 25,19"/>
                    <polyline points="7,22.5 16,28 25,22.5" opacity="0.45"/>
                  </svg>
                )

                return (
                  <div style={{ borderTop: '0.5px solid var(--border)', padding: '14px 12px 10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-around' }}>

                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, opacity: 0.45 }}>
                        <SunriseIcon size={26} />
                        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', fontFamily: 'monospace' }}>{fmtLocal(sun.civil_twilight_begin)}</span>
                        <span style={{ fontSize: 9, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Civil dawn</span>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                        <SunriseIcon size={30} />
                        <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)', fontFamily: 'monospace' }}>{fmtLocal(sun.sunrise)}</span>
                        <span style={{ fontSize: 9, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Sunrise</span>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                        <SunsetIcon size={30} />
                        <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)', fontFamily: 'monospace' }}>{fmtLocal(sun.sunset)}</span>
                        <span style={{ fontSize: 9, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Sunset</span>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, opacity: 0.45 }}>
                        <SunsetIcon size={26} />
                        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', fontFamily: 'monospace' }}>{fmtLocal(sun.civil_twilight_end)}</span>
                        <span style={{ fontSize: 9, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Civil dusk</span>
                      </div>
                    </div>

                    <div style={{ textAlign: 'center', marginTop: 7, fontSize: 10, color: 'var(--text-tertiary)' }}>
                      {sun.tz ? sun.tz.replace(/_/g, ' ') : 'UTC'} · Night §61.57: civil dusk → dawn
                    </div>
                  </div>
                )
              })()}

              {/* Frequencies — collapsible, styled like chart groups */}
              {airport.frequencies?.length > 0 && (() => {
                const FreqToggle = () => {
                  const [open, setOpen] = useState(false)
                  return (
                    <div style={{ borderTop: '0.5px solid var(--border)', borderRadius: open ? '0 0 10px 10px' : undefined }}>
                      <button onClick={() => setOpen(o => !o)} style={{
                        width: '100%', display: 'flex', alignItems: 'center',
                        justifyContent: 'space-between', padding: '10px 12px',
                        background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>Frequencies</span>
                          <span style={{ fontSize: 11, color: 'var(--text-tertiary)',
                            background: 'var(--bg-card-2)', borderRadius: 10, padding: '1px 7px' }}>
                            {airport.frequencies.length}
                          </span>
                        </div>
                        <span style={{ fontSize: 12, color: 'var(--text-tertiary)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▾</span>
                      </button>
                      {open && (
                        <div style={{ borderTop: '0.5px solid var(--border)' }}>
                          {airport.frequencies.map((f, i) => (
                            <div key={i} style={{
                              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                              padding: '9px 12px',
                              borderTop: i > 0 ? '0.5px solid var(--border)' : 'none',
                              background: 'var(--bg-card-2)',
                            }}>
                              <span style={{ fontSize: 12, color: 'var(--text)', fontWeight: 500 }}>{f.type}</span>
                              <span style={{ fontSize: 14, fontWeight: 700, fontFamily: 'monospace', color: 'var(--text)' }}>{f.freq}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                }
                return <FreqToggle />
              })()}


              {/* FAA Official Charts */}
              {faaCharts && (() => {
                const pdfBase = `https://aeronav.faa.gov/d-tpp/${faaCharts?.edition || ''}/`
                // Group charts by code, sorted by order
                const grouped = {}
                ;(faaCharts?.charts || []).forEach(c => {
                  const code = c.chart_code || 'OTHER'
                  if (!grouped[code]) grouped[code] = []
                  grouped[code].push(c)
                })
                const sortedCodes = Object.keys(grouped).sort((a, b) =>
                  (CHART_META[a]?.order ?? 99) - (CHART_META[b]?.order ?? 99)
                )
                const apd = grouped['APD']?.[0]
                return (
                  <div style={{ borderTop: '0.5px solid var(--border)', padding: '12px 12px 4px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>
                        FAA Official Charts
                      </div>
                      {faaCharts?.edition && (
                        <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>Cycle {faaCharts.edition}</div>
                      )}
                    </div>

                    {faaCharts?.charts.length === 0 && (
                      <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 10 }}>No charts found for this airport.</div>
                    )}

                    {apd && (
                      /* Airport Diagram — prominent hero card */
                      <a href={pdfBase + apd.pdf_name} target="_blank" rel="noreferrer" style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        background: 'var(--accent-light)', border: '0.5px solid var(--accent)',
                        borderRadius: 12, padding: '12px 14px', marginBottom: 10,
                        textDecoration: 'none',
                      }}>
                        <div style={{ width: 36, height: 36, flexShrink: 0,
                          display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <img src="/aeropuerto.png" alt="Airport Diagram"
                            style={{ width: '80%', height: '80%', objectFit: 'contain', filter: 'brightness(0) invert(1)' }} />
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)' }}>Airport Diagram</div>
                          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 1 }}>
                            {airport?.icaoId} · Official FAA · PDF
                          </div>
                        </div>
                        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" style={{ color: 'var(--accent)', flexShrink: 0 }}>
                          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                          <polyline points="15 3 21 3 21 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          <line x1="10" y1="14" x2="21" y2="3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                        </svg>
                      </a>
                    )}

                    {/* Other chart groups */}
                    {sortedCodes.filter(c => c !== 'APD').map(code => {
                      const charts = grouped[code]
                      const meta = CHART_META[code] || { label: code }
                      const isOpen = openGroup === code
                      return (
                        <div key={code} style={{ marginBottom: 4, border: '0.5px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
                          <button
                            onClick={() => setActive(s => ({ ...s, openGroup: isOpen ? null : code }))}
                            style={{
                              width: '100%', display: 'flex', alignItems: 'center',
                              justifyContent: 'space-between', padding: '10px 12px',
                              background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
                            }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>{meta.label}</span>
                              <span style={{ fontSize: 11, color: 'var(--text-tertiary)',
                                background: 'var(--bg-card-2)', borderRadius: 10, padding: '1px 7px' }}>
                                {charts.length}
                              </span>
                            </div>
                            <span style={{ fontSize: 12, color: 'var(--text-tertiary)', transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▾</span>
                          </button>
                          {isOpen && (
                            <div style={{ borderTop: '0.5px solid var(--border)' }}>
                              {charts.map((c, i) => (
                                <a key={c.pdf_name} href={pdfBase + c.pdf_name} target="_blank" rel="noreferrer" style={{
                                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                  padding: '9px 12px',
                                  borderTop: i > 0 ? '0.5px solid var(--border)' : 'none',
                                  textDecoration: 'none', background: 'var(--bg-card-2)',
                                }}>
                                  <span style={{ fontSize: 12, color: 'var(--text)', fontWeight: 500, lineHeight: 1.4, paddingRight: 8 }}>
                                    {c.chart_name}
                                  </span>
                                  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" style={{ color: 'var(--text-tertiary)', flexShrink: 0 }}>
                                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                                    <polyline points="15 3 21 3 21 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                    <line x1="10" y1="14" x2="21" y2="3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                                  </svg>
                                </a>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                    <div style={{ height: 8 }} />
                  </div>
                )
              })()}

              {/* Open charts */}
              <div style={{ borderTop: '0.5px solid var(--border)', padding: '10px 12px 12px' }}>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 8 }}>Open charts</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {[
                    { label: 'Sectional', url: `https://skyvector.com/${svBase}&chart=301&zoom=2` },
                    { label: 'IFR',       url: `https://skyvector.com/${svBase}&chart=302&zoom=2` },
                    {
                      label: 'A/FD',
                      url: airport
                        ? `https://www.faa.gov/air_traffic/flight_info/aeronav/digital_products/dafd/search/advanced/?ident=${(airport.faaId || airport.icaoId || '').replace(/^K/, '')}`
                        : 'https://www.faa.gov/air_traffic/flight_info/aeronav/digital_products/dafd/search/advanced/',
                    },
                  ].map(cl => (
                    <a key={cl.label} href={cl.url} target="_blank" rel="noreferrer" style={{
                      flex: 1, textAlign: 'center', padding: '8px 0',
                      borderRadius: 9, border: '0.5px solid var(--border)',
                      background: 'var(--bg-card-2)', textDecoration: 'none',
                      fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)',
                    }}>{cl.label}</a>
                  ))}
                </div>
                {airport && (
                  <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 6, textAlign: 'center' }}>
                    A/FD opens pre-filled for {airport.icaoId}
                  </div>
                )}
              </div>
            </>
          )}

          <DoneButton isChecked={isChecked} onDone={() => { onToggle(item.id); setOpen(false) }} />
    </ExpandableCard>
  )
}

/* ── NOTAM / TFR panel ───────────────────────────────────────── */
function NotamItem({ item, isChecked, onToggle }) {
  const [open, setOpen] = useState(false)
  const NOTAM_LINKS = [
    { label: 'FAA NOTAM Search', sub: 'Official FAA NOTAM system', url: 'https://notams.aim.faa.gov/notamSearch/' },
    { label: 'FAA TFR Map', sub: 'Active TFRs plotted on a map', url: 'https://tfr.faa.gov/tfr2/list.html' },
    { label: '1800wxbrief.com', sub: 'Leidos flight service — full preflight briefing', url: 'https://www.1800wxbrief.com' },
    { label: 'SkyVector', sub: 'NOTAMs and TFRs overlaid on chart', url: 'https://skyvector.com' },
  ]
  const TFR_TYPES = [
    { label: 'VIP / POTUS movement', color: '#FF3B30' },
    { label: 'Wildfire / disaster area', color: '#FF9500' },
    { label: 'Air show / sporting event', color: '#5856D6' },
    { label: 'Security / military exercise', color: '#FF3B30' },
    { label: 'Space launch operations', color: '#AF52DE' },
  ]

  return (
    <ExpandableCard item={item} isChecked={isChecked} onToggle={onToggle} open={open} setOpen={setOpen}>
          {/* TFR types reminder */}
          <div style={{ padding: '14px 14px 10px' }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 10 }}>
              Common TFR Types
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {TFR_TYPES.map((t, i) => (
                <div key={t.label} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 0',
                  borderTop: i > 0 ? '0.5px solid var(--border)' : 'none',
                }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: t.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500 }}>{t.label}</span>
                </div>
              ))}
            </div>
          </div>
          {/* NOTAM links */}
          <div style={{ borderTop: '0.5px solid var(--border)', padding: '14px 14px 4px' }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 10 }}>
              Check NOTAMs
            </div>
            {NOTAM_LINKS.map((nl, i) => (
              <a key={nl.url} href={nl.url} target="_blank" rel="noreferrer" style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 0', borderTop: i > 0 ? '0.5px solid var(--border)' : 'none',
                textDecoration: 'none',
              }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{nl.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 1 }}>{nl.sub}</div>
                </div>
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" style={{ color: 'var(--text-tertiary)', flexShrink: 0 }}>
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  <polyline points="15 3 21 3 21 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  <line x1="10" y1="14" x2="21" y2="3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </a>
            ))}
          </div>
          <div style={{ borderTop: '0.5px solid var(--border)', padding: '10px 14px 10px', marginTop: 4 }}>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>NOTAMs change daily — always check on the day of flight.</div>
          </div>
          <DoneButton isChecked={isChecked} onDone={() => { onToggle(item.id); setOpen(false) }} />
    </ExpandableCard>
  )
}

/* ── NOTAM helpers ───────────────────────────────────────────── */
function notamCategory(text) {
  if (!text) return 'OTHER'
  const t = text.toUpperCase()
  if (/\bRWY\b|\bRUNWAY\b/.test(t))              return 'RWY'
  if (/\bTWY\b|\bTAXIWAY\b/.test(t))             return 'TWY'
  if (/\bNAV\b|ILS|VOR|NDB|ATIS|AWOS/.test(t))   return 'NAV'
  if (/\bOBST\b|\bCRANE\b|\bTOWER\b/.test(t))    return 'OBST'
  if (/\bAPCH\b|\bIAP\b|APPROACH/.test(t))        return 'APCH'
  if (/\bAD\b|AIRPORT\b|APRON/.test(t))           return 'AD'
  if (/\bTFR\b/.test(t))                          return 'TFR'
  return 'OTHER'
}

const NOTAM_CAT_COLOR = {
  RWY: '#FF9500', TWY: '#FF9500', NAV: 'var(--accent)',
  OBST: 'var(--danger)', APCH: 'var(--accent)', AD: 'var(--text-secondary)',
  TFR: 'var(--danger)', OTHER: 'var(--text-tertiary)',
}

function NotamSection({ icao, CheckRow }) {
  const [workerUrl, setWorkerUrl]     = useState(() => localStorage.getItem('notam_worker_url') || '')
  const [showSetup, setShowSetup]     = useState(false)
  const [urlInput, setUrlInput]       = useState('')
  const [notams, setNotams]           = useState(null)
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState(null)

  useEffect(() => {
    if (!workerUrl || !icao || icao === 'XXXX') return
    setLoading(true)
    setError(null)
    fetch(`${workerUrl.replace(/\/$/, '')}?icao=${icao}`)
      .then(r => r.json())
      .then(data => { setNotams(data?.items || []); setLoading(false) })
      .catch(() => { setError('Could not reach the NOTAM worker — check the URL'); setLoading(false) })
  }, [workerUrl, icao])

  const saveUrl = () => {
    const trimmed = urlInput.trim()
    localStorage.setItem('notam_worker_url', trimmed)
    setWorkerUrl(trimmed)
    setShowSetup(false)
    setNotams(null)
  }

  // No worker configured
  if (!workerUrl && !showSetup) return (
    <div style={{ padding: '12px 14px' }}>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4, lineHeight: 1.6 }}>
        Deploy the free NOTAM worker once to load live NOTAMs inline.
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 12, lineHeight: 1.6 }}>
        The worker file is at <strong style={{ color: 'var(--text-secondary)', fontFamily: 'monospace' }}>notam-worker/worker.js</strong> in your project.
        Deploy it to Cloudflare Workers (free), add your FAA API credentials as env vars, then paste the Worker URL below.
      </div>
      <button onClick={() => { setShowSetup(true); setUrlInput(workerUrl) }}
        style={{ background: 'var(--accent)', color: 'var(--bg)', border: 'none', borderRadius: 8,
          padding: '7px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
        Enter Worker URL
      </button>
      <CheckRow id="apt-notam" label="NOTAMs checked" />
    </div>
  )

  // URL input form
  if (showSetup) return (
    <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Cloudflare Worker URL</div>
      <input value={urlInput} onChange={e => setUrlInput(e.target.value)}
        placeholder="https://pqrh-notam.yourname.workers.dev"
        style={{ background: 'var(--bg-card-2)', border: '0.5px solid var(--border)', borderRadius: 7,
          padding: '8px 10px', fontSize: 12, color: 'var(--text)', outline: 'none', fontFamily: 'monospace' }} />
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={saveUrl} disabled={!urlInput.trim()}
          style={{ flex: 1, background: 'var(--accent)', color: 'var(--bg)', border: 'none', borderRadius: 7,
            padding: '8px 0', fontSize: 12, fontWeight: 700, cursor: 'pointer',
            opacity: !urlInput.trim() ? 0.4 : 1 }}>
          Save
        </button>
        <button onClick={() => setShowSetup(false)}
          style={{ background: 'var(--bg-card-2)', color: 'var(--text-tertiary)', border: 'none',
            borderRadius: 7, padding: '8px 14px', fontSize: 12, cursor: 'pointer' }}>
          Cancel
        </button>
      </div>
    </div>
  )

  return (
    <>
      {loading && (
        <div style={{ padding: '12px 14px', fontSize: 11, color: 'var(--text-tertiary)' }}>Loading NOTAMs…</div>
      )}
      {error && !loading && (
        <div style={{ padding: '10px 14px' }}>
          <div style={{ fontSize: 11, color: 'var(--danger)', marginBottom: 6 }}>{error}</div>
          <button onClick={() => { setShowSetup(true); setUrlInput(workerUrl) }}
            style={{ fontSize: 11, color: 'var(--text-tertiary)', background: 'none', border: 'none',
              cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>
            Update Worker URL
          </button>
        </div>
      )}
      {!loading && notams && (
        <>
          <div style={{ padding: '8px 14px 4px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
              {notams.length} active NOTAM{notams.length !== 1 ? 's' : ''} for {icao}
            </span>
            <button onClick={() => { setShowSetup(true); setUrlInput(workerUrl) }}
              style={{ fontSize: 10, color: 'var(--text-tertiary)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
              Update
            </button>
          </div>
          {notams.length === 0 && (
            <div style={{ padding: '4px 14px 12px', fontSize: 12, color: 'var(--text-tertiary)' }}>No active NOTAMs.</div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '0 8px 10px' }}>
            {notams.map((n, i) => {
              const raw   = n.text || n.icaoMessage || n.traditionalMessage || ''
              const cat   = notamCategory(raw)
              const color = NOTAM_CAT_COLOR[cat] || 'var(--text-tertiary)'
              const eff   = n.startDate ? new Date(n.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + 'Z' : ''
              const exp   = n.endDate   ? new Date(n.endDate).toLocaleDateString('en-US',   { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + 'Z' : 'PERM'
              return (
                <div key={n.id ?? i} style={{ background: 'var(--bg-card-2)', borderRadius: 8, padding: '9px 11px', marginBottom: 2 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
                    <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.5px', color,
                      background: 'var(--bg)', borderRadius: 4, padding: '2px 6px',
                      border: `0.5px solid ${color}`, flexShrink: 0 }}>{cat}</span>
                    <span style={{ fontSize: 9, color: 'var(--text-tertiary)', fontFamily: 'monospace' }}>
                      {eff}{exp !== 'PERM' ? ` → ${exp}` : ' → PERM'}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-secondary)',
                    lineHeight: 1.55, wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>{raw}</div>
                </div>
              )
            })}
          </div>
        </>
      )}
      <CheckRow id="apt-notam" label="NOTAMs checked" />
    </>
  )
}

/* ── Airport checklist ───────────────────────────────────────── */

function AirportItem({ item, isChecked, onToggle }) {
  const [open, setOpen]             = useState(false)
  const [aptData, setAptData]       = useState(null)
  const [aptLoading, setAptLoading] = useState(false)
  const [aptError, setAptError]     = useState(null)
  const [freqOpen, setFreqOpen]     = useState(false)
  const [mapsOpen, setMapsOpen]     = useState(false)
  const [fboFreq, setFboFreq]       = useState(() => localStorage.getItem('apt_fbo_freq') || '')
  const [fboNote, setFboNote]       = useState(() => localStorage.getItem('apt_fbo_note') || '')
  const [checkedIds, setCheckedIds] = useState(new Set())
  const [destIcao, setDestIcao]     = useState('')


  const toggleSub = id => {
    setCheckedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const [landingRwy, setLandingRwy] = useState(null)
  const [aptWind, setAptWind]       = useState(null) // { dir, spd }

  useEffect(() => {
    Promise.all([
      get('settings', 'route'),
      get('settings', 'perfdist'),
    ]).then(([r, pd]) => {
      if (r?.dest) setDestIcao(r.dest.toUpperCase())
      if (pd?.arr?.selRwy) setLandingRwy(pd.arr.selRwy)
    })
  }, [open])

  useEffect(() => {
    if (!open || !destIcao) return
    proxyJSON(`${AWC}/metar?ids=${destIcao}&format=json&hours=3`)
      .then(data => {
        const m = Array.isArray(data) ? data[0] : null
        if (m?.wdir != null && m?.wspd != null) setAptWind({ dir: m.wdir, spd: m.wspd })
      })
      .catch(() => {})
  }, [open, destIcao])

  useEffect(() => {
    if (!open || !destIcao) return
    setAptLoading(true)
    setAptError(null)
    lookupAirport(destIcao)
      .then(d => { setAptData(d); setAptLoading(false) })
      .catch(() => { setAptError('Airport data unavailable'); setAptLoading(false) })
  }, [open, destIcao])


  const icao = destIcao || 'XXXX'

  const ExternalIcon = () => (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, color: 'var(--text-tertiary)' }}>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      <polyline points="15 3 21 3 21 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <line x1="10" y1="14" x2="21" y2="3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  )

  const TOOLTIPS = {
    'apt-cfs':    'Review the Chart Supplement (A/FD) for hours of operation, fuel availability, special procedures, and any remarks specific to this airport.',
    'apt-vtpc':   'Check the airport diagram for runway layout, taxiways, and hot spots. Confirm ATIS is received and current altimeter/active runway are noted.',
    'apt-hours':  'Verify the airport and any required services (tower, FBO, customs) are open for your planned arrival time.',
    'apt-taxi':   'Study the taxi chart before landing. Know your route from the runway to parking before you touch down.',
    'apt-taxi-a': 'Identify all runway incursion hot spots marked on the airport diagram. These are areas with a history of confusion or incidents.',
    'apt-taxi-b': 'Note your planned parking location — FBO ramp, transient parking, helipad, or customs ramp — so you taxi with purpose.',
    'apt-light':  'Confirm runway, taxiway, and ramp lighting is available and operational if arriving at night or in low visibility.',
    'apt-sat':    'Use the satellite view to familiarize yourself with the airport environment, surroundings, and any construction or obstacles not shown on charts.',
    'apt-notam':  'Check all active NOTAMs for this airport — runway closures, NAVAID outages, TFRs, and construction that may affect your arrival.',
    'apt-svc-a':  'Confirm fuel type and availability, oil if needed, parking arrangements, and any amenities required for crew or passengers.',
    'apt-caution':'Review any airport-specific cautions — noise abatement, bird activity, terrain, noise-sensitive areas, or special local procedures.',
    'apt-fbo':    'Contact the FBO in advance to confirm parking, ground handling, and any special arrival requirements.',
    'apt-fbo-a':  'Note the FBO ground frequency so you can call them on the radio during taxi-in for marshallers or parking guidance.',
  }

  const CheckRow = ({ id, label }) => {
    const done = checkedIds.has(id)
    const [hovered, setHovered] = useState(false)
    const tip = TOOLTIPS[id]
    return (
      <div style={{ position: 'relative' }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}>
        <button onClick={() => toggleSub(id)} style={{
          width: '100%', textAlign: 'left', background: 'transparent',
          border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 11,
          padding: '9px 14px', borderRadius: 8, transition: 'background 0.15s',
        }}>
          {/* Notion-style square checkbox */}
          <div style={{
            width: 16, height: 16, borderRadius: 4, flexShrink: 0,
            background: done ? 'var(--accent)' : 'transparent',
            border: `1.5px solid ${done ? 'var(--accent)' : 'var(--border-strong)'}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'all 0.18s',
          }}>
            {done && (
              <svg width={10} height={10} viewBox="0 0 12 12" fill="none">
                <polyline points="2,6 5,9 10,3" stroke="var(--accent-fg)" strokeWidth="1.8"
                  strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
          </div>
          <span style={{
            fontSize: 13, fontWeight: 500,
            color: 'var(--text)',
            textDecoration: done ? 'line-through' : 'none',
            transition: 'color 0.18s', flex: 1,
          }}>{label}</span>
        </button>
      </div>
    )
  }

  const SectionCard = ({ title, children }) => (
    <div style={{ borderTop: '0.5px solid var(--border)' }}>
      <div style={{ padding: '11px 14px 0' }}>
        <div style={{ fontSize: 9, color: 'var(--text-tertiary)', fontWeight: 700,
          letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: 2 }}>{title}</div>
      </div>
      {children}
    </div>
  )

  return (
    <ExpandableCard item={item} isChecked={isChecked} onToggle={onToggle} open={open} setOpen={setOpen}>

      {/* ── Airport info ── */}
      <div style={{ padding: '14px 14px 0' }}>
        {aptLoading && (
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', paddingBottom: 12 }}>Loading airport data...</div>
        )}
        {aptError && (
          <div style={{ fontSize: 11, color: 'var(--danger)', paddingBottom: 12 }}>{aptError}</div>
        )}
        {!aptLoading && !aptData && !aptError && (
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', paddingBottom: 12 }}>
            {destIcao ? `Looking up ${destIcao}...` : 'Set a destination in the Route card to load airport data.'}
          </div>
        )}
        {aptData && (() => {
          const FREQ_GROUPS = [
            { key: 'ATIS',      label: 'ATIS',      match: t => /atis|asos|awos|d-atis/i.test(t) },
            { key: 'ARRIVAL',   label: 'Arrival',   match: t => /approach|arrival|apch/i.test(t) },
            { key: 'TOWER',     label: 'Tower',     match: t => /tower|twr/i.test(t) },
            { key: 'GROUND',    label: 'Ground',    match: t => /ground|gnd/i.test(t) },
            { key: 'CLEARANCE', label: 'Clnc Del',  match: t => /clearance|clnc|delivery/i.test(t) },
            { key: 'DEPARTURE', label: 'Departure', match: t => /departure|dep(?!loyed)/i.test(t) },
            { key: 'UNICOM',    label: 'Unicom',    match: t => /unicom|ctaf/i.test(t) },
          ]
          const grouped = {}
          const used = new Set()
          FREQ_GROUPS.forEach(g => {
            const matches = (aptData.frequencies || []).filter(f => g.match(f.type || ''))
            if (matches.length) { grouped[g.key] = matches; matches.forEach(f => used.add(f.freq + f.type)) }
          })
          const others = (aptData.frequencies || []).filter(f => !used.has(f.freq + f.type))

          // Wind component on landing runway
          const lrwy = landingRwy ? (aptData.runways?.find(rw => rw.id === landingRwy.id) || landingRwy) : null
          const hwComp = aptWind && lrwy?.hdg != null
            ? Math.round(aptWind.spd * Math.cos((aptWind.dir - lrwy.hdg) * Math.PI / 180))
            : null

          return (
            <div style={{ marginBottom: 14 }}>
              {/* ── Header row: big ICAO + name + elev ── */}
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6 }}>
                <div>
                  <div style={{ fontSize: 36, fontWeight: 900, fontFamily: 'monospace', color: 'var(--text)',
                    letterSpacing: '1px', lineHeight: 1 }}>{aptData.icaoId}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4, lineHeight: 1.3 }}>
                    {aptData.name}
                    {aptData.state ? ` · ${aptData.state}` : ''}
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 12 }}>
                  {aptData.elev && (
                    <>
                      <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-tertiary)',
                        textTransform: 'uppercase', letterSpacing: '0.5px' }}>Field Elev</div>
                      <div style={{ fontSize: 20, fontWeight: 800, fontFamily: 'monospace', color: 'var(--text)' }}>
                        {aptData.elev.replace(' ft','')}<span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-tertiary)', marginLeft: 3 }}>ft</span>
                      </div>
                    </>
                  )}
                  {aptData.tower != null && (
                    <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2 }}>
                      Tower <strong style={{ color: 'var(--text)' }}>{aptData.tower ? 'Yes' : 'No'}</strong>
                    </div>
                  )}
                </div>
              </div>

              {/* ── Runway display ── */}
              {aptData.runways?.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-tertiary)',
                    textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>
                    {lrwy ? 'Landing Runway' : 'Runways'}
                  </div>

                  {lrwy ? (
                    /* Single selected landing runway card */
                    <div style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      background: 'var(--bg-card-2)', border: '0.5px solid var(--border)',
                      borderRadius: 10, padding: '10px 14px',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                        <span style={{ fontSize: 26, fontWeight: 900, fontFamily: 'monospace',
                          color: 'var(--text)', letterSpacing: '1px', lineHeight: 1 }}>{lrwy.id}</span>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          {lrwy.hdg != null && (
                            <span style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
                              {String(lrwy.hdg).padStart(3, '0')}°
                            </span>
                          )}
                          {lrwy.len && (
                            <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{lrwy.len}</span>
                          )}
                          {lrwy.sfc && (
                            <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{lrwy.sfc}</span>
                          )}
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                        {hwComp != null && (
                          <span style={{ fontSize: 18, fontWeight: 800, fontFamily: 'monospace',
                            color: hwComp >= 0 ? 'var(--text)' : 'var(--danger)' }}>
                            {hwComp >= 0 ? '+' : ''}{hwComp}kt {hwComp >= 0 ? 'HW' : 'TW'}
                          </span>
                        )}
                        {aptWind && (
                          <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'monospace' }}>
                            {aptWind.dir}° / {aptWind.spd}kt
                          </span>
                        )}
                      </div>
                    </div>
                  ) : (
                    /* All runways as pills when no landing runway chosen */
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 5 }}>
                      {aptData.runways.map(r => (
                        <div key={r.id} style={{
                          padding: '6px 8px', borderRadius: 7, textAlign: 'center',
                          fontSize: 12, fontWeight: 700, fontFamily: 'monospace',
                          border: '0.5px solid var(--border)', background: 'transparent',
                          color: 'var(--text-secondary)',
                        }}>
                          {r.id}
                          {r.hdg != null && (
                            <span style={{ fontSize: 10, opacity: 0.5, marginLeft: 3, fontWeight: 400 }}>{r.hdg}°</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}


            </div>
          )
        })()}
      </div>

      {/* ── Charts & Diagrams ── */}
      <SectionCard title="">
        {/* 2×2 grid: Airport Diagram, Chart Supplement, Satellite Image, NOTAMs */}
        {(() => {
          const ident = icao.replace(/^K/, '').toUpperCase()
          const apdChart = (FAA_CHARTS_DATA[ident] || []).find(([code]) => code === 'APD')
          const apdUrl = apdChart ? `https://aeronav.faa.gov/d-tpp/2606/${apdChart[2]}` : null
          const gridBtn = { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'center',
            gap: 6, padding: '13px 12px', borderRadius: 11,
            background: 'var(--bg-card-2)', border: '0.5px solid var(--border)',
            textDecoration: 'none', cursor: 'pointer', width: '100%', textAlign: 'left' }
          return (
            <div style={{ padding: '10px 14px 4px',
              display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {/* Airport Diagram */}
              <a href={apdUrl || `https://skyvector.com/airport/${icao}`} target="_blank" rel="noreferrer" style={gridBtn}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                  stroke="var(--text-secondary)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2"/>
                  <path d="M3 9h18M9 21V9"/>
                </svg>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Airport Diagram</div>
                  <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 1 }}>
                    {apdUrl ? 'FAA Official · PDF' : 'SkyVector'}
                  </div>
                </div>
              </a>
              {/* Chart Supplement */}
              <a href={`https://skyvector.com/airport/${icao}`} target="_blank" rel="noreferrer" style={gridBtn}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                  stroke="var(--text-secondary)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <line x1="16" y1="13" x2="8" y2="13"/>
                  <line x1="16" y1="17" x2="8" y2="17"/>
                  <polyline points="10 9 9 9 8 9"/>
                </svg>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Chart Supplement</div>
                  <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 1 }}>SkyVector</div>
                </div>
              </a>
              {/* Satellite Image */}
              <button onClick={() => setMapsOpen(true)} style={{ ...gridBtn, border: '0.5px solid var(--border)' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                  stroke="var(--text-secondary)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="2" y1="12" x2="22" y2="12"/>
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                </svg>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Satellite Image</div>
                  <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 1 }}>open in maps</div>
                </div>
              </button>
              {/* NOTAMs */}
              <a href="https://notams.aim.faa.gov/notamSearch/" target="_blank" rel="noreferrer" style={gridBtn}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                  stroke="var(--text-secondary)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/>
                  <line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>NOTAMs</div>
                  <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 1 }}>FAA Official</div>
                </div>
              </a>
            </div>
          )
        })()}

        {/* iOS-style action sheet (Satellite Image) */}
        {mapsOpen && (
          <>
            <div onClick={() => setMapsOpen(false)} style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
              zIndex: 1000, backdropFilter: 'blur(2px)',
            }} />
            <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 1001, padding: '0 12px 20px' }}>
              <div style={{ borderRadius: 14, overflow: 'hidden', marginBottom: 8 }}>
                <div style={{ background: 'rgba(30,30,32,0.97)', padding: '12px 16px 6px' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textAlign: 'center', marginBottom: 6 }}>
                    Open satellite view of {icao}
                  </div>
                </div>
                {[
                  { label: 'Apple Maps',  sub: 'Maps',             url: `https://maps.apple.com/?q=${icao}+airport&t=k` },
                  { label: 'Google Maps', sub: 'maps.google.com',  url: `https://www.google.com/maps/search/?api=1&query=${icao}+airport&maptype=satellite` },
                  { label: 'Waze',        sub: 'waze.com',         url: `https://waze.com/ul?q=${icao}+airport` },
                ].map((opt, i) => (
                  <a key={opt.label} href={opt.url} target="_blank" rel="noreferrer"
                    onClick={() => setMapsOpen(false)}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '14px 16px', borderTop: '0.5px solid rgba(255,255,255,0.08)',
                      background: 'rgba(30,30,32,0.97)', textDecoration: 'none',
                    }}>
                    <span style={{ fontSize: 16, color: 'var(--accent)', fontWeight: 500 }}>{opt.label}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{opt.sub}</span>
                  </a>
                ))}
              </div>
              <button onClick={() => setMapsOpen(false)} style={{
                width: '100%', padding: '16px', borderRadius: 14,
                background: 'rgba(30,30,32,0.97)', border: 'none', cursor: 'pointer',
                fontSize: 16, fontWeight: 700, color: 'var(--accent)',
              }}>Cancel</button>
            </div>
          </>
        )}

        {/* Frequencies — card button that drops down the list */}
        {aptData?.frequencies?.length > 0 && (
          <div style={{ padding: '4px 14px 4px' }}>
            <div style={{
              borderRadius: 11, background: 'var(--bg-card-2)', border: '0.5px solid var(--border)', overflow: 'hidden',
            }}>
              <button onClick={() => setFreqOpen(o => !o)} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                width: '100%', padding: '13px 16px', background: 'none', border: 'none',
                cursor: 'pointer', gap: 10, textAlign: 'left',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                    stroke="var(--text-secondary)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.63 3.4 2 2 0 0 1 3.6 1.22h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.86a16 16 0 0 0 6.06 6.06l.96-.95a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
                  </svg>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>Frequencies</div>
                    <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 1 }}>
                      {icao} · {aptData.frequencies.length} frequencies
                    </div>
                  </div>
                </div>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                  stroke="var(--text-tertiary)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                  style={{ transform: freqOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s', flexShrink: 0 }}>
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </button>
              {freqOpen && (
                <div style={{ borderTop: '0.5px solid var(--border)' }}>
                  {aptData.frequencies.map((f, i) => (
                    <div key={f.freq + f.type + i} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '9px 16px',
                      borderTop: i > 0 ? '0.5px solid var(--border)' : 'none',
                    }}>
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{f.type}</span>
                      <span style={{ fontSize: 15, fontWeight: 700, fontFamily: 'monospace', color: 'var(--text)' }}>{f.freq}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        <div style={{ padding: '10px 14px 4px' }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.2px' }}>Checklist</span>
        </div>

        {/* Charts & Diagrams group */}
        <div style={{ padding: '6px 14px 0' }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.5px', textTransform: 'uppercase' }}>Charts &amp; Diagrams</span>
        </div>
        <div style={{ margin: '4px 14px 0', borderRadius: 11, border: '0.5px solid var(--border)' }}>
          <CheckRow id="apt-cfs"   label="Chart Supplement reviewed" />
          <CheckRow id="apt-vtpc"  label="Airport Diagram / ATIS checked" />
          <CheckRow id="apt-hours" label="Hours of Operation confirmed" />
          <CheckRow id="apt-notam" label="NOTAMs checked" />
        </div>

        {/* Ground Familiarization group */}
        <div style={{ padding: '10px 14px 0' }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.5px', textTransform: 'uppercase' }}>Ground Familiarization</span>
        </div>
        <div style={{ margin: '4px 14px 0', borderRadius: 11, border: '0.5px solid var(--border)' }}>
          <CheckRow id="apt-taxi"   label="Taxi Chart reviewed" />
          <CheckRow id="apt-taxi-a" label="Hotspots identified" />
          <CheckRow id="apt-taxi-b" label="Planned parking noted (FBO / Helipads / Ramps)" />
          <CheckRow id="apt-light"  label="Lighting available confirmed" />
          <CheckRow id="apt-sat"    label="Satellite image familiarization done" />
        </div>

        {/* Services & Ops group */}
        <div style={{ padding: '10px 14px 0' }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.5px', textTransform: 'uppercase' }}>Services &amp; Ops</span>
        </div>
        <div style={{ margin: '4px 14px 0', borderRadius: 11, border: '0.5px solid var(--border)' }}>
          <CheckRow id="apt-svc-a"   label="Fuel / oil / parking / amenities confirmed" />
          <CheckRow id="apt-caution" label="Airport cautions reviewed" />
        </div>

        {/* FBO / Arrival group */}
        <div style={{ padding: '10px 14px 0' }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.5px', textTransform: 'uppercase' }}>FBO / Arrival</span>
        </div>
        <div style={{ margin: '4px 14px 12px', borderRadius: 11, border: '0.5px solid var(--border)' }}>
          <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 10, borderBottom: '0.5px solid var(--border)' }}>
            <div>
              <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginBottom: 4 }}>FBO Frequency</div>
              <input
                defaultValue={fboFreq}
                onChange={e => localStorage.setItem('apt_fbo_freq', e.target.value)}
                placeholder="e.g. 122.95"
                style={{
                  width: '100%', background: 'var(--bg-card-2)', border: '0.5px solid var(--border)',
                  borderRadius: 8, padding: '8px 10px', fontSize: 13, color: 'var(--text)',
                  fontFamily: 'monospace', outline: 'none', boxSizing: 'border-box',
                }}
              />
            </div>
            <div>
              <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginBottom: 4 }}>Special Remarks / Procedures</div>
              <textarea
                defaultValue={fboNote}
                onChange={e => localStorage.setItem('apt_fbo_note', e.target.value)}
                placeholder="Parking instructions, contact info, special procedures..."
                rows={3}
                style={{
                  width: '100%', background: 'var(--bg-card-2)', border: '0.5px solid var(--border)',
                  borderRadius: 8, padding: '8px 10px', fontSize: 12, color: 'var(--text)',
                  resize: 'none', outline: 'none', lineHeight: 1.5, boxSizing: 'border-box',
                  fontFamily: 'inherit',
                }}
              />
            </div>
          </div>
          <CheckRow id="apt-fbo"   label="FBO / Airport informed of arrival and intention" />
          <CheckRow id="apt-fbo-a" label="FBO frequency noted" />
        </div>
      </SectionCard>

      <div style={{ borderTop: '0.5px solid var(--border)', height: 4 }} />
      <DoneButton
        isChecked={isChecked}
        onDone={() => { onToggle(item.id); setOpen(false) }}
        checkedIds={checkedIds}
        subIds={['apt-cfs','apt-vtpc','apt-hours','apt-notam','apt-taxi','apt-taxi-a','apt-taxi-b','apt-light','apt-sat','apt-svc-a','apt-caution','apt-fbo','apt-fbo-a']}
      />
    </ExpandableCard>
  )
}

/* ── Aircraft checklist ──────────────────────────────────────── */
function AircraftItem({ item, isChecked, onToggle }) {
  const [open, setOpen] = useState(false)
  const [checkedIds, setCheckedIds] = useState(new Set())
  const [aircraftImage, setAircraftImage] = useState('')
  const [aircraftName, setAircraftName]   = useState('')
  const [registration, setRegistration]   = useState('')
  const [fuelState, setFuelState]         = useState(null)
  const [currencyData, setCurrencyData]   = useState(null)

  useEffect(() => {
    get('aircraft', 'profile').then(p => {
      if (p?.image)        setAircraftImage(p.image)
      if (p?.fullName)     setAircraftName(p.fullName)
      if (p?.registration) setRegistration(p.registration)
    })
    get('currency', 'profile').then(c => {
      if (c) setCurrencyData(c)
    })
    try {
      const saved = localStorage.getItem('cruise_fuel_state')
      if (saved) setFuelState(JSON.parse(saved))
    } catch { /* ignore */ }
  }, [open])

  // Map Aircraft checklist row IDs -> currency data fields
  const CURRENCY_DOCS_MAP = {
    'ac-crew':      c => c?.airworthy?.docs?.crew,
    'ac-airworth':  c => c?.airworthy?.docs?.airworth,
    'ac-reg':       c => c?.airworthy?.docs?.reg,
    'ac-radio':     c => c?.airworthy?.docs?.radio,
    'ac-oplim':     c => c?.airworthy?.docs?.oplim,
    'ac-wb':        c => c?.airworthy?.docs?.wb,
    'ac-insurance': c => c?.airworthy?.docs?.insurance,
  }
  const CURRENCY_INSP_MAP = {
    'ac-annual': c => c?.airworthy?.annualDate,
    'ac-elt':    c => c?.airworthy?.eltDate,
    'ac-xpdr':   c => c?.airworthy?.transponderDate,
    'ac-pitot':  c => c?.airworthy?.pitotDate,
    'ac-oil':    c => c?.airworthy?.oilDate,
  }
  const isCurrencyCompleted = id => {
    const docFn = CURRENCY_DOCS_MAP[id]
    if (docFn) return Boolean(docFn(currencyData))
    const inspFn = CURRENCY_INSP_MAP[id]
    if (inspFn) return Boolean(inspFn(currencyData))
    return false
  }

  const toggleSub = id => {
    setCheckedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const TOOLTIPS = {
    'ac-crew':    'Pilot certificate, photo ID, and valid medical (or BasicMed) must be on your person. FAR 61.3.',
    'ac-airworth':'Certificate of Airworthiness must be in the aircraft and valid — check for any limitations. FAR 91.203.',
    'ac-reg':     'Aircraft Registration must be aboard. FAR 91.203.',
    'ac-radio':   'FCC Radio Station License must be aboard for international flights. Domestic VFR: not required but common practice.',
    'ac-oplim':   'Operating Limitations (AFM/POH + placards) must be in the aircraft and complied with. FAR 91.9.',
    'ac-wb':      'Current Weight & Balance data must be in the aircraft. FAR 91.103.',
    'ac-insurance':'Aircraft insurance current — check policy expiry and coverage for this flight.',
    'ac-annual':  'Annual inspection must be current (within 12 calendar months). FAR 91.409.',
    'ac-100hr':   '100-hour inspection required if aircraft is used for hire or flight instruction for hire. FAR 91.409.',
    'ac-oil':     'Oil change within manufacturer limits. Check oil level and quality before flight.',
    'ac-ads':     'All applicable Airworthiness Directives must be complied with and recorded. FAR 91.409.',
    'ac-equip':   'Required equipment current — ELT battery, transponder, altimeter, pitot-static checks within calendar limits. FAR 91.171.',
    'ac-fuel-req':'Fuel load meets VFR or IFR reserve requirements for planned route and conditions. FAR 91.151 / 91.167.',
    'ac-extra-oil':'Extra quart(s) of correct oil grade aboard for the flight.',
    'ac-charts-cur':'Charts and plates are current and cover the planned route, alternates, and destination.',
  }

  const GroupRow = ({ title, ids, isCurrencyCompleted: icc, children }) => {
    const [groupOpen, setGroupOpen] = useState(false)
    const allCompleted = ids.every(id => icc(id) || checkedIds.has(id))
    const currencyDone = ids.some(id => icc(id))
    return (
      <div style={{ margin: '4px 14px 0' }}>
        <button
          onClick={() => setGroupOpen(o => !o)}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            background: 'var(--bg-card-2)', border: '0.5px solid var(--border)',
            borderRadius: groupOpen ? '11px 11px 0 0' : 11,
            padding: '11px 14px', cursor: 'pointer', gap: 10,
          }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.1px' }}>{title}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {allCompleted && (
              <div style={{
                fontSize: 10, fontWeight: 700, color: '#fff',
                background: 'var(--ok)', borderRadius: 20, padding: '3px 10px',
              }}>Completed</div>
            )}
            {!allCompleted && currencyDone && (
              <div style={{
                fontSize: 10, fontWeight: 600, color: 'var(--text-tertiary)',
                background: 'var(--bg-card)', border: '0.5px solid var(--border)',
                borderRadius: 20, padding: '3px 10px',
              }}>Partial</div>
            )}
            <svg width={14} height={14} viewBox="0 0 16 16" fill="none"
              style={{ transform: groupOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s', flexShrink: 0 }}>
              <polyline points="3,6 8,11 13,6" stroke="var(--text-tertiary)" strokeWidth="1.8"
                strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
        </button>
        {groupOpen && (
          <div style={{ border: '0.5px solid var(--border)', borderTop: 'none', borderRadius: '0 0 11px 11px', overflow: 'hidden' }}>
            {children}
          </div>
        )}
      </div>
    )
  }

  const CheckRow = ({ id, label }) => {
    const done = checkedIds.has(id)
    const fromCurrency = isCurrencyCompleted(id)
    const [hovered, setHovered] = useState(false)
    const tip = TOOLTIPS[id]
    return (
      <div style={{ position: 'relative' }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}>
        <button onClick={() => !fromCurrency && toggleSub(id)} style={{
          width: '100%', textAlign: 'left', background: 'transparent',
          border: 'none', cursor: fromCurrency ? 'default' : 'pointer',
          display: 'flex', alignItems: 'center', gap: 11,
          padding: '9px 14px', borderRadius: 8,
        }}>
          {!fromCurrency && (
            <div style={{
              width: 16, height: 16, borderRadius: 4, flexShrink: 0,
              background: done ? 'var(--accent)' : 'transparent',
              border: `1.5px solid ${done ? 'var(--accent)' : 'var(--border-strong)'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.18s',
            }}>
              {done && (
                <svg width={10} height={10} viewBox="0 0 12 12" fill="none">
                  <polyline points="2,6 5,9 10,3" stroke="var(--accent-fg)" strokeWidth="1.8"
                    strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </div>
          )}
          <span style={{ flex: 1, textDecoration: done && !fromCurrency ? 'line-through' : 'none', transition: 'color 0.18s' }}>
            {label.includes(' — ') ? (
              <>
                <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.2px' }}>
                  {label.split(' — ')[0]}
                </span>
                <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--text-secondary)' }}>
                  {' '}{label.split(' — ')[1]}
                </span>
              </>
            ) : (
              <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{label}</span>
            )}
          </span>
          {fromCurrency && (
            <div style={{
              fontSize: 10, fontWeight: 700, color: '#fff',
              background: 'var(--ok)', borderRadius: 20,
              padding: '3px 10px', flexShrink: 0,
            }}>Completed</div>
          )}
        </button>
        {hovered && tip && (
          <div style={{
            position: 'fixed', zIndex: 9999,
            fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5,
            background: 'var(--bg-card)', borderRadius: 8, padding: '8px 10px',
            border: '0.5px solid var(--border-strong)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
            width: 220, pointerEvents: 'none',
            top: 'auto', left: 14,
          }}>
            {tip}
          </div>
        )}
      </div>
    )
  }

  // Maintenance date/hours input row
  const MaintRow = ({ id, label, placeholder, unit }) => {
    const storageKey = `ac_maint_${id}`
    const done = checkedIds.has(id)
    const fromCurrency = isCurrencyCompleted(id)
    return (
      <div style={{ borderTop: '0.5px solid var(--border)', padding: '10px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: fromCurrency ? 0 : 6 }}>
          {!fromCurrency && (
            <button onClick={() => toggleSub(id)} style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: 0, flexShrink: 0,
              display: 'flex', alignItems: 'center',
            }}>
              <div style={{
                width: 16, height: 16, borderRadius: 4,
                background: done ? 'var(--accent)' : 'transparent',
                border: `1.5px solid ${done ? 'var(--accent)' : 'var(--border-strong)'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all 0.18s',
              }}>
                {done && (
                  <svg width={10} height={10} viewBox="0 0 12 12" fill="none">
                    <polyline points="2,6 5,9 10,3" stroke="var(--accent-fg)" strokeWidth="1.8"
                      strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </div>
            </button>
          )}
          <span style={{
            fontSize: 13, fontWeight: 500, color: 'var(--text)', flex: 1,
            textDecoration: done && !fromCurrency ? 'line-through' : 'none',
          }}>{label}</span>
          {fromCurrency && (
            <div style={{
              fontSize: 10, fontWeight: 700, color: '#fff',
              background: 'var(--ok)', borderRadius: 20,
              padding: '3px 10px', flexShrink: 0,
            }}>Completed</div>
          )}
        </div>
        {!fromCurrency && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              defaultValue={localStorage.getItem(storageKey) || ''}
              onChange={e => localStorage.setItem(storageKey, e.target.value)}
              placeholder={placeholder}
              style={{
                flex: 1, background: 'var(--bg-card-2)', border: '0.5px solid var(--border)',
                borderRadius: 8, padding: '7px 10px', fontSize: 12, color: 'var(--text)',
                fontFamily: 'monospace', outline: 'none', boxSizing: 'border-box',
              }}
            />
            {unit && <span style={{ fontSize: 10, color: 'var(--text-tertiary)', flexShrink: 0 }}>{unit}</span>}
          </div>
        )}
      </div>
    )
  }

  const subIds = [
    'ac-crew','ac-airworth','ac-reg','ac-radio','ac-oplim','ac-wb','ac-insurance',
    'ac-annual','ac-100hr','ac-oil','ac-ads','ac-elt','ac-xpdr','ac-pitot',
    'ac-fuel-req','ac-extra-oil','ac-charts-cur',
  ]

  return (
    <ExpandableCard item={item} isChecked={isChecked} onToggle={onToggle} open={open} setOpen={setOpen}>

      <div style={{ margin: '14px 14px 0', borderRadius: 12, overflow: 'hidden', background: 'var(--bg-card)' }}>
        {aircraftImage && (
          <img src={aircraftImage} alt={aircraftName || 'Aircraft'} className="aircraft-hero-img" style={{
            width: '100%', height: 160, objectFit: 'contain', display: 'block',
          }} />
        )}
        {(aircraftName || registration) && (
          <div style={{ padding: aircraftImage ? '8px 12px 4px' : '12px 12px 4px' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', letterSpacing: '-0.1px' }}>
              {aircraftName}{aircraftName && registration ? ' · ' : ''}{registration}
            </div>
          </div>
        )}
        {fuelState && (
          <div style={{ padding: '8px 12px 12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
              <div style={{ fontSize: 9, color: 'var(--text-tertiary)', fontWeight: 700,
                letterSpacing: '0.5px', textTransform: 'uppercase' }}>Fuel State</div>
              <div style={{ fontSize: 9, color: 'var(--text-tertiary)' }}>{fuelState.fobN} gal on board</div>
            </div>
            <div style={{ height: 8, borderRadius: 4, background: 'var(--bg-card-2)', overflow: 'hidden', display: 'flex' }}>
              <div style={{ width: `${fuelState.tripFrac * 100}%`, background: 'var(--text-secondary)', borderRadius: '4px 0 0 4px' }} />
              <div style={{ width: `${fuelState.reqResFrac * 100}%`, background: '#FF9500' }} />
              <div style={{ flex: 1, background: 'var(--ok)', opacity: fuelState.extraFrac > 0 ? 1 : 0, borderRadius: '0 4px 4px 0' }} />
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 5, flexWrap: 'wrap' }}>
              {[
                { color: 'var(--text-secondary)', label: `Trip · ${fuelState.fuelRequired?.toFixed(1)} gal` },
                { color: '#FF9500',               label: `Reserve · ${fuelState.reserveFuelGal?.toFixed(1)} gal` },
                { color: 'var(--ok)',              label: `Extra · ${fuelState.extraGal?.toFixed(1)} gal` },
              ].map(({ color, label }) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <div style={{ width: 7, height: 7, borderRadius: 2, background: color, flexShrink: 0 }} />
                  <span style={{ fontSize: 9, color: 'var(--text-tertiary)' }}>{label}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div style={{ padding: '14px 14px 4px' }}>
        <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.2px' }}>Checklist</span>
      </div>

      {/* Documents: CARROW */}
      <GroupRow
        title="CARROW"
        ids={['ac-crew','ac-airworth','ac-reg','ac-radio','ac-oplim','ac-wb','ac-insurance']}
        isCurrencyCompleted={isCurrencyCompleted}>

        <CheckRow id="ac-crew"      label="C — Crew documents (license · photo ID · medical)" />
        <CheckRow id="ac-airworth"  label="A — Certificate of Airworthiness" />
        <CheckRow id="ac-reg"       label="R — Certificate of Registration" />
        <CheckRow id="ac-radio"     label="R — Radio License (FCC)" />
        <CheckRow id="ac-oplim"     label="O — Operating Limitations (AFM / POH)" />
        <CheckRow id="ac-wb"        label="W — Weight &amp; Balance data" />
        <CheckRow id="ac-insurance" label="Insurance current" />
      </GroupRow>

      {/* Airworthiness */}
      <GroupRow
        title="Airworthiness"
        ids={['ac-ads','ac-annual','ac-100hr','ac-oil','ac-elt','ac-xpdr','ac-pitot']}
        isCurrencyCompleted={isCurrencyCompleted}>

        <div style={{ padding: '4px 0 0' }}>
          <CheckRow id="ac-ads" label="Airworthiness Directives reviewed" />
        </div>
        <MaintRow id="ac-annual" label="Annual Inspection"               placeholder="e.g. 2025-12-01" unit="due date" />
        <MaintRow id="ac-100hr" label="100-hr Inspection"                placeholder="e.g. 1842.3"     unit="due hrs" />
        <MaintRow id="ac-oil"   label="Oil Change"                       placeholder="e.g. 1820.0"     unit="due hrs" />
        <MaintRow id="ac-elt"   label="ELT Battery"                      placeholder="e.g. 2026-03-01" unit="exp date" />
        <MaintRow id="ac-xpdr"  label="Transponder (24-mo)"              placeholder="e.g. 2026-06-01" unit="due date" />
        <MaintRow id="ac-pitot" label="Pitot-Static / Altimeter (24-mo)" placeholder="e.g. 2026-06-01" unit="due date" />
      </GroupRow>

      {/* Fuel & Equipment */}
      <div style={{ padding: '10px 14px 0' }}>
        <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.5px', textTransform: 'uppercase' }}>Fuel &amp; Equipment</span>
      </div>
      <div style={{ margin: '4px 14px 12px', borderRadius: 11, border: '0.5px solid var(--border)' }}>
        <CheckRow id="ac-fuel-req"   label="Fuel meets VFR / IFR reserve requirements" />
        <CheckRow id="ac-extra-oil"  label="Extra oil aboard" />
        <CheckRow id="ac-charts-cur" label="Charts current and aboard" />
      </div>

      <DoneButton
        isChecked={isChecked}
        onDone={() => { onToggle(item.id); setOpen(false) }}
        checkedIds={checkedIds}
        subIds={subIds}
      />
    </ExpandableCard>
  )
}

/* ── Overflight checklist ────────────────────────────────────── */
function OverflightItem({ item, isChecked, onToggle }) {
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState(new Set())

  const TERRAIN = [
    {
      id: 'water', label: 'Water',
      items: ['Life jacket / flotation device aboard', 'Glide range reaches shore or vessel', 'Survival equipment for water temp', 'Filed flight plan with overwater leg'],
    },
    {
      id: 'mountains', label: 'Mountains',
      items: ['Terrain clearance — 1,000 ft above highest within 5 NM', 'Escape route identified for each leg', 'Turbulence / downdraft margins planned', 'Density altitude checked at cruise level', 'No-return point identified'],
    },
    {
      id: 'builtup', label: 'Built-up areas',
      items: ['Min 1,000 ft AGL above highest obstacle within 2,000 ft', 'Emergency landing area identified', 'Noise abatement procedures noted'],
    },
    {
      id: 'aero', label: 'Aerodromes',
      items: ['Cross at min 500 ft above circuit altitude', 'Monitor MF / CTAF frequency', 'Note traffic pattern direction'],
    },
    {
      id: 'oxygen', label: 'Oxygen',
      items: ['Above 10,000 ft MSL > 30 min: supplemental O₂ required (crew)', 'Above 12,500 ft MSL: supplemental O₂ required', 'Passengers: O₂ available above 10,000 ft', 'O₂ equipment inspected and quantity sufficient'],
    },
  ]

  function toggle(id) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const activeTerrains = TERRAIN.filter(t => selected.has(t.id))

  return (
    <ExpandableCard item={item} isChecked={isChecked} onToggle={onToggle} open={open} setOpen={setOpen}>
          {/* Terrain type selector */}
          <div style={{ padding: '14px 14px 12px' }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 10 }}>
              What are you flying over?
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {TERRAIN.map(t => {
                const active = selected.has(t.id)
                return (
                  <button key={t.id} onClick={() => toggle(t.id)} style={{
                    padding: '6px 12px', borderRadius: 20,
                    border: `0.5px solid ${active ? 'var(--text)' : 'var(--border)'}`,
                    background: active ? 'var(--text)' : 'var(--bg-card-2)',
                    color: active ? 'var(--bg)' : 'var(--text-secondary)',
                    fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}>{t.label}</button>
                )
              })}
            </div>
          </div>

          {/* Considerations for selected terrain types */}
          {activeTerrains.length > 0 && (
            <div style={{ borderTop: '0.5px solid var(--border)' }}>
              {activeTerrains.map((t, ti) => (
                <div key={t.id} style={{ padding: '12px 14px', borderTop: ti > 0 ? '0.5px solid var(--border)' : 'none' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.4px', textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: 8 }}>
                    {t.label}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                    {t.items.map((req, i) => (
                      <div key={i} style={{
                        display: 'flex', alignItems: 'flex-start', gap: 8,
                        padding: '6px 0',
                        borderTop: i > 0 ? '0.5px solid var(--border)' : 'none',
                      }}>
                        <div style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--text-tertiary)', flexShrink: 0, marginTop: 5 }} />
                        <span style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.45 }}>{req}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeTerrains.length === 0 && (
            <div style={{ borderTop: '0.5px solid var(--border)', padding: '12px 14px 10px' }}>
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', textAlign: 'center' }}>
                Select terrain types above to see considerations
              </div>
            </div>
          )}
          <DoneButton isChecked={isChecked} onDone={() => { onToggle(item.id); setOpen(false) }} />
    </ExpandableCard>
  )
}

/* ── Oxygen requirements reference ──────────────────────────── */
const O2_RULES = [
  { alt: 'Below 12,500 ft MSL', rule: 'No oxygen required', ok: true },
  { alt: '12,500 – 14,000 ft MSL', rule: 'Required if at altitude more than 30 min', warn: true },
  { alt: 'Above 14,000 ft MSL', rule: 'Flight crew must use oxygen at all times', danger: true },
  { alt: 'Above 15,000 ft MSL', rule: 'Must provide oxygen to each occupant', danger: true },
]

function OxygenItem({ item, isChecked, onToggle }) {
  const [open, setOpen] = useState(false)
  return (
    <ExpandableCard item={item} isChecked={isChecked} onToggle={onToggle} open={open} setOpen={setOpen}>
          <div style={{ padding: '12px 12px 10px' }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 10 }}>
              14 CFR §91.211 — Supplemental Oxygen
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {O2_RULES.map((r, i) => (
                <div key={i} style={{
                  background: 'var(--bg-card-2)', borderRadius: 9, padding: '9px 12px',
                  borderLeft: `3px solid ${r.ok ? 'var(--ok)' : r.warn ? 'var(--warn)' : 'var(--danger)'}`,
                }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', marginBottom: 2 }}>{r.alt}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.4 }}>{r.rule}</div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ borderTop: '0.5px solid var(--border)', padding: '8px 12px 10px' }}>
            <a href="https://www.ecfr.gov/current/title-14/chapter-I/subchapter-F/part-91/subpart-B/section-91.211" target="_blank" rel="noreferrer" style={{
              display: 'block', textAlign: 'center', padding: '8px 0',
              borderRadius: 9, border: '0.5px solid var(--border)',
              background: 'var(--bg-card-2)', textDecoration: 'none',
              fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)',
            }}>14 CFR §91.211</a>
          </div>
          <DoneButton isChecked={isChecked} onDone={() => { onToggle(item.id); setOpen(false) }} />
    </ExpandableCard>
  )
}

/* ── Metro item rows ─────────────────────────────────────────── */
function MetroItems({ items, checked, onToggle, depth }) {
  return (
    <>
      {items.map(item => {
        const isChecked = checked.has(item.id)

        // Special expandable items
        const EXPAND_MAP = {
          wb:          (props) => <WBChecklistItem {...props} ExpandableCard={ExpandableCard} />,
          imsafe:      (props) => <IMChecklistItem {...props} statusKey="safe" />,
          imcurrent:   (props) => <IMChecklistItem {...props} statusKey="current" />,
          imvalid:     (props) => <IMChecklistItem {...props} statusKey="valid" />,
          imairworthy: (props) => <IMChecklistItem {...props} statusKey="airworthy" />,
          metar:      MetarItem,
          altitude:   AltitudeItem,
          densityalt: DensityAltItem,
          perfdist:   PerfDistItem,
          cruise:     CruiseItem,
          charts:     ChartsItem,
          alternates: AlternatesItem,
          notam:      NotamItem,
          overflight: OverflightItem,
          airport:    AirportItem,
          aircraft:   AircraftItem,
          oxygen:     OxygenItem,
        }
        if (item.expand && EXPAND_MAP[item.expand]) {
          const ExpandComp = EXPAND_MAP[item.expand]
          return (
            <div key={item.id}>
              <ExpandComp item={item} isChecked={isChecked} onToggle={onToggle} />
              {item.items && (
                <MetroItems items={item.items} checked={checked} onToggle={onToggle} depth={0} />
              )}
            </div>
          )
        }

        return (
          <div key={item.id}>
            <button
              onClick={() => onToggle(item.id)}
              style={{
                width: '100%', textAlign: 'left', background: 'none', border: 'none',
                cursor: 'pointer', display: 'flex', alignItems: 'flex-start', gap: 10,
                padding: '5px 0', minHeight: 36,
              }}>
              {/* Dot — same size at every level */}
              <div style={{
                width: 7, height: 7, marginTop: 5,
                borderRadius: '50%', flexShrink: 0,
                background: isChecked ? 'var(--text)' : 'transparent',
                border: `1.5px solid ${isChecked ? 'var(--text)' : 'var(--border-strong)'}`,
                transition: 'all 0.2s',
              }} />
              {/* Label + optional subtitle */}
              <div style={{ flex: 1 }}>
                <div style={{
                  fontSize: 14, fontWeight: 500, lineHeight: 1.35,
                  color: isChecked ? 'var(--text-tertiary)' : 'var(--text)',
                  textDecoration: isChecked ? 'line-through' : 'none',
                  transition: 'color 0.2s',
                }}>
                  {item.label}
                </div>
                <SubPills sub={item.sub} isChecked={isChecked} />
              </div>
            </button>
            {item.items && (
              <MetroItems items={item.items} checked={checked} onToggle={onToggle} depth={0} />
            )}
          </div>
        )
      })}
    </>
  )
}
