import { useEffect, useRef, useState } from 'react'
import { MapContainer, TileLayer, CircleMarker, Marker, Polyline, Polygon, Popup, ZoomControl, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { HomeButton } from './Shell'
import { useHomeLocation } from '../context/HomeLocation'
import { useMapLayer } from '../hooks/useMapLayer'
import { useMapOverlays } from '../hooks/useMapOverlays'
import { useFlightDetector, DEFAULT_AUTO_DETECT_CONFIG } from '../hooks/useFlightDetector'
import { useLogbook } from '../context/Logbook'
import { useActiveAircraft } from '../context/ActiveAircraft'
import { get } from '../lib/db'
import { FLTCAT } from '../lib/weather'
import { getAirports, getAirportDetails, getAuxAerodromes } from '../lib/aerodromes'
import MapLayersMenu from './MapLayersMenu'
import FlightPlanBar from './FlightPlanBar'
import GpsInfoBar from './GpsInfoBar'

// Center of the continental US — only used if location is denied/unavailable.
export const FALLBACK_CENTER = [39.8, -98.6]
const LOCATION_ZOOM = 13

// Satellite and Road are each a full base map on their own. VFR/IFR Lo/IFR
// Hi are FAA chart overlays, drawn on top of the same Road base — same tile
// services already used in the route-planning map
// (src/pages/Checklists/sections/RouteAltitude.jsx).
const ROAD_BASE = {
  url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
}
const SATELLITE_BASE = {
  url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  attribution: '&copy; Esri, Maxar, Earthstar Geographics',
}

const CHART_LAYERS = {
  sectional: {
    url: 'https://tiles.arcgis.com/tiles/ssFJjBXIUyZDrSYZ/arcgis/rest/services/VFR_Sectional/MapServer/tile/{z}/{y}/{x}',
    minNativeZoom: 8, maxNativeZoom: 11, maxZoom: 13,
  },
  ifrlo: {
    url: 'https://tiles.arcgis.com/tiles/ssFJjBXIUyZDrSYZ/arcgis/rest/services/IFR_AreaLow/MapServer/tile/{z}/{y}/{x}',
    minNativeZoom: 8, maxNativeZoom: 11, maxZoom: 13,
  },
  ifrhi: {
    url: 'https://tiles.arcgis.com/tiles/ssFJjBXIUyZDrSYZ/arcgis/rest/services/IFR_High/MapServer/tile/{z}/{y}/{x}',
    minNativeZoom: 5, maxNativeZoom: 8, maxZoom: 12,
  },
}

export const LAYER_OPTIONS = [
  { key: 'satellite', label: 'Satellite' },
  { key: 'road',      label: 'Road' },
  { key: 'sectional', label: 'VFR' },
  { key: 'ifrlo',     label: 'IFR Lo' },
  { key: 'ifrhi',     label: 'IFR Hi' },
]

// Renders whichever base map + chart (if any) the given layer key means —
// shared by the full map and the home-screen preview so both always draw
// the exact same thing.
export function MapLayers({ layer }) {
  if (layer === 'satellite') {
    return <TileLayer url={SATELLITE_BASE.url} attribution={SATELLITE_BASE.attribution} />
  }

  const chart = CHART_LAYERS[layer]
  return (
    <>
      <TileLayer url={ROAD_BASE.url} attribution={ROAD_BASE.attribution} />
      {chart && (
        <TileLayer
          key={layer}
          url={chart.url}
          tileSize={128} zoomOffset={1}
          // No minZoom floor — real tiles only exist down to minNativeZoom
          // (a genuine limit of the FAA/Esri tile service), but leaving the
          // layer free to render below that means Leaflet keeps showing the
          // lowest native tiles scaled down rather than dropping the chart
          // entirely, so zooming out to see the whole country/globe never
          // swaps the chart out for the plain road map underneath — it just
          // covers less precisely outside the chart's own native range, and
          // not at all outside its geographic coverage (e.g. a US sectional
          // over Canada), same as maxNativeZoom already does on the zoomed-in
          // side.
          minNativeZoom={chart.minNativeZoom} maxNativeZoom={chart.maxNativeZoom} maxZoom={chart.maxZoom}
          opacity={0.9}
          attribution='&copy; FAA AIS'
        />
      )}
    </>
  )
}

// The actual map, created for the first time already centered on wherever
// `position` is (or the fallback) — never moved after the fact. Avoiding a
// mount-then-move sequence sidesteps a real bug we hit where the move
// silently didn't stick (almost certainly React StrictMode's dev-only
// double-mount tearing down and recreating the underlying Leaflet map out
// from under an in-flight `setView`). Shared by the full map and the
// home-screen preview so both behave identically.
export function LiveMap({ position, zoom, initialCenter, initialZoom, layer, markerRadius = 8, interactive = true, zoomControlPosition, children }) {
  const interactionProps = interactive ? {} : {
    zoomControl: false, dragging: false, scrollWheelZoom: false,
    doubleClickZoom: false, touchZoom: false, keyboard: false, boxZoom: false,
  }
  // `position` drives the blue "you are here" dot and is the default
  // mount view — but `initialCenter`/`initialZoom` (a remembered last view,
  // if one exists) take priority for where the map actually opens, since
  // that can legitimately be somewhere other than the pilot's own position
  // (they may have panned off to look at something else). The dot still
  // marks real position regardless of what the viewport is showing.
  const mountCenter = initialCenter ?? position ?? FALLBACK_CENTER
  const mountZoom = initialCenter ? initialZoom : (position ? zoom : 4)
  return (
    <MapContainer
      center={mountCenter}
      zoom={mountZoom}
      style={{ width: '100%', height: '100%' }}
      attributionControl={false}
      zoomControl={false}
      {...interactionProps}
    >
      {interactive && <ZoomControl position={zoomControlPosition || 'topleft'} />}
      <MapLayers layer={layer} />
      {position && (
        <CircleMarker
          center={position}
          radius={markerRadius}
          pathOptions={{ color: '#fff', weight: 3, fillColor: '#0a84ff', fillOpacity: 1 }}
        />
      )}
      {children}
    </MapContainer>
  )
}

// Radar — public NEXRAD mosaic tiles from the Iowa Environmental Mesonet
// (IEM), no API key required. Refreshes every 5 min, matching IEM's own
// update cadence.
function RadarLayer() {
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
      attribution="&copy; Iowa Environmental Mesonet — NEXRAD"
    />
  )
}

// Flight Category — colored dot per reporting station in view (VFR green /
// MVFR blue / IFR red / LIFR purple), same colors used everywhere else in
// the app. Refetches on pan/zoom, debounced so panning doesn't spam the API.
function FlightCategoryLayer() {
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
// (unlike FlightCategoryLayer/TfrLayer) there's no network fetch here — just
// a bbox scan on pan/zoom, debounced the same way to avoid redoing it on
// every intermediate frame while dragging.
//
// Small fields only outnumber medium/large by ~6:1, but there's no data for
// "towered" as a stored field anywhere in the source data (OurAirports/FAA
// NASR) — same heuristic AirportInfo.jsx already uses: does this airport
// have a frequency labeled tower/twr. An airport with no entry in
// airport_details.json at all (not every ident is covered) shows gray
// rather than guessing either way.
//
// No zoom floor that hides the layer outright — large fields (the ~1,170
// worldwide) stay visible even zoomed out to see a whole country, same as a
// real EFB; medium and then small fields join in as the pilot zooms closer,
// which is what keeps the in-view count (and the cap below) sane rather than
// a hard cutoff that makes the whole layer vanish at once.
function AirportLayer() {
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
      const minCls = z >= 9 ? 0 : z >= 6 ? 1 : 2
      const cap = minCls === 2 ? 2000 : minCls === 1 ? 800 : 500
      const b = map.getBounds()
      const south = b.getSouth(), north = b.getNorth(), west = b.getWest(), east = b.getEast()
      const hits = []
      for (const a of airports) {
        const [ident, lat, lon, cls, name] = a
        if (cls < minCls) continue
        if (lat < south || lat > north || lon < west || lon > east) continue
        hits.push({ ident, lat, lon, cls, name })
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
          </div>
        </Popup>
      </CircleMarker>
    )
  })
}

// Heliport ("H") and seaplane base (anchor) icons — module-level so every
// marker of a kind shares one L.divIcon instance rather than each recreating
// an identical one on every render. Same L.divIcon/Marker convention as the
// route planner's waypoint labels (RouteAltitude.jsx).
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
// the icon, which array to read, and the zoom floor differ. Seaplane bases
// (~1,085 worldwide) stay visible at any zoom like large airports do —
// there's no size tier to thin them out by, but there are few enough that
// it doesn't matter. Heliports (~10,700) get a zoom floor instead, for the
// same reason small airports do: no way to rank "important" ones without
// inventing a criterion the source data doesn't have.
const AUX_CAP = 400

function AuxAerodromeLayer({ dataKey, icon, kindLabel, minZoom = 0 }) {
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
        const [ident, lat, lon, name] = a
        if (lat < south || lat > north || lon < west || lon > east) continue
        hits.push({ ident, lat, lon, name })
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
          <strong>{a.ident}</strong> — {a.name}
          <br />{kindLabel}
        </div>
      </Popup>
    </Marker>
  ))
}

function HeliportLayer() {
  return <AuxAerodromeLayer dataKey="heliports" icon={HELIPORT_ICON} kindLabel="Heliport" minZoom={8} />
}
function SeaplaneBaseLayer() {
  return <AuxAerodromeLayer dataKey="seaplaneBases" icon={SEAPLANE_ICON} kindLabel="Seaplane base" />
}

// TFRs — FAA GeoServer WFS via our /api/tfr proxy (same source and parsing
// as the Route & Altitude planner's TFR layer). Fetched once per session.
function TfrLayer() {
  const [tfrs, setTfrs] = useState([])
  useEffect(() => {
    let cancelled = false
    fetch('/api/tfr', { signal: AbortSignal.timeout(15000) })
      .then(r => r.text())
      .then(raw => {
        const geo = JSON.parse(raw)
        if (cancelled || !geo?.features?.length) return
        const parsed = geo.features.map(f => {
          const p = f.properties
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
          return { id: p.NOTAM_KEY ?? f.id ?? '?', type: p.LEGAL ?? 'TFR', desc: p.TITLE ?? '', lat, lon, polygon }
        }).filter(t => t.lat !== null)
        setTfrs(parsed)
      }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  return tfrs.map((t, i) => t.polygon?.length > 2 ? (
    <Polygon key={i} positions={t.polygon} pathOptions={{ color: '#FF3B30', fillColor: '#FF3B30', fillOpacity: 0.18, weight: 2 }}>
      <Popup><div style={{ fontSize: 12, maxWidth: 200 }}><strong>{t.type}</strong><br />{t.desc.slice(0, 120)}</div></Popup>
    </Polygon>
  ) : (
    <CircleMarker key={i} center={[t.lat, t.lon]} radius={10} pathOptions={{ color: '#FF3B30', fillColor: '#FF3B30', fillOpacity: 0.25, weight: 2 }}>
      <Popup><div style={{ fontSize: 12, maxWidth: 200 }}><strong>{t.type}</strong><br />{t.desc.slice(0, 120)}</div></Popup>
    </CircleMarker>
  ))
}

// Recenters the map only when explicitly asked to (the Locate-me button
// below). `request` is a fresh {lat,lon} object built new on every ask —
// never reused or mutated — so this effect can key entirely off "did a new
// request object show up," with no separate pending flag to accidentally
// consume against a stale value. That matters because there are two very
// different-latency sources feeding requests in (see MapView): the live
// GPS watch, which can supply one instantly, and the one-shot fallback
// fetch, which lands seconds later — a flag-based "first truthy value
// wins" design would fire on whatever position already happened to be
// sitting there before the tap, then ignore the real answer once it
// actually arrived.
function LocateRecenter({ request }) {
  const map = useMap()
  useEffect(() => {
    if (!request) return
    // Pans at the map's own current zoom by default — whatever zoom the
    // pilot already had (in close on an airport diagram, way out planning a
    // route) is deliberate, and a recenter tap shouldn't undo that. The one
    // exception is the automatic first-fix jump when the map opens (see
    // MapView), which passes an explicit `zoom` to land on the usual
    // close-in view instead of staying at the wide fallback zoom.
    //
    // animate:false, deliberately — an animated pan depends on
    // requestAnimationFrame actually running, which a backgrounded or
    // power-saving tab can stall indefinitely, silently leaving the map
    // wherever it was. This button exists because "recenter" needs to be
    // certain, not smooth.
    map.setView([request.lat, request.lon], request.zoom ?? map.getZoom(), { animate: false })
  }, [request, map])
  return null
}

// Imperatively syncs an already-mounted map onto a given {center, zoom} —
// same setView/animate:false approach as LocateRecenter above, generalized
// to any view rather than just "my current position." Used by Home's map
// preview (a separate, always-mounted LiveMap instance) to mirror whatever
// view the pilot last left the real map at, via `view` fed down from Home —
// see ViewReporter below, which is what actually produces that value.
export function MapViewSync({ view }) {
  const map = useMap()
  useEffect(() => {
    if (!view) return
    map.setView(view.center, view.zoom, { animate: false })
  }, [view, map])
  return null
}

// Reports the map's current center/zoom up to Home (via the `onViewChange`
// prop MapView is given) whenever the pilot finishes a pan or zoom, so the
// Home preview thumbnail (see MapViewSync above) can mirror it instead of
// resetting to a default view every time this screen closes — without this,
// returning to Home always looked like a step backward instead of the app
// remembering where you'd been. moveend covers zooms too — Leaflet fires it
// once a zoom change has settled, not just after a plain pan.
//
// Deliberately plain map.on/map.off (matching LocateRecenter/RoutePreview/
// MapViewSync above) instead of react-leaflet's useMapEvents convenience
// hook: useMapEvents re-subscribes its listener whenever the handlers
// object passed to it changes identity, and an inline object literal is a
// new reference on every render. MapView re-renders on every Locate tap
// (it updates recenterRequest), and LocateRecenter's resulting
// map.setView() fires 'moveend' SYNCHRONOUSLY within that very same
// render's effects — which landed, with useMapEvents, exactly in the gap
// between the old listener being torn down and the new one being
// re-attached, silently swallowing the event. A manual drag never
// triggered this (it doesn't touch React state mid-gesture, so nothing
// forces a re-subscribe), which is why panning worked here but tapping
// Locate never actually reported anything — the Home preview just kept
// showing whatever view HAD last been successfully reported. A stable
// map.on subscription that's set up once and never torn down mid-session
// doesn't have this gap.
function ViewReporter({ onChange }) {
  const map = useMap()
  useEffect(() => {
    function handleMoveEnd() {
      const c = map.getCenter()
      onChange({ center: [c.lat, c.lng], zoom: map.getZoom() })
    }
    map.on('moveend', handleMoveEnd)
    return () => map.off('moveend', handleMoveEnd)
  }, [map, onChange])
  return null
}

// The typed-route preview from FlightPlanBar — a simple line + waypoint
// dots, fit into view once per new route (not on every render, so the user
// can freely pan/zoom afterward without the map yanking back).
function RoutePreview({ route }) {
  const map = useMap()
  useEffect(() => {
    if (!route?.length) return
    map.fitBounds(route.map(w => [w.lat, w.lon]), { padding: [48, 48] })
  }, [route])
  if (!route?.length) return null
  return (
    <>
      <Polyline positions={route.map(w => [w.lat, w.lon])} pathOptions={{ color: '#a855f7', weight: 4, opacity: 0.75 }} />
      {route.map((w, i) => (
        <CircleMarker key={i} center={[w.lat, w.lon]} radius={7}
          pathOptions={{ color: '#fff', weight: 2.5, fillColor: '#a855f7', fillOpacity: 1 }}>
          <Popup><div style={{ fontSize: 12, fontWeight: 700 }}>{w.name}{w.label ? ` — ${w.label}` : ''}</div></Popup>
        </CircleMarker>
      ))}
    </>
  )
}

export default function MapView({ onViewChange, lastView } = {}) {
  // Shared with Home's own map preview via HomeLocationProvider (mounted
  // once around Home, which never unmounts while this screen — an overlay
  // on top of Home — is open) rather than starting a separate watch here.
  // A fresh watch per mount used to mean this screen always opened cold, no
  // matter how recently it had a real fix; now it usually already knows
  // the position by the time it opens.
  const { coords: liveCoords, derived: liveDerived, status: liveStatus, error: liveError } = useHomeLocation()
  const { layer, setLayer } = useMapLayer()
  const { overlays, toggleOverlay } = useMapOverlays()
  const [route, setRoute] = useState(null)
  const [recenterRequest, setRecenterRequest] = useState(null)
  // [lat,lon] once a fix exists, else null — feeds ONLY the blue "you are
  // here" dot (see LiveMap), never the viewport itself. Lazily seeded from
  // whatever the shared watch already knows at mount time.
  const [centerPosition, setCenterPosition] = useState(() => liveCoords ? [liveCoords.lat, liveCoords.lon] : null)
  // Whether this screen even needs to auto-jump the viewport onto a GPS fix
  // at all: not if we're opening onto a remembered view (lastView), and not
  // if we already had a fix at mount (nothing to jump onto — already there).
  const autoCenteredRef = useRef(!!liveCoords || !!lastView)

  // Jump the viewport onto the pilot's real position once, the moment the
  // shared watch produces its first fix — but ONLY on a genuine cold start
  // with no remembered view to reopen onto instead. Reopening onto
  // `lastView` (passed straight into LiveMap's initialCenter/initialZoom
  // below) must NOT be immediately overridden by this GPS-based jump, or
  // "resume where you left off" would never actually stick — every reopen
  // would just snap back to wherever the pilot currently is instead. The
  // map is already visible and interactive at this point (fallback-
  // centered, wide zoom) — this just pans/zooms it into place, reusing the
  // same setView mechanism as a manual Locate tap, so there's no separate
  // "is it stuck" loading screen for a slow or cold GPS fix to get stuck
  // behind.
  useEffect(() => {
    if (autoCenteredRef.current || !liveCoords) return
    autoCenteredRef.current = true
    setCenterPosition([liveCoords.lat, liveCoords.lon])
    if (!lastView) {
      setRecenterRequest({ lat: liveCoords.lat, lon: liveCoords.lon, zoom: LOCATION_ZOOM })
    }
  }, [liveCoords, lastView])

  function handleLocate() {
    if (!liveCoords) return
    setRecenterRequest({ lat: liveCoords.lat, lon: liveCoords.lon })
  }

  // Foreground flight auto-detection — settings-gated, per Settings.jsx's
  // Flight Detection section. Reuses this screen's own liveCoords (never a
  // second geolocation watch — see useFlightDetector's own header comment
  // for why that matters).
  const [autoDetectEnabled, setAutoDetectEnabled] = useState(false)
  const [autoDetectConfig, setAutoDetectConfig] = useState(DEFAULT_AUTO_DETECT_CONFIG)
  useEffect(() => {
    get('settings', 'autoDetectEnabled').then(row => setAutoDetectEnabled(!!row?.value))
    get('settings', 'autoDetectConfig').then(row => setAutoDetectConfig({ ...DEFAULT_AUTO_DETECT_CONFIG, ...(row?.value ?? {}) }))
  }, [])
  const { state: detectState, draft: detectedDraft, reset: resetDetector } = useFlightDetector({
    enabled: autoDetectEnabled, config: autoDetectConfig, coords: liveCoords,
  })
  const { addEntry } = useLogbook()
  const { aircraftId: activeAircraftId } = useActiveAircraft()
  const [flightSavedBanner, setFlightSavedBanner] = useState(false)
  useEffect(() => {
    if (detectState !== 'done' || !detectedDraft) return
    // Never silently commits a finished entry — it lands tagged pendingReview
    // so the Hangar's Flight History (sub-phase 3) surfaces it for the pilot
    // to confirm/edit before it's a real logbook record.
    addEntry({ ...detectedDraft, aircraftId: activeAircraftId ?? null, source: 'auto', pendingReview: true })
      .then(() => {
        setFlightSavedBanner(true)
        setTimeout(() => setFlightSavedBanner(false), 6000)
      })
    resetDetector()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detectState, detectedDraft])

  const noFixYet = !liveCoords
  // Reacts to the *current* live status, not a frozen one-time result — if
  // the watch recovers after an earlier error (it keeps trying on its own,
  // it's a continuous watch), this clears itself automatically next render.
  const locationUnavailable = noFixYet && (liveStatus === 'error' || liveStatus === 'unsupported')

  return (
    <div style={{ height: '100%', position: 'relative', isolation: 'isolate' }}>
      <LiveMap
        position={centerPosition} zoom={LOCATION_ZOOM}
        initialCenter={lastView?.center} initialZoom={lastView?.zoom}
        layer={layer} zoomControlPosition="bottomright"
      >
        {overlays.radar && <RadarLayer />}
        {overlays.flightCategory && <FlightCategoryLayer />}
        {overlays.tfr && <TfrLayer />}
        {overlays.airports && <AirportLayer />}
        {overlays.heliports && <HeliportLayer />}
        {overlays.seaplaneBases && <SeaplaneBaseLayer />}
        <LocateRecenter request={recenterRequest} />
        <RoutePreview route={route} />
        {onViewChange && <ViewReporter onChange={onViewChange} />}
      </LiveMap>

      <div style={{ position: 'absolute', top: 12, left: 12, zIndex: 600 }}>
        <HomeButton />
      </div>

      <button
        onClick={handleLocate}
        disabled={noFixYet}
        aria-label="Locate me"
        style={{
          position: 'absolute', right: 12, bottom: 136, zIndex: 500,
          width: 40, height: 40, borderRadius: '50%', border: 'none',
          background: 'var(--bg-card)', boxShadow: 'var(--shadow-sm)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: noFixYet ? 'default' : 'pointer', WebkitTapHighlightColor: 'transparent',
          opacity: noFixYet ? 0.55 : 1,
        }}>
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="var(--text)" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="3.5" />
          <line x1="12" y1="1" x2="12" y2="4.5" />
          <line x1="12" y1="19.5" x2="12" y2="23" />
          <line x1="1" y1="12" x2="4.5" y2="12" />
          <line x1="19.5" y1="12" x2="23" y2="12" />
        </svg>
      </button>

      {locationUnavailable && (
        <div style={{
          position: 'absolute', top: 68, left: 12, right: 12, zIndex: 500,
          background: 'var(--bg-card)', borderRadius: 14, padding: '10px 14px',
          fontSize: 13, color: 'var(--text-secondary)', boxShadow: 'var(--shadow-sm)',
        }}>
          {liveError}
        </div>
      )}

      {detectState === 'recording' && (
        <div style={{
          position: 'absolute', top: 68, left: 12, right: 12, zIndex: 500,
          background: 'var(--bg-card)', borderRadius: 14, padding: '10px 14px',
          fontSize: 13, color: 'var(--text)', boxShadow: 'var(--shadow-sm)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--danger)', flexShrink: 0 }} />
          Flight detected — recording
        </div>
      )}

      {flightSavedBanner && (
        <div style={{
          position: 'absolute', top: 68, left: 12, right: 12, zIndex: 500,
          background: 'var(--bg-card)', borderRadius: 14, padding: '10px 14px',
          fontSize: 13, color: 'var(--text)', boxShadow: 'var(--shadow-sm)',
        }}>
          Flight saved — review it in the Hangar's Flight History
        </div>
      )}

      <FlightPlanBar onRouteChange={setRoute} />
      <MapLayersMenu layer={layer} setLayer={setLayer} layerOptions={LAYER_OPTIONS} overlays={overlays} toggleOverlay={toggleOverlay} />
      <GpsInfoBar route={route} coords={liveCoords} derived={liveDerived} status={liveStatus} />
    </div>
  )
}
