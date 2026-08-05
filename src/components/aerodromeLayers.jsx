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

export function AirportLayer() {
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
    const radius = a.cls === 2 ? 10 : a.cls === 1 ? 8 : 5.5
    const longestRwy = (detail?.r ?? []).reduce((best, r) => (r[2] > (best?.[2] ?? 0) ? r : best), null)
    return (
      // ident alone isn't a safe React key — OurAirports' local/GPS-code
      // fallback idents aren't guaranteed unique (109 collisions in the
      // current pack, e.g. two unrelated fields both landing on the same
      // fallback code), which silently drops one marker under a shared key.
      <CircleMarker key={`${a.ident}-${a.lat}-${a.lon}`} center={[a.lat, a.lon]} radius={radius}
        pathOptions={{ color: '#fff', weight: 2, fillColor: color, fillOpacity: 1 }}>
        <Popup>
          <div style={{ fontSize: 12, lineHeight: 1.5 }}>
            <strong>{a.ident}</strong>{a.name ? ` — ${a.name}` : ''}
            <br />
            {hasTower == null ? 'Tower status unknown' : hasTower ? 'Towered' : 'Non-towered'}
            {longestRwy && <><br />{longestRwy[2].toLocaleString()} ft {longestRwy[3]}</>}
            {a.elevFt != null && <><br />{a.elevFt.toLocaleString()} ft elevation</>}
            {/* Where a figure comes from travels with the figure. These rows
                are a national authority's list, not the bundled pack, and the
                name is a name rather than an ICAO code. */}
            {a.source && (
              <><br /><span style={{ opacity: 0.7 }}>{a.source} · no ICAO code</span></>
            )}
          </div>
        </Popup>
      </CircleMarker>
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
function AuxAerodromeLayer({ dataKey, icon, kindLabel, minZoom = 8 }) {
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
        const [ident, lat, lon, name, elevFt, source] = a
        if (lat < south || lat > north || lon < west || lon > east) continue
        hits.push({ ident, lat, lon, name, elevFt, source })
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
        <div style={{ fontSize: 12, lineHeight: 1.5 }}>
          {/* The name is only appended when there is one to append. The
              national rows merged in by lib/aerodromes.js have no separate
              name, because the name IS the identifier: they have no ICAO
              code, and this used to render a dangling em dash. */}
          <strong>{a.ident}</strong>{a.name ? ` — ${a.name}` : ''}
          <br />{kindLabel}
          {a.elevFt != null && <><br />{a.elevFt.toLocaleString()} ft elevation</>}
          {a.source && (
            <><br /><span style={{ opacity: 0.7 }}>{a.source} · no ICAO code</span></>
          )}
        </div>
      </Popup>
    </Marker>
  ))
}

export function HeliportLayer() {
  return <AuxAerodromeLayer dataKey="heliports" icon={HELIPORT_ICON} kindLabel="Heliport" minZoom={8} />
}
export function SeaplaneBaseLayer() {
  return <AuxAerodromeLayer dataKey="seaplaneBases" icon={SEAPLANE_ICON} kindLabel="Seaplane base" minZoom={8} />
}
