// Aerodrome and weather overlays, shared by both maps.
//
// These were written for MapView, which was the map when there was only one.
// This branch's home is a second map, and a pilot who turns on Airports there
// expects the same markers, the same colours and the same zoom behaviour as
// anywhere else in the app. So they live here and both maps import them,
// rather than the redesign growing a parallel set that drifts.
//
// The zoom floors below are not tuning, they are bug fixes, and they are the
// reason this is a move and not a rewrite: AIRPORT_MIN_ZOOM exists because a
// permanently mounted map made marker counts a standing cost, and the explicit
// minZoom on the aux layers exists because a default of 0 made the guard read
// `zoom < 0`, which is false forever and silently disabled the limit.

import { useEffect, useRef, useState } from 'react'
import { TileLayer, CircleMarker, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import { FLTCAT } from '../lib/weather'
import { getAirports, getAirportDetails, getAuxAerodromes } from '../lib/aerodromes'
import PopupActions from './PopupActions'

// The three parts every field popup is made of.
//
// Shared so an airport and a heliport read the same way, and so the sizes
// live in one place. The identifier is the headline because it is what a
// pilot says on the radio and types into a plan; the full name is context
// underneath it rather than a continuation of the same line, which is what
// the old "IDENT — Name" form made it.
function PopupHead({ title, subtitle }) {
  return (
    <>
      <div style={{
        fontSize: 19, fontWeight: 800, letterSpacing: '-0.3px',
        color: 'var(--map-ink)', lineHeight: 1.15,
      }}>{title}</div>
      {subtitle && (
        <div style={{
          fontSize: 12, color: 'var(--map-ink-dim)', marginTop: 2, lineHeight: 1.3,
        }}>{subtitle}</div>
      )}
    </>
  )
}

// One fact per line. Stacked rather than run together with separators: these
// are unrelated figures, and a dot or a dash between them implies they belong
// to each other.
function PopupFacts({ rows }) {
  const shown = rows.filter(Boolean)
  if (!shown.length) return null
  return (
    <div style={{ marginTop: 7, display: 'flex', flexDirection: 'column', gap: 2 }}>
      {shown.map((r, i) => (
        <div key={i} style={{ fontSize: 12, color: 'var(--map-ink)' }}>{r}</div>
      ))}
    </div>
  )
}

function PopupSource({ text, noIcao }) {
  if (!text) return null
  return (
    <div style={{ marginTop: 7, fontSize: 10.5, color: 'var(--map-ink-faint)', lineHeight: 1.3 }}>
      {text}{noIcao ? ' · no ICAO code' : ''}
    </div>
  )
}

// Radar — public NEXRAD mosaic tiles from the Iowa Environmental Mesonet
// (IEM), no API key required. Refreshes every 5 min, matching IEM's own
// update cadence.
export function RadarLayer() {
  const [bust, setBust] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setBust(b => b + 1), 5 * 60 * 1000)
    return () => clearInterval(t)
  }, [])
  return (
    <TileLayer
      key={bust}
      url="https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png"
      opacity={0.55}
      attribution="&copy; Iowa Environmental Mesonet, NEXRAD"
    />
  )
}

// Flight Category — colored dot per reporting station in view (VFR green /
// MVFR blue / IFR red / LIFR purple), same colors used everywhere else in
// the app. Refetches on pan/zoom, debounced so panning doesn't spam the API.
export function FlightCategoryLayer() {
  const map = useMap()
  const [stations, setStations] = useState([])
  const timer = useRef(null)

  useEffect(() => {
    function load() {
      const z = map.getZoom()
      if (z < 6) { setStations([]); return }
      const b = map.getBounds()
      const bbox = `${b.getSouth().toFixed(2)},${b.getWest().toFixed(2)},${b.getNorth().toFixed(2)},${b.getEast().toFixed(2)}`
      fetch(`/api/awc?path=metar&format=json&bbox=${bbox}`)
        .then(r => r.ok ? r.json() : [])
        .then(list => setStations(Array.isArray(list) ? list.slice(0, 400) : []))
        .catch(() => {})
    }
    load()
    function onMove() {
      clearTimeout(timer.current)
      timer.current = setTimeout(load, 600)
    }
    map.on('moveend', onMove)
    return () => { map.off('moveend', onMove); clearTimeout(timer.current) }
  }, [map])

  return stations.map((s, i) => {
    const cat = FLTCAT[s.fltCat] ?? FLTCAT.VFR
    return (
      <CircleMarker key={`${s.icaoId}-${i}`} center={[s.lat, s.lon]} radius={6}
        pathOptions={{ color: '#fff', weight: 1.5, fillColor: cat.color, fillOpacity: 0.95 }}>
        <Popup><div style={{ fontSize: 12, fontWeight: 700 }}>{s.icaoId} · {cat.label}</div></Popup>
      </CircleMarker>
    )
  })
}

// Airports — bundled OurAirports/FAA data (src/lib/aerodromes.js), same
// blue-for-towered/magenta-for-non-towered convention as a real sectional.
// Both files load once per session and are filtered/joined in memory, so
// (unlike FlightCategoryLayer) there's no network fetch here — just a bbox
// scan on pan/zoom, debounced to avoid redoing it on every intermediate frame
// while dragging.
//
// There's no data for "towered" as a stored field anywhere in the source data
// (OurAirports/FAA NASR), so this uses the same heuristic AirportInfo.jsx
// already does: does this airport have a frequency labeled tower/twr. An
// airport with no entry in airport_details.json at all shows gray rather than
// guessing either way.
//
// Below the floor there is nothing to read: 2000 markers at world zoom is an
// unreadable smear, and on this branch the map is the home screen's resting
// state rather than something the pilot opened on purpose. The caps that
// follow were sized for a map you had to go and open; as a permanently
// mounted background they have to be far smaller.
const AIRPORT_MIN_ZOOM = 7

// The airport marker: an aircraft in a filled disc, rather than a plain dot.
//
// Rebuilt as SVG rather than dropped in as an image, because the fill has to
// carry the tower status the dot used to carry: blue towered, magenta
// non-towered, grey where the data does not say. A flat PNG is one colour and
// would have thrown that away, and this scales cleanly on a retina screen at
// three sizes.
//
// The white ring is not decoration. These sit on a dark basemap and on a pale
// sectional, and a magenta disc on a sectional's magenta airspace is invisible
// without an outline separating it.
//
// Cached because there are only nine of these (three colours by three sizes)
// and up to 500 markers on screen; building one per marker per render is the
// difference between a smooth pan and a stuttering one.
const airportIconCache = new Map()

function airportIcon(color, size) {
  const key = `${color}:${size}`
  const hit = airportIconCache.get(key)
  if (hit) return hit

  // Plane glyph pointing up and to the right, matching the app's other
  // aircraft marks. Drawn in a 24 unit box and scaled by the icon size.
  const plane = 'M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z'
  const icon = L.divIcon({
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<svg width="${size}" height="${size}" viewBox="0 0 24 24"
             style="display:block;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.4))">
             <circle cx="12" cy="12" r="11" fill="${color}" stroke="#fff" stroke-width="1.6"/>
             <g transform="rotate(45 12 12)">
               <path d="${plane}" fill="#fff" transform="translate(12 12) scale(0.62) translate(-12 -12)"/>
             </g>
           </svg>`,
  })
  airportIconCache.set(key, icon)
  return icon
}

export function AirportLayer({ onSetDestination, onAddWaypoint }) {
  const map = useMap()
  const [airports, setAirports] = useState(null)
  const [details, setDetails] = useState(null)
  const [visible, setVisible] = useState([])
  const timer = useRef(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([getAirports(), getAirportDetails()]).then(([list, det]) => {
      if (!cancelled) { setAirports(list); setDetails(det) }
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!airports) return
    function load() {
      const z = map.getZoom()
      if (z < AIRPORT_MIN_ZOOM) { setVisible([]); return }
      const minCls = z >= 9 ? 0 : 1
      const cap = z >= 9 ? 500 : 300
      const b = map.getBounds()
      const south = b.getSouth(), north = b.getNorth(), west = b.getWest(), east = b.getEast()
      const hits = []
      for (const a of airports) {
        // elevFt and source are only present on the hand-maintained national
        // rows merged in by lib/aerodromes.js; the bundled pack stops at name.
        const [ident, lat, lon, cls, name, elevFt, source] = a
        if (cls < minCls) continue
        if (lat < south || lat > north || lon < west || lon > east) continue
        hits.push({ ident, lat, lon, cls, name, elevFt, source })
        if (hits.length >= cap) break
      }
      setVisible(hits)
    }
    load()
    function onMove() {
      clearTimeout(timer.current)
      timer.current = setTimeout(load, 300)
    }
    map.on('moveend', onMove)
    return () => { map.off('moveend', onMove); clearTimeout(timer.current) }
  }, [map, airports])

  if (!details) return null

  return visible.map(a => {
    const detail = details[a.ident]
    const hasTower = detail ? (detail.f ?? []).some(([label]) => /tower|twr/i.test(label)) : null
    const color = hasTower == null ? '#8e8e93' : hasTower ? '#0a84ff' : '#d946a8'
    const size = a.cls === 2 ? 28 : a.cls === 1 ? 23 : 18
    const longestRwy = (detail?.r ?? []).reduce((best, r) => (r[2] > (best?.[2] ?? 0) ? r : best), null)
    return (
      // ident alone isn't a safe React key — OurAirports' local/GPS-code
      // fallback idents aren't guaranteed unique (109 collisions in the
      // current pack, e.g. two unrelated fields both landing on the same
      // fallback code), which silently drops one marker under a shared key.
      <Marker key={`${a.ident}-${a.lat}-${a.lon}`} position={[a.lat, a.lon]}
        icon={airportIcon(color, size)}>
        <Popup>
          <div style={{ minWidth: 176 }}>
            <PopupHead title={a.ident} subtitle={a.name} />
            <PopupFacts rows={[
              hasTower == null ? 'Tower status unknown' : hasTower ? 'Towered' : 'Non-towered',
              longestRwy ? `${longestRwy[2].toLocaleString()} ft ${longestRwy[3]}` : null,
              a.elevFt != null ? `${a.elevFt.toLocaleString()} ft elevation` : null,
            ]} />
            {/* Where a figure comes from travels with the figure. These rows
                are a national authority's list, not the bundled pack, and the
                name is a name rather than an ICAO code. */}
            <PopupSource text={a.source} noIcao={!!a.source} />
            <PopupActions onSetDestination={onSetDestination} onAddWaypoint={onAddWaypoint}
              ident={a.ident} name={a.name} lat={a.lat} lon={a.lon} />
          </div>
        </Popup>
      </Marker>
    )
  })
}

// Heliport ("H") and seaplane base (anchor) icons — module-level so every
// marker of a kind shares one L.divIcon instance rather than each recreating
// an identical one on every render.
const HELIPORT_ICON = L.divIcon({
  className: '', iconSize: [20, 20], iconAnchor: [10, 10],
  html: `<div style="width:20px;height:20px;border-radius:5px;background:#ff9500;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;font:800 11px ui-sans-serif,system-ui;color:#fff;">H</div>`,
})
const SEAPLANE_ICON = L.divIcon({
  className: '', iconSize: [20, 20], iconAnchor: [10, 10],
  html: `<div style="width:20px;height:20px;border-radius:50%;background:#00b8d9;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;font-size:12px;">⚓</div>`,
})

// Heliports & seaplane bases — src/data/geo/aux_aerodromes.json, loaded
// lazily (like airport_details.json) so a pilot who never turns these on
// never pays for the chunk. One component handles both: same [ident, lat,
// lon, name] shape and the same bbox/debounce wiring as AirportLayer, only
// the icon, which array to read, and the zoom floor differ.
const AUX_CAP = 400

// minZoom defaults to a real floor, not 0. At 0 the guard below reads
// `zoom < 0`, which is false forever — so the default silently turned the
// limit off entirely. Seaplane bases were declared without the prop and drew
// 400 markers across the whole country at world zoom.
function AuxAerodromeLayer({ dataKey, icon, kindLabel, minZoom = 8, onSetDestination, onAddWaypoint }) {
  const map = useMap()
  const [list, setList] = useState(null)
  const [visible, setVisible] = useState([])
  const timer = useRef(null)

  useEffect(() => {
    let cancelled = false
    getAuxAerodromes().then(d => { if (!cancelled) setList(d[dataKey]) })
    return () => { cancelled = true }
  }, [dataKey])

  useEffect(() => {
    if (!list) return
    function load() {
      if (map.getZoom() < minZoom) { setVisible([]); return }
      const b = map.getBounds()
      const south = b.getSouth(), north = b.getNorth(), west = b.getWest(), east = b.getEast()
      const hits = []
      for (const a of list) {
        const [ident, lat, lon, name, elevFt, source, note] = a
        if (lat < south || lat > north || lon < west || lon > east) continue
        hits.push({ ident, lat, lon, name, elevFt, source, note })
        if (hits.length >= AUX_CAP) break
      }
      setVisible(hits)
    }
    load()
    function onMove() {
      clearTimeout(timer.current)
      timer.current = setTimeout(load, 300)
    }
    map.on('moveend', onMove)
    return () => { map.off('moveend', onMove); clearTimeout(timer.current) }
  }, [map, list, minZoom])

  return visible.map(a => (
    // Same non-unique-ident caveat as AirportLayer above — 33 heliport
    // idents and 1 seaplane base ident collide in the current pack.
    <Marker key={`${a.ident}-${a.lat}-${a.lon}`} position={[a.lat, a.lon]} icon={icon}>
      <Popup>
        <div style={{ minWidth: 176 }}>
          {/* The subtitle only renders when there is one. The national rows
              merged in by lib/aerodromes.js have no separate name, because the
              name IS the identifier: they have no ICAO code. */}
          <PopupHead title={a.ident} subtitle={a.name} />
          <PopupFacts rows={[
            kindLabel,
            a.elevFt != null ? `${a.elevFt.toLocaleString()} ft elevation` : null,
          ]} />
          {/* A known problem with a published position is shown on the marker
              itself. Quietly drawing a pad 25 km from where it is, because the
              source says so, is the kind of thing a pilot finds out about in
              the air. */}
          {a.note && (
            <div style={{ marginTop: 6, fontSize: 11.5, fontWeight: 600, color: '#c2410c' }}>
              {a.note}
            </div>
          )}
          <PopupSource text={a.source} noIcao={!!a.source && !a.name} />
          <PopupActions onSetDestination={onSetDestination} onAddWaypoint={onAddWaypoint}
            ident={a.ident} name={a.name} lat={a.lat} lon={a.lon} />
        </div>
      </Popup>
    </Marker>
  ))
}

export function HeliportLayer(props) {
  return <AuxAerodromeLayer {...props} dataKey="heliports" icon={HELIPORT_ICON} kindLabel="Heliport" minZoom={8} />
}
export function SeaplaneBaseLayer(props) {
  return <AuxAerodromeLayer {...props} dataKey="seaplaneBases" icon={SEAPLANE_ICON} kindLabel="Seaplane base" minZoom={8} />
}
