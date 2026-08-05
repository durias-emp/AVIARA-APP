import { useCallback, useEffect, useRef, useState } from 'react'
import { MapContainer, TileLayer, CircleMarker, Marker, Polyline, Polygon, Popup, ZoomControl, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { HomeButton } from './Shell'
import { useHomeLocation } from '../context/HomeLocation'
import { useMapLayer } from '../hooks/useMapLayer'
import { useMapOverlays } from '../hooks/useMapOverlays'
import { useBreadcrumbTrail } from '../hooks/useBreadcrumbTrail'
import { useFlightTimer } from '../hooks/useFlightTimer'
import { useWakeLock } from '../hooks/useWakeLock'
import { formatClock } from '../lib/flightTime'
import { useFlightDetector, DEFAULT_AUTO_DETECT_CONFIG, autoDetectEnabledFrom } from '../hooks/useFlightDetector'
import { useLogbook } from '../context/Logbook'
import { useActiveAircraft } from '../context/ActiveAircraft'
import { get } from '../lib/db'
import { FLTCAT } from '../lib/weather'
import { getAirports, getAirportDetails, getAuxAerodromes, findAirport } from '../lib/aerodromes'
import MapLayersMenu from './MapLayersMenu'
import FlightPlanBar from './FlightPlanBar'
import GpsInfoBar from './GpsInfoBar'

// Center of the continental US — only used if location is denied/unavailable.
export const FALLBACK_CENTER = [39.8, -98.6]
const LOCATION_ZOOM = 13

// What actually speeds up a stubborn GPS fix, in the order a pilot can act
// on it from the seat. Adapted from the standard advice ("battery saver
// off, high-accuracy on, data on, clear sky view") for iOS and for
// aircraft: the Android-only "high accuracy mode" becomes iOS's Precise
// Location toggle, and "move outside" becomes the glareshield — a metal
// airframe is the sky-view problem pilots actually have.
const GPS_TIPS = [
  'Give the phone sky — on the glareshield or by a window; the airframe blocks GPS.',
  'Wi-Fi or mobile data speeds up the first fix.',
  'Low Power Mode slows GPS — turn it off for flying.',
  'Check Precise Location is on: Settings → Privacy & Security → Location Services → Safari Websites.',
  'Last resort: quit and reopen the app, or restart the phone.',
]

// The exact steps to un-deny location, for the browser this is actually
// running in. A permission denial is the pilot's own device telling the
// app no; the only useful thing software can do about it is name the
// switch. Wording verified on-device for iOS Safari 2026-08-04 (the aA →
// Website Settings path is what fixed it).
function locationPermissionHelp() {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent)
  const standalone = window.matchMedia?.('(display-mode: standalone)')?.matches
    || window.navigator.standalone === true
  if (ios && standalone) {
    return 'Open the iPhone Settings app → Privacy & Security → Location Services, and allow location for web apps. If AVIARA isn\'t listed there, remove it from the Home Screen and add it again — it will ask fresh.'
  }
  if (ios) {
    return 'In Safari, tap "aA" in the address bar → Website Settings → Location → Allow, then reload.'
  }
  return 'Click the icon next to the web address → Site settings → Location → Allow, then reload.'
}

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

// minZoom is a hard floor and it is load-bearing: below minNativeZoom,
// Leaflet covers the screen with scaled-down copies of the lowest native
// tiles, and the tile count QUADRUPLES per zoom level of that gap. These
// are 128px tiles, so at zoom 4 a single phone screen of sectional means
// thousands of tile images at once (6,336 measured) — a few hundred MB of
// decoded bitmap, which iOS answers by killing the page outright, no JS
// error, before first paint. With the map now being the home screen and
// mounting at zoom 4 whenever there is no GPS fix yet, that was a crash on
// launch for every fresh install. One zoom level of scale-down is the most
// the floor allows (tile count merely 4x), which keeps the chart sticky a
// step past its native range and bounded everywhere else.
const CHART_LAYERS = {
  sectional: {
    url: 'https://tiles.arcgis.com/tiles/ssFJjBXIUyZDrSYZ/arcgis/rest/services/VFR_Sectional/MapServer/tile/{z}/{y}/{x}',
    minZoom: 6, minNativeZoom: 8, maxNativeZoom: 11, maxZoom: 13,
  },
  ifrlo: {
    url: 'https://tiles.arcgis.com/tiles/ssFJjBXIUyZDrSYZ/arcgis/rest/services/IFR_AreaLow/MapServer/tile/{z}/{y}/{x}',
    minZoom: 6, minNativeZoom: 8, maxNativeZoom: 11, maxZoom: 13,
  },
  ifrhi: {
    url: 'https://tiles.arcgis.com/tiles/ssFJjBXIUyZDrSYZ/arcgis/rest/services/IFR_High/MapServer/tile/{z}/{y}/{x}',
    minZoom: 3, minNativeZoom: 5, maxNativeZoom: 8, maxZoom: 12,
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
          // The chart stays sticky one zoom level below its native range
          // (scaled-down native tiles), then hands off to the road base —
          // see the CHART_LAYERS comment for why the floor cannot be looser
          // than that: below it, tile count goes exponential and iOS kills
          // the page on launch.
          minZoom={chart.minZoom} minNativeZoom={chart.minNativeZoom} maxNativeZoom={chart.maxNativeZoom} maxZoom={chart.maxZoom}
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
export function LiveMap({ position, positionStale = false, zoom, initialCenter, initialZoom, layer, markerRadius = 8, interactive = true, zoomControlPosition, children }) {
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
          // Grey when stale: a last-known position is orientation, not truth,
          // and a confident blue dot over a position the aircraft may have
          // left hours ago is exactly the kind of lie a nav app must not tell.
          pathOptions={positionStale
            ? { color: '#fff', weight: 3, fillColor: '#9a9aa2', fillOpacity: 0.85 }
            : { color: '#fff', weight: 3, fillColor: '#0a84ff', fillOpacity: 1 }}
        />
      )}
      {children}
    </MapContainer>
  )
}

// The pilot's own track, drawn behind them for as long as the overlay is on.
// Two strokes: a wide translucent casing under a solid core, so the line stays
// legible over both a dark satellite image and a pale sectional without
// needing to know which is underneath.
function BreadcrumbLayer({ trail }) {
  if (trail.length < 2) return null
  const path = trail.map(p => [p.lat, p.lon])
  return (
    <>
      <Polyline positions={path} pathOptions={{ color: '#000', weight: 7, opacity: 0.28, lineCap: 'round', lineJoin: 'round' }} />
      <Polyline positions={path} pathOptions={{ color: '#ff6b35', weight: 3, opacity: 0.95, lineCap: 'round', lineJoin: 'round' }} />
    </>
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
// The map is the home screen now, mounted for as long as the app is open, so
// marker counts are a standing cost rather than one the pilot opted into.
const AIRPORT_MIN_ZOOM = 7

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
      // Below this there is nothing to read: 2000 markers at world zoom is an
      // unreadable smear, and it is now the home screen's resting state rather
      // than something the pilot opened on purpose. The caps that follow were
      // sized for a map you had to go and open; as a permanently mounted
      // background they have to be far smaller.
      if (z < AIRPORT_MIN_ZOOM) { setVisible([]); return }
      const minCls = z >= 9 ? 0 : 1
      const cap = z >= 9 ? 500 : 300
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
  return <AuxAerodromeLayer dataKey="seaplaneBases" icon={SEAPLANE_ICON} kindLabel="Seaplane base" minZoom={8} />
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
function LocateRecenter({ request, coveredHeight = 0 }) {
  const map = useMap()
  // Read at fire time via a ref, NOT an effect dependency: the drawer
  // height changes on every drag frame, and re-running this effect on each
  // of those would replay a stale recenter request every time the drawer
  // moved. Only a NEW request recenters; the drawer's own movement is
  // MapFocusOffset's job.
  const coveredRef = useRef(coveredHeight)
  coveredRef.current = coveredHeight
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
    // "Centre" means the middle of the map the pilot can SEE. With the
    // drawer up, the container's centre sits at (or under) the drawer's
    // edge, so shift the view by half the covered height — same convention
    // as MapFocusOffset, which is also what walks this offset back out
    // when the drawer closes (its delta bookkeeping is unaffected: this
    // pan changes the view, not the drawer height it tracks).
    if (coveredRef.current > 0.5) {
      map.panBy([0, coveredRef.current / 2], { animate: false })
    }
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
export function ViewReporter({ onChange }) {
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

// Keeps whatever the pilot is looking at centred in the part of the map that
// is actually visible, when something else covers the bottom of the screen —
// on Home, the drawer.
//
// The map container stays the full height of the window; only the exposed
// strip above the drawer changes. A point sitting at the container's centre
// is therefore too low to see properly once the drawer is up, so the view is
// panned up by half the covered height, which puts it back in the middle of
// what's left. Shrinking the container instead would work, but Leaflet would
// have to re-lay-out and re-fetch tiles on every drawer movement.
//
// Panned by the DELTA rather than set absolutely: the pilot may have panned
// the map themselves since the last change, and jumping to an absolute offset
// would throw that away.
//
// `coveredHeight` is the drawer's LIVE height, so during a drag this fires
// every frame with `duration` at 0ms — instant panBy per frame is exactly
// how Leaflet's own drag handling works, and it is what makes the map feel
// glued to the drawer instead of jumping once when it settles. When the
// finger lifts, the drawer snaps to a stop over its own 260ms transition
// while `coveredHeight` jumps straight to the stop value — so the one
// remaining delta is panned WITH animation over the same duration, and the
// map arrives alongside the drawer instead of teleporting ahead of it.
// (Leaflet's pan easing isn't the drawer's exact bezier; over a quarter of
// a second the difference isn't readable, and it beats the old jump.)
export function MapFocusOffset({ coveredHeight, duration = '0ms' }) {
  const map = useMap()
  const applied = useRef(0)
  useEffect(() => {
    const want = coveredHeight / 2
    const delta = want - applied.current
    if (Math.abs(delta) < 0.5) return
    applied.current = want
    const ms = parseFloat(duration) || 0
    if (ms > 0) map.panBy([0, delta], { animate: true, duration: ms / 1000 })
    else map.panBy([0, delta], { animate: false })
  }, [coveredHeight, map, duration])
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

// `bottomInset` is how much of the bottom of the map something else is
// covering — on Home, the drawer. It does two things: lifts every
// bottom-anchored control clear of the cover (via --map-bottom-inset, which
// the layers menu, the GPS bar and Leaflet's own control rail all read), and
// pans the view up by half of it so what you are looking at stays in the
// middle of the strip you can still see.
//
// `showHomeButton` is false when this map IS the home screen, where a button
// that navigates home is meaningless. It also drives --map-left-inset: the
// route bar leaves room on the left for that button, and with no button there
// the room is a hole that pushes the bar off centre.
//
// Every bottom-anchored control rides on --map-bottom-inset, so the whole
// stack stays pegged to the top of the drawer and moves with it. Nothing is
// mounted or unmounted as the drawer moves: a control that vanishes and
// reappears reads as a glitch, and its position is the thing that should
// change, not its existence.
//
// `insetDuration` is how long that movement takes. It is 0ms while a drag is
// in progress, so the controls track the finger exactly, and matches the
// drawer's own transition when it snaps, so the two ease together instead of
// the controls jumping to the destination the drawer is still travelling to.
//
// `focusInset` is the drawer's live covered height (capped at its open
// stop). The map's recentring follows it frame by frame during a drag and
// eases over `insetDuration` on the snap — see MapFocusOffset for the
// mechanics and LocateRecenter for how a recenter lands in the middle of
// the strip this leaves visible.
export default function MapView({ onViewChange, lastView, bottomInset = 0, focusInset = null, insetDuration = '0ms', topInset = '0px', showHomeButton = true } = {}) {
  // Shared with Home's own map preview via HomeLocationProvider (mounted
  // once around Home, which never unmounts while this screen — an overlay
  // on top of Home — is open) rather than starting a separate watch here.
  // A fresh watch per mount used to mean this screen always opened cold, no
  // matter how recently it had a real fix; now it usually already knows
  // the position by the time it opens.
  const { coords: liveCoords, derived: liveDerived, status: liveStatus, error: liveError, errorCode: liveErrorCode, lastKnown, retry: retryLocation } = useHomeLocation()
  const { layer, setLayer } = useMapLayer()
  const { overlays, toggleOverlay } = useMapOverlays()
  const { trail: breadcrumbTrail, reset: resetBreadcrumbs } = useBreadcrumbTrail({
    enabled: overlays.breadcrumbs, coords: liveCoords,
  })
  // Turning the trail on starts a new one. Doing this here, on the actual
  // toggle, is what makes it a deliberate reset rather than something the app
  // does to itself whenever overlay state finishes loading.
  const handleToggleOverlay = useCallback(key => {
    if (key === 'breadcrumbs' && !overlays.breadcrumbs) resetBreadcrumbs()
    toggleOverlay(key)
  }, [overlays.breadcrumbs, toggleOverlay, resetBreadcrumbs])
  const [route, setRoute] = useState(null)
  const [recenterRequest, setRecenterRequest] = useState(null)
  // The "you are here" dot: the live fix while there is one, else the last
  // fix this device ever had, drawn grey (see LiveMap's positionStale) so a
  // remembered position can orient the pilot without impersonating a real
  // one. Derived on every render rather than kept in state — an earlier
  // version stored it and only wrote it on the FIRST fix, which froze the
  // dot at wherever the session started for as long as the screen stayed
  // open.
  const dotPosition = liveCoords ? [liveCoords.lat, liveCoords.lon]
    : lastKnown ? [lastKnown.lat, lastKnown.lon]
    : null
  const dotStale = !liveCoords && !!lastKnown
  // Where the map opens when there is no remembered view: the last known
  // fix, a step wider than the live-fix zoom — the pilot is near there, not
  // provably at there. Read synchronously (localStorage-backed) so it's
  // ready for the map's one and only mount.
  const staleSeed = !lastView && lastKnown ? { center: [lastKnown.lat, lastKnown.lon], zoom: 11 } : null
  // Whether this screen even needs to auto-jump the viewport onto a GPS fix
  // at all: not if we're opening onto a remembered view (lastView), and not
  // if we already had a fix at mount (nothing to jump onto — already there).
  // Opening on a stale seed does NOT count: when the first real fix arrives
  // it should still pull the view onto the aircraft.
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
    if (!lastView) {
      setRecenterRequest({ lat: liveCoords.lat, lon: liveCoords.lon, zoom: LOCATION_ZOOM })
    }
  }, [liveCoords, lastView])

  // Last rung of the opening-view ladder: no remembered view, no fix ever
  // recorded on this device — open on the pilot's home airport rather than
  // a continent. Async (settings + airport lookup), so it arrives after
  // mount and recenters the already-visible map; if a real fix or the
  // pilot beats it there, it stands down. Deliberately does not mark
  // autoCenteredRef: the first live fix still wins over the home airport.
  useEffect(() => {
    if (lastView || lastKnown || liveCoords) return
    let cancelled = false
    get('settings', 'homeAirport')
      .then(row => row?.value ? findAirport(row.value) : null)
      .then(apt => {
        if (cancelled || !apt || autoCenteredRef.current) return
        setRecenterRequest({ lat: apt.lat, lon: apt.lon, zoom: 10 })
      })
      .catch(() => {})
    return () => { cancelled = true }
    // Mount-once by intent: this is only about where the map OPENS.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleLocate() {
    if (!liveCoords) return
    setRecenterRequest({ lat: liveCoords.lat, lon: liveCoords.lon })
  }

  // Foreground flight auto-detection — settings-gated, per Settings.jsx's
  // Flight Detection section. Reuses this screen's own liveCoords (never a
  // second geolocation watch — see useFlightDetector's own header comment
  // for why that matters).
  const [autoDetectEnabled, setAutoDetectEnabled] = useState(true)
  const [autoDetectConfig, setAutoDetectConfig] = useState(DEFAULT_AUTO_DETECT_CONFIG)
  useEffect(() => {
    get('settings', 'autoDetectEnabled').then(row => setAutoDetectEnabled(autoDetectEnabledFrom(row)))
    get('settings', 'autoDetectConfig').then(row => setAutoDetectConfig({ ...DEFAULT_AUTO_DETECT_CONFIG, ...(row?.value ?? {}) }))
  }, [])
  const { state: detectState, draft: detectedDraft, reset: resetDetector } = useFlightDetector({
    enabled: autoDetectEnabled, config: autoDetectConfig, coords: liveCoords,
  })
  const { addEntry } = useLogbook()
  const { aircraftId: activeAircraftId } = useActiveAircraft()
  const [flightSavedBanner, setFlightSavedBanner] = useState(false)

  // The pilot's own clock. Stopping it hands back a finished flight, which is
  // logged here rather than in the hook because this is the screen that knows
  // which aircraft is active. Tagged pendingReview like a detected flight, so
  // both land in the same place for the pilot to confirm rather than being
  // committed behind their back.
  const flightTimer = useFlightTimer({ coords: liveCoords })
  const [timedFlightBanner, setTimedFlightBanner] = useState(null)
  // The screen staying awake is the difference between recording a flight and
  // recording the first thirty seconds of one. Held whenever either recorder
  // is running — the pilot's timer, or auto-detect having caught a departure.
  const screenAwake = useWakeLock(flightTimer.running || detectState === 'recording')
  function toggleFlightTimer() {
    if (!flightTimer.running) { flightTimer.start(); return }
    const flight = flightTimer.stop()
    if (!flight) return
    addEntry({
      date: new Date(flight.startedAt).toISOString().slice(0, 10),
      totalTime: flight.hours.toFixed(1),
      startedAt: flight.startedAt,
      endedAt: flight.endedAt,
      durationMs: flight.elapsedMs,
      track: flight.track,
      distanceNm: flight.distanceNm,
      aircraftId: activeAircraftId ?? null,
      source: 'timer',
      pendingReview: true,
    }).then(() => {
      setTimedFlightBanner(flight)
      setTimeout(() => setTimedFlightBanner(null), 8000)
    }).catch(() => {})
  }
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
  // Permission denied is the one failure retrying cannot cure, so it gets
  // its own banner: what to change, where, in this exact browser — not a
  // numeric code and not a false "still trying". Retrying after the pilot
  // flips the setting works without a reload, so the tap stays useful.
  const locationDenied = locationUnavailable && liveErrorCode === 1
  // A cold GPS start can legitimately take a while, and tips that appear at
  // second three are noise. Past thirty seconds without any fix, the pilot
  // is owed the short list of things that actually speed one up. A banner,
  // never a pop-up: GPS blips happen in flight, and nothing is allowed to
  // jump in front of the moving map. (In flight a fix exists, so this whole
  // block is gone anyway.)
  const [slowFix, setSlowFix] = useState(false)
  useEffect(() => {
    if (liveCoords) { setSlowFix(false); return }
    const t = setTimeout(() => setSlowFix(true), 30000)
    return () => clearTimeout(t)
  }, [liveCoords])
  // iOS's Precise Location toggle is invisible to a web app EXCEPT through
  // the numbers: with it off, fixes arrive with ~kilometres of accuracy
  // instead of metres. That signature is detectable, so name the switch
  // instead of letting the pilot stare at a dot parked a town away.
  const coarseFix = liveCoords && liveCoords.accuracyM != null && liveCoords.accuracyM > 1000

  return (
    <div
      className="map-root"
      style={{ height: '100%', position: 'relative', isolation: 'isolate', '--map-bottom-inset': `${bottomInset}px`, '--map-top-inset': topInset, '--map-left-inset': showHomeButton ? '52px' : '0px', '--map-inset-duration': insetDuration }}>
      {/* Leaflet's own control rail is inside the map container, so it can't
          read a wrapper's padding — it gets the inset directly. */}
      <style>{`
        .map-root .leaflet-bottom { bottom: calc(var(--map-bottom-inset, 0px) + 74px); transition: bottom var(--map-inset-duration, 0ms) cubic-bezier(0.32, 0.72, 0, 1); }
        .map-root .leaflet-top { top: var(--map-top-inset, 0px); }
        .map-root .leaflet-control-zoom a { width: 24px; height: 24px; line-height: 24px; font-size: 16px; }
        .map-root .leaflet-control-zoom { border-radius: 8px; }
      `}</style>
      <LiveMap
        position={dotPosition} positionStale={dotStale} zoom={LOCATION_ZOOM}
        initialCenter={lastView?.center ?? staleSeed?.center}
        initialZoom={lastView ? lastView.zoom : staleSeed?.zoom}
        layer={layer} zoomControlPosition="bottomleft"
      >
        {overlays.breadcrumbs && <BreadcrumbLayer trail={breadcrumbTrail} />}
        {overlays.radar && <RadarLayer />}
        {overlays.flightCategory && <FlightCategoryLayer />}
        {overlays.tfr && <TfrLayer />}
        {overlays.airports && <AirportLayer />}
        {overlays.heliports && <HeliportLayer />}
        {overlays.seaplaneBases && <SeaplaneBaseLayer />}
        <LocateRecenter request={recenterRequest} coveredHeight={focusInset ?? bottomInset} />
        <RoutePreview route={route} />
        <MapFocusOffset coveredHeight={focusInset ?? bottomInset} duration={insetDuration} />
        {onViewChange && <ViewReporter onChange={onViewChange} />}
      </LiveMap>

      {showHomeButton && (
        <div style={{ position: 'absolute', top: 12, left: 12, zIndex: 600 }}>
          <HomeButton />
        </div>
      )}

      {/* The flight timer. Idle it is a button; running it is the clock,
          because a timer you cannot read is not doing its job. Sits opposite
          locate, on the same rail as everything else pegged to the drawer. */}
      <button
        onClick={toggleFlightTimer}
        aria-label={flightTimer.running ? 'Stop flight timer' : 'Start flight timer'}
        style={{
          position: 'absolute', left: 12, bottom: 'calc(150px + var(--map-bottom-inset, 0px))', zIndex: 500,
          transition: 'bottom var(--map-inset-duration, 0ms) cubic-bezier(0.32, 0.72, 0, 1)',
          height: 32, minWidth: 32, padding: flightTimer.running ? '0 10px' : 0,
          borderRadius: 16, border: 'none',
          background: flightTimer.running ? 'var(--danger)' : 'var(--bg-card)',
          boxShadow: 'var(--shadow-sm)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
          cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
        }}>
        {flightTimer.running ? (
          <>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: '#fff', flexShrink: 0 }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>
              {formatClock(flightTimer.elapsedMs)}
            </span>
          </>
        ) : (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--text)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="13" r="8" />
            <path d="M12 9v4l2.5 2M9 2h6" />
          </svg>
        )}
      </button>

      <button
        onClick={handleLocate}
        disabled={noFixYet}
        aria-label="Locate me"
        style={{
          position: 'absolute', right: 12, bottom: 'calc(122px + var(--map-bottom-inset, 0px))', zIndex: 500,
          transition: 'bottom var(--map-inset-duration, 0ms) cubic-bezier(0.32, 0.72, 0, 1)',
          width: 32, height: 32, borderRadius: '50%', border: 'none',
          background: 'var(--bg-card)', boxShadow: 'var(--shadow-sm)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: noFixYet ? 'default' : 'pointer', WebkitTapHighlightColor: 'transparent',
          opacity: noFixYet ? 0.55 : 1,
        }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--text)" strokeWidth="2.2" strokeLinecap="round">
          <circle cx="12" cy="12" r="3.5" />
          <line x1="12" y1="1" x2="12" y2="4.5" />
          <line x1="12" y1="19.5" x2="12" y2="23" />
          <line x1="1" y1="12" x2="4.5" y2="12" />
          <line x1="19.5" y1="12" x2="23" y2="12" />
        </svg>
      </button>

      {/* Tappable. The watch retries on its own every ten seconds now, but a
          pilot standing on the ramp watching it fail should not have to guess
          whether anything is still happening, or relaunch the app to force it.
          The banner says what went wrong, that it is still trying, and gives
          them a way to ask for it now. */}
      {noFixYet && (locationUnavailable || slowFix) && (
        <button
          onClick={retryLocation}
          aria-label="Retry locating"
          style={{
            position: 'absolute', top: 'calc(68px + var(--map-top-inset, 0px))', left: 12, right: 12, zIndex: 500,
            background: 'var(--bg-card)', borderRadius: 14, padding: '10px 14px',
            border: 'none', textAlign: 'left', width: 'auto',
            boxShadow: 'var(--shadow-sm)', cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
          }}>
          {locationDenied ? (
            <>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                Location is blocked for AVIARA
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 3 }}>
                {locationPermissionHelp()}
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)', marginTop: 3 }}>
                Fixed it? Tap here to try again
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                {locationUnavailable ? liveError : 'Still looking for GPS…'}
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)', marginTop: 3 }}>
                Still trying · tap to retry now
              </div>
              {slowFix && (
                <div style={{ marginTop: 8, borderTop: '0.5px solid var(--border)', paddingTop: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>
                    Taking a while — what helps
                  </div>
                  {GPS_TIPS.map((tip, i) => (
                    <div key={i} style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4, display: 'flex', gap: 6 }}>
                      <span style={{ flexShrink: 0 }}>·</span>
                      <span>{tip}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </button>
      )}

      {/* A fix that exists but is kilometres wide is worse than none if the
          app stays quiet about it — the dot looks authoritative parked a
          town away. Named cause + named switch, and it disappears on its
          own the moment real accuracy arrives. Suppressed while recording
          so it never stacks over the recording banner. */}
      {coarseFix && detectState !== 'recording' && (
        <div style={{
          position: 'absolute', top: 'calc(68px + var(--map-top-inset, 0px))', left: 12, right: 12, zIndex: 500,
          background: 'var(--bg-card)', borderRadius: 14, padding: '10px 14px',
          fontSize: 12, color: 'var(--text-secondary)', boxShadow: 'var(--shadow-sm)',
        }}>
          Position is coarse (±{Math.round(liveCoords.accuracyM / 1000)} km) — if this persists,
          Precise Location may be off for AVIARA: Settings → Privacy &amp; Security → Location Services.
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

      {/* Only shown when the lock could NOT be taken. Confirming that the
          screen will stay on is noise; warning that it will not is the thing a
          pilot can act on — set Auto-Lock to Never before pushing the throttle
          up, rather than discovering a five-minute track afterwards. */}
      {(flightTimer.running || detectState === 'recording') && !screenAwake && (
        <div style={{
          position: 'absolute', top: 'calc(68px + var(--map-top-inset, 0px))', left: 12, right: 12, zIndex: 500,
          background: 'var(--bg-card)', borderRadius: 14, padding: '10px 14px',
          fontSize: 13, color: 'var(--text)', boxShadow: 'var(--shadow-sm)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--warn)', flexShrink: 0 }} />
          Recording — set Auto-Lock to Never, or the screen will stop it.
        </div>
      )}

      {timedFlightBanner && (
        <div style={{
          position: 'absolute', top: 'calc(68px + var(--map-top-inset, 0px))', left: 12, right: 12, zIndex: 500,
          background: 'var(--bg-card)', borderRadius: 14, padding: '10px 14px',
          fontSize: 13, color: 'var(--text)', boxShadow: 'var(--shadow-sm)',
        }}>
          Flight timed — {timedFlightBanner.clock} ({timedFlightBanner.hours.toFixed(1)} h). Review it in the logbook.
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
      <MapLayersMenu layer={layer} setLayer={setLayer} layerOptions={LAYER_OPTIONS} overlays={overlays} toggleOverlay={handleToggleOverlay} />
      <GpsInfoBar route={route} coords={liveCoords} derived={liveDerived} status={liveStatus} lastKnown={lastKnown} />
    </div>
  )
}
