import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MapContainer, TileLayer, CircleMarker, Marker, Polyline, Polygon, Popup, Tooltip, ZoomControl, useMap } from 'react-leaflet'
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
import { get, put } from '../lib/db'
import { submitPirep, listRecentPireps, PIREP_SKY, PIREP_WX, PIREP_WX_LABELS, PIREP_TURB, PIREP_ICING } from '../lib/pireps'
import { FLTCAT } from '../lib/weather'
import { getAirports, getAirportDetails, getAuxAerodromes, findAirport } from '../lib/aerodromes'
import { getUserWaypoints, saveUserWaypoint, removeUserWaypoint, nextAutoName } from '../lib/waypoints'
import { fmtAvCoord } from '../lib/geo'
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
  'Give the phone sky — glareshield or window; the airframe blocks GPS.',
  'Wi-Fi or mobile data speeds the first fix.',
  'Turn off Low Power Mode.',
  'Precise Location on: Settings → Privacy & Security → Location Services.',
  'Still stuck? Reopen the app, or restart the phone.',
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
// Simple top-view aircraft, drawn point-up; rotated per render to the
// screen-relative track. One shape for everyone — the pilot asked for "a
// random simple aircraft design", not a fleet picker.
function ownshipIcon(screenDeg) {
  return L.divIcon({
    className: '',
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    html: `<svg width="34" height="34" viewBox="0 0 24 24" style="transform:rotate(${Math.round(screenDeg)}deg);filter:drop-shadow(0 1px 2px rgba(0,0,0,0.5))">
      <path d="M12 2 L13.4 9 L21 12 L13.4 13.6 L13.1 18.6 L15.4 20.6 L15.4 21.8 L12 20.8 L8.6 21.8 L8.6 20.6 L10.9 18.6 L10.6 13.6 L3 12 L10.6 9 Z"
        fill="#0a84ff" stroke="#fff" stroke-width="1.3" stroke-linejoin="round"/>
    </svg>`,
  })
}

export function LiveMap({ position, positionStale = false, heading = null, mapBearing = 0, zoom, initialCenter, initialZoom, layer, markerRadius = 8, interactive = true, showZoomControl = true, zoomControlPosition, children }) {
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
      // Leaflet only turns its hold-for-contextmenu synthesis on when it
      // detects Safari; Chrome on iOS is WebKit in a trenchcoat and misses
      // that check, so force it — press-and-hold must mean the same thing
      // in every browser the app runs in. Desktop right-click fires
      // contextmenu natively either way.
      tapHold={true}
      {...interactionProps}
    >
      {interactive && showZoomControl && <ZoomControl position={zoomControlPosition || 'topleft'} />}
      <MapLayers layer={layer} />
      {/* Ownship when the GPS reports a ground track (moving); the plain dot
          when stationary (a parked aircraft has no meaningful nose-direction
          from GPS alone) or stale (grey — orientation, not truth). The icon's
          rotation is screen-relative: ground track minus however far the map
          itself is rotated, so in Track Up it points straight up. */}
      {position && !positionStale && heading != null ? (
        <Marker position={position} icon={ownshipIcon(heading - mapBearing)} interactive={false} />
      ) : position && (
        <CircleMarker
          center={position}
          radius={markerRadius}
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
export function MapFocusOffset({ coveredHeight, duration = '0ms', suspended = false }) {
  const map = useMap()
  const applied = useRef(0)
  useEffect(() => {
    const want = coveredHeight / 2
    // While follow mode owns the view (suspended), it applies the covered
    // offset itself on every fix — panning here too would double it. Keep
    // the bookkeeping in sync so follow ending doesn't cause a jump.
    if (suspended) { applied.current = want; return }
    const delta = want - applied.current
    if (Math.abs(delta) < 0.5) return
    applied.current = want
    const ms = parseFloat(duration) || 0
    if (ms > 0) map.panBy([0, delta], { animate: true, duration: ms / 1000 })
    else map.panBy([0, delta], { animate: false })
  }, [coveredHeight, map, duration, suspended])
  return null
}

// Fired whenever the user-waypoint list changes, so every open view of it
// (the map layer here, and any future list UI) reloads without prop
// plumbing — same pattern as useMapLayer's 'aviara-map-layer' event.
const USER_WAYPOINTS_EVENT = 'aviara-user-waypoints'

// The pilot's own named points, always visible — a waypoint you can only
// see while an overlay toggle is on is a waypoint you'll forget you have.
// Amber, to sit apart from the purple route line and the blue position dot.
function UserWaypointLayer() {
  const [list, setList] = useState([])
  useEffect(() => {
    const load = () => getUserWaypoints().then(setList).catch(() => {})
    load()
    window.addEventListener(USER_WAYPOINTS_EVENT, load)
    return () => window.removeEventListener(USER_WAYPOINTS_EVENT, load)
  }, [])
  return (
    <>
      {list.map(w => (
        <CircleMarker key={w.name} center={[w.lat, w.lon]} radius={6}
          pathOptions={{ color: '#fff', weight: 2, fillColor: '#f59e0b', fillOpacity: 1 }}>
          <Tooltip permanent direction="top" offset={[0, -6]}>
            <span style={{ fontSize: 10, fontWeight: 700, fontFamily: 'monospace' }}>{w.name}</span>
          </Tooltip>
          <Popup>
            <div style={{ fontSize: 12, fontWeight: 700 }}>{w.name}</div>
            <div style={{ fontSize: 11, fontFamily: 'monospace' }}>{fmtAvCoord(w.lat, w.lon)}</div>
            <button
              onClick={() => removeUserWaypoint(w.name).then(() => window.dispatchEvent(new Event(USER_WAYPOINTS_EVENT)))}
              style={{
                marginTop: 6, padding: '4px 10px', borderRadius: 8, border: 'none',
                background: 'var(--danger)', color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer',
              }}>
              Delete waypoint
            </button>
          </Popup>
        </CircleMarker>
      ))}
    </>
  )
}

// AVIARA-to-AVIARA PIREPs, refreshed when the layer mounts (toggled on)
// and every five minutes while it stays on. Urgent reports draw red,
// routine ones blue; both age out of the query at 12 hours (lib/pireps).
function PirepLayer() {
  const [reports, setReports] = useState([])
  useEffect(() => {
    let alive = true
    const load = () => listRecentPireps().then(({ data }) => { if (alive) setReports(data) })
    load()
    window.addEventListener('aviara-pireps', load)
    const t = setInterval(load, 5 * 60 * 1000)
    return () => { alive = false; clearInterval(t); window.removeEventListener('aviara-pireps', load) }
  }, [])
  const age = iso => {
    const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
    return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`
  }
  return (
    <>
      {reports.map(p => (
        <CircleMarker key={p.id} center={[p.lat, p.lon]} radius={7}
          pathOptions={{ color: '#fff', weight: 2, fillColor: p.urgent ? '#dc2626' : '#2563eb', fillOpacity: 0.95 }}>
          <Popup>
            <div style={{ fontSize: 12, fontWeight: 700 }}>
              {p.urgent ? 'URGENT PIREP (UUA)' : 'PIREP (UA)'} · {age(p.created_at)}
            </div>
            <div style={{ fontSize: 11, marginTop: 3, lineHeight: 1.5 }}>
              {p.altitude_ft != null && <div>Altitude: {p.altitude_ft.toLocaleString()} ft</div>}
              {p.aircraft_type && <div>Aircraft: {p.aircraft_type}</div>}
              {p.sky && <div>Sky: {p.sky}</div>}
              {p.wx?.length > 0 && <div>Weather: {p.wx.map(w => PIREP_WX_LABELS[w] || w).join(', ')}</div>}
              {p.turbulence && <div>Turbulence: {p.turbulence}</div>}
              {p.icing && <div>Icing: {p.icing}</div>}
              {p.remarks && <div>Remarks: {p.remarks}</div>}
            </div>
            <div style={{ fontSize: 10, color: '#888', marginTop: 4 }}>Shared by an AVIARA pilot — not an FAA PIREP</div>
          </Popup>
        </CircleMarker>
      ))}
    </>
  )
}

// Hands the Leaflet map instance up to MapView, which needs it for the
// custom zoom buttons that live OUTSIDE the rotating canvas (Leaflet's own
// control would rotate with the map in Track Up).
function MapRef({ onMap }) {
  const map = useMap()
  useEffect(() => { onMap(map) }, [map, onMap])
  return null
}

// Follow mode: while on, every GPS fix recenters the map on the aircraft —
// Google-Maps-style — until the pilot drags, which hands the map back to
// them (reported via onUserDrag; Locate re-engages). setView never fires
// dragstart, so following can't cancel itself.
//
// The screen offset (drawer covering the bottom, plus the Track-Up-Ahead
// placement in the lower region of the visible strip) is applied in SCREEN
// space and converted to map-frame pixels through the current rotation:
// with the canvas CSS-rotated by -bearing, screen-down (0, dy) is the map
// vector (-dy·sinθ, dy·cosθ).
function FollowController({ follow, orientation, fix, bearing, coveredHeight, onUserDrag }) {
  const map = useMap()
  useEffect(() => {
    const h = () => onUserDrag()
    map.on('dragstart', h)
    return () => map.off('dragstart', h)
  }, [map, onUserDrag])
  useEffect(() => {
    if (!follow || !fix) return
    map.setView([fix.lat, fix.lon], map.getZoom(), { animate: false })
    const visibleH = Math.max(0, window.innerHeight - coveredHeight)
    // Positive dy lifts the ownship UP the screen (drawer compensation);
    // Track-Up-Ahead SUBTRACTS, pushing the ownship down into the lower
    // region of the visible strip so the map ahead gets the space. dy can
    // legitimately go negative — don't gate on sign.
    const dy = coveredHeight / 2 - (orientation === 'trackAhead' ? 0.22 * visibleH : 0)
    if (Math.abs(dy) > 0.5) {
      const th = bearing * Math.PI / 180
      map.panBy([-dy * Math.sin(th), dy * Math.cos(th)], { animate: false })
    }
  }, [follow, fix, orientation, bearing, coveredHeight, map])
  return null
}

// Surfaces Leaflet's contextmenu as "the pilot pressed and held here" (or
// right-clicked, on desktop — same event). The menu itself is MapView's;
// this only reports the geographic point.
function MapPressCapture({ onPress }) {
  const map = useMap()
  useEffect(() => {
    const h = e => onPress({ lat: e.latlng.lat, lon: e.latlng.lng })
    map.on('contextmenu', h)
    return () => map.off('contextmenu', h)
  }, [map, onPress])
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
  const { coords: rawCoords, derived: liveDerived, status: liveStatus, error: liveError, errorCode: liveErrorCode, lastKnown, stale: fixStale, retry: retryLocation } = useHomeLocation()
  // A stale fix is not a fix. Everything downstream — the ownship, the
  // readouts, follow mode, the recorders — reads liveCoords, so gating it
  // here once means none of them can accidentally treat a position the
  // aircraft left minutes ago as current. `lastKnown` still carries the
  // old point for orientation, drawn grey and labelled with its age.
  const liveCoords = fixStale ? null : rawCoords
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
  // Follow mode: Locate engages it, a manual drag breaks it. While on,
  // FollowController recenters on every fix.
  const [follow, setFollow] = useState(false)
  const handleUserDrag = useCallback(() => setFollow(false), [])
  // 'north' | 'track' | 'trackAhead' — persisted, cycled by the map button.
  const [orientation, setOrientationState] = useState('north')
  useEffect(() => {
    get('settings', 'mapOrientation').then(row => { if (row?.value) setOrientationState(row.value) }).catch(() => {})
  }, [])
  function cycleOrientation() {
    const order = ['north', 'track', 'trackAhead']
    const next = order[(order.indexOf(orientation) + 1) % order.length]
    setOrientationState(next)
    put('settings', { key: 'mapOrientation', value: next }).catch(() => {})
  }
  // The map canvas's rotation. Continuous (unwrapped) so 359°→1° turns 2°
  // through north instead of spinning 358° the long way under the CSS
  // transition. Returns to 0 whenever follow is off or the mode is North Up
  // — after a manual pan the map reads like a chart again until Locate
  // re-engages the track.
  const [bearing, setBearing] = useState(0)
  useEffect(() => {
    const target = (follow && orientation !== 'north' && liveCoords?.headingDeg != null)
      ? liveCoords.headingDeg
      : (!follow || orientation === 'north') ? 0 : null
    if (target == null) return   // tracking mode, no ground track yet: hold current rotation
    setBearing(prev => {
      const d = ((target - prev) % 360 + 540) % 360 - 180
      return Math.abs(d) < 0.5 ? prev : prev + d
    })
  }, [liveCoords, follow, orientation])
  // The rotating canvas is a square with the viewport's diagonal as its
  // side, centered — however the map turns, no corner of the screen ever
  // shows past its edge. Measured from the actual container, re-measured
  // on resize: measuring window dimensions once at mount produced a 0×0
  // canvas (and an invisible map) when the hosting view initialized before
  // layout settled. The || fallback guards the same zero on first render.
  const rootRef = useRef(null)
  const [canvasSize, setCanvasSize] = useState(() => Math.ceil(Math.hypot(window.innerWidth, window.innerHeight)) || 1200)
  useEffect(() => {
    const measure = () => {
      const w = rootRef.current?.clientWidth || window.innerWidth
      const h = rootRef.current?.clientHeight || window.innerHeight
      const d = Math.ceil(Math.hypot(w, h))
      if (d > 0) setCanvasSize(prev => (Math.abs(prev - d) > 2 ? d : prev))
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])
  // Leaflet map instance, for the custom zoom buttons that must sit outside
  // the rotating canvas.
  const mapApiRef = useRef(null)
  const handleMapInstance = useCallback(m => { mapApiRef.current = m }, [])
  // Leaflet sized itself against whatever the canvas measured at creation;
  // a later canvas correction is invisible to it without this.
  useEffect(() => { mapApiRef.current?.invalidateSize() }, [canvasSize])
  // Press-and-hold flow: pressMenu holds the {lat,lon} the pilot pressed
  // (menu open), wptDraft holds the point a waypoint is being named for
  // (dialog open). Only one is ever non-null at a time.
  const [pressMenu, setPressMenu] = useState(null)
  const [wptDraft, setWptDraft] = useState(null)
  const [wptName, setWptName] = useState('')
  const [wptError, setWptError] = useState(null)
  const [wptSaving, setWptSaving] = useState(false)
  const handleMapPress = useCallback(p => setPressMenu(p), [])

  // A raw coordinate appended to whatever route exists — the "I just want
  // this lat/long in the route" half of press-and-hold. The route bar's
  // TEXT is not rewritten (it can't spell a coordinate the resolver could
  // re-parse); the drawn line and the GPS bar's next/dest fields are the
  // source of truth the moment this is used.
  function appendPointToRoute(p) {
    const pt = { kind: 'LL', name: fmtAvCoord(p.lat, p.lon), label: null, lat: p.lat, lon: p.lon }
    setRoute(r => (r && r.length ? [...r, pt] : [pt]))
    setPressMenu(null)
  }

  // UAP: the full report form already exists as its own tool with its own
  // draft store — the map's job is only to seed a draft with the pressed
  // location so the pilot finishes it there ("the UAP folder"), not to
  // clone a 15-field form into a map sheet.
  const [uapBanner, setUapBanner] = useState(false)
  async function startUapDraftAt(p) {
    const now = new Date()
    await put('uapReports', {
      id: `uap-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      createdAt: now.toISOString(),
      date: now.toISOString().slice(0, 10),
      time: now.toTimeString().slice(0, 5),
      durationBucket: '', locationText: fmtAvCoord(p.lat, p.lon), lat: p.lat, lon: p.lon, altitudeFt: '',
      shape: '', motion: '', angularSize: '', color: '', sound: '',
      witnesses: '', nearbyObjects: '', weatherVisibility: '', description: '',
      ageRange: '', gender: '', genderOther: '',
      consent: false,
    }).catch(() => {})
    setPressMenu(null)
    setUapBanner(true)
    setTimeout(() => setUapBanner(false), 8000)
  }

  // PIREP: filed from the map, shared with every AVIARA pilot who has the
  // layer on. Checkbox/radio groups mirror the standard report's element
  // groups (/SK /WX /TB /IC), constrained to the same vocabulary the DB
  // enforces.
  const [pirepDraft, setPirepDraft] = useState(null)   // {lat, lon} → sheet open
  const [pirep, setPirep] = useState({ urgent: false, altitudeFt: '', aircraftType: '', sky: null, wx: [], turbulence: null, icing: null, remarks: '' })
  const [pirepError, setPirepError] = useState(null)
  const [pirepSending, setPirepSending] = useState(false)
  const [pirepBanner, setPirepBanner] = useState(false)
  function openPirepAt(p) {
    setPirep({
      urgent: false,
      altitudeFt: liveCoords?.altFt != null ? String(Math.round(liveCoords.altFt)) : '',
      aircraftType: '', sky: null, wx: [], turbulence: null, icing: null, remarks: '',
    })
    setPirepError(null)
    setPirepDraft(p)
    setPressMenu(null)
  }
  async function sendPirep() {
    if (!pirepDraft) return
    setPirepSending(true)
    setPirepError(null)
    const { error } = await submitPirep({
      lat: pirepDraft.lat, lon: pirepDraft.lon,
      altitude_ft: pirep.altitudeFt ? parseInt(pirep.altitudeFt, 10) : null,
      aircraft_type: pirep.aircraftType.trim() || null,
      urgent: pirep.urgent,
      sky: pirep.sky, wx: pirep.wx, turbulence: pirep.turbulence, icing: pirep.icing,
      remarks: pirep.remarks.trim() || null,
    })
    setPirepSending(false)
    if (error) { setPirepError(error.message); return }
    setPirepDraft(null)
    window.dispatchEvent(new Event('aviara-pireps'))
    setPirepBanner(true)
    setTimeout(() => setPirepBanner(false), 6000)
  }

  async function saveWaypointDraft() {
    if (!wptDraft) return
    setWptSaving(true)
    setWptError(null)
    try {
      const name = wptName.trim() || await nextAutoName()
      await saveUserWaypoint(name, wptDraft.lat, wptDraft.lon)
      window.dispatchEvent(new Event(USER_WAYPOINTS_EVENT))
      setWptDraft(null)
      setWptName('')
    } catch (e) {
      setWptError(e.message)
    } finally {
      setWptSaving(false)
    }
  }
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
      // Opening onto your own position IS following it — same as every
      // consumer mapping app. The first drag hands the map back.
      setFollow(true)
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

  // One button, staged (James's design, after the standalone orientation
  // button ended up buried under Layers): not following → tap centres you
  // and follows in the current orientation; already following → each tap
  // advances North Up → Track Up → Track Up Ahead → back to North Up.
  // A drag only breaks following, never the cycle position.
  function handleLocate() {
    if (!liveCoords) return
    if (!follow) {
      setRecenterRequest({ lat: liveCoords.lat, lon: liveCoords.lon })
      setFollow(true)
      return
    }
    cycleOrientation()
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
  // Whether the pilot has folded the GPS card down to a chip. Losing GPS
  // does not mean losing the map — dead reckoning off the chart is exactly
  // what a pilot does next, and that needs the screen. So the card is
  // hideable, and the choice sticks for as long as this outage lasts.
  // Regaining a fix rearms it, so the NEXT outage introduces itself again
  // instead of staying silently folded from a decision made an hour ago.
  const [gpsHelpCollapsed, setGpsHelpCollapsed] = useState(false)
  const hasFix = !!liveCoords
  useEffect(() => { if (hasFix) setGpsHelpCollapsed(false) }, [hasFix])
  // Losing a fix you HAD is worth saying immediately — it means the pilot
  // just moved to dead reckoning, and making them wait out the slow-fix
  // timer would be 60 seconds of the app knowing something it hasn't said.
  // A cold start still waits, because a cold start taking a few seconds is
  // normal and not news. (Declared here, below slowFix — an earlier
  // placement above it read the binding in its temporal dead zone and blew
  // up the whole map at mount.)
  const gpsBannerVisible = noFixYet && (locationUnavailable || slowFix || fixStale)
  // iOS's Precise Location toggle is invisible to a web app EXCEPT through
  // the numbers: with it off, fixes arrive with ~kilometres of accuracy
  // instead of metres. That signature is detectable, so name the switch
  // instead of letting the pilot stare at a dot parked a town away.
  const coarseFix = liveCoords && liveCoords.accuracyM != null && liveCoords.accuracyM > 1000

  return (
    <div
      className="map-root"
      ref={rootRef}
      style={{ height: '100%', position: 'relative', isolation: 'isolate', overflow: 'hidden', '--map-bottom-inset': `${bottomInset}px`, '--map-top-inset': topInset, '--map-left-inset': showHomeButton ? '52px' : '0px', '--map-inset-duration': insetDuration }}>
      {/* Leaflet's own control rail is inside the map container, so it can't
          read a wrapper's padding — it gets the inset directly. */}
      {/* Leaflet's own zoom control is gone from this screen (it lived
          inside the canvas and would rotate in Track Up) — the custom
          buttons below replace it. The rail rules stay for any control
          Leaflet still owns. */}
      <style>{`
        .map-root .leaflet-bottom { bottom: calc(var(--map-bottom-inset, 0px) + 74px); transition: bottom var(--map-inset-duration, 0ms) cubic-bezier(0.32, 0.72, 0, 1); }
        .map-root .leaflet-top { top: var(--map-top-inset, 0px); }
      `}</style>
      {/* The rotating canvas. A diagonal-sized square centered on the
          viewport, CSS-rotated by -bearing so the ground track points
          screen-up in the Track Up modes; the transition keeps GPS heading
          jitter from twitching the whole world. Everything that must NOT
          rotate (buttons, bars, banners) lives outside this div. */}
      <div style={{
        position: 'absolute', left: '50%', top: '50%',
        width: canvasSize, height: canvasSize,
        marginLeft: -canvasSize / 2, marginTop: -canvasSize / 2,
        transform: `rotate(${-bearing}deg)`, transformOrigin: '50% 50%',
        transition: 'transform 0.8s linear',
      }}>
      <LiveMap
        position={dotPosition} positionStale={dotStale} zoom={LOCATION_ZOOM}
        heading={liveCoords?.headingDeg ?? null} mapBearing={bearing}
        initialCenter={lastView?.center ?? staleSeed?.center}
        initialZoom={lastView ? lastView.zoom : staleSeed?.zoom}
        layer={layer} showZoomControl={false}
      >
        {overlays.breadcrumbs && <BreadcrumbLayer trail={breadcrumbTrail} />}
        {overlays.radar && <RadarLayer />}
        {overlays.flightCategory && <FlightCategoryLayer />}
        {overlays.tfr && <TfrLayer />}
        {overlays.airports && <AirportLayer />}
        {overlays.heliports && <HeliportLayer />}
        {overlays.seaplaneBases && <SeaplaneBaseLayer />}
        {overlays.pireps && <PirepLayer />}
        <UserWaypointLayer />
        <MapRef onMap={handleMapInstance} />
        <MapPressCapture onPress={handleMapPress} />
        <FollowController
          follow={follow} orientation={orientation} fix={liveCoords} bearing={bearing}
          coveredHeight={focusInset ?? bottomInset} onUserDrag={handleUserDrag}
        />
        <LocateRecenter request={recenterRequest} coveredHeight={focusInset ?? bottomInset} />
        <RoutePreview route={route} />
        <MapFocusOffset coveredHeight={focusInset ?? bottomInset} duration={insetDuration} suspended={follow} />
        {onViewChange && <ViewReporter onChange={onViewChange} />}
      </LiveMap>
      </div>

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

      {/* Zoom, outside the rotating canvas so + stays + at any bearing. */}
      <div style={{
        position: 'absolute', left: 12, bottom: 'calc(74px + var(--map-bottom-inset, 0px))', zIndex: 500,
        transition: 'bottom var(--map-inset-duration, 0ms) cubic-bezier(0.32, 0.72, 0, 1)',
        display: 'flex', flexDirection: 'column', borderRadius: 10, overflow: 'hidden', boxShadow: 'var(--shadow-sm)',
      }}>
        <button onClick={() => mapApiRef.current?.zoomIn()} aria-label="Zoom in"
          style={{ width: 32, height: 30, border: 'none', background: 'var(--bg-card)', color: 'var(--text)', fontSize: 17, fontWeight: 700, cursor: 'pointer', WebkitTapHighlightColor: 'transparent', borderBottom: '0.5px solid var(--border)' }}>+</button>
        <button onClick={() => mapApiRef.current?.zoomOut()} aria-label="Zoom out"
          style={{ width: 32, height: 30, border: 'none', background: 'var(--bg-card)', color: 'var(--text)', fontSize: 17, fontWeight: 700, cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}>−</button>
      </div>

      {/* Drop a pin on the aircraft's own position — one tap on the ramp
          marks the tie-down, the fuel pump, the hole in the fence. Sits
          directly above Locate: both buttons are "do something with where
          I am", and both are honest enough to disable without a fix. */}
      <button
        onClick={() => liveCoords && setWptDraft({ lat: liveCoords.lat, lon: liveCoords.lon })}
        disabled={noFixYet}
        aria-label="Save my position as a waypoint"
        style={{
          position: 'absolute', right: 12, bottom: 'calc(162px + var(--map-bottom-inset, 0px))', zIndex: 500,
          transition: 'bottom var(--map-inset-duration, 0ms) cubic-bezier(0.32, 0.72, 0, 1)',
          width: 32, height: 32, borderRadius: '50%', border: 'none',
          background: 'var(--bg-card)', boxShadow: 'var(--shadow-sm)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: noFixYet ? 'default' : 'pointer', WebkitTapHighlightColor: 'transparent',
          opacity: noFixYet ? 0.55 : 1,
        }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--text)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 21s-6-5.6-6-10a6 6 0 1 1 12 0c0 4.4-6 10-6 10z" />
          <circle cx="12" cy="11" r="2.2" />
        </svg>
      </button>

      <button
        onClick={handleLocate}
        disabled={noFixYet}
        aria-label="Locate me / cycle orientation"
        style={{
          position: 'absolute', right: 12, bottom: 'calc(122px + var(--map-bottom-inset, 0px))', zIndex: 500,
          transition: 'bottom var(--map-inset-duration, 0ms) cubic-bezier(0.32, 0.72, 0, 1)',
          height: 32, minWidth: 32, padding: follow && orientation !== 'north' ? '0 9px' : 0,
          borderRadius: 16, border: 'none',
          // Accent while following — the button is a mode, not a one-shot —
          // and it wears the stage's name in the track modes so the pilot
          // never has to guess where in the cycle they are.
          background: follow ? 'var(--accent)' : 'var(--bg-card)', boxShadow: 'var(--shadow-sm)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: noFixYet ? 'default' : 'pointer', WebkitTapHighlightColor: 'transparent',
          opacity: noFixYet ? 0.55 : 1,
          fontSize: 11, fontWeight: 800, letterSpacing: '0.03em', color: 'var(--accent-fg)',
        }}>
        {follow && orientation === 'track' ? 'TRK↑'
          : follow && orientation === 'trackAhead' ? 'TRK↑▲'
          : (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={follow ? 'var(--accent-fg)' : 'var(--text)'} strokeWidth="2.2" strokeLinecap="round">
              <circle cx="12" cy="12" r="3.5" />
              <line x1="12" y1="1" x2="12" y2="4.5" />
              <line x1="12" y1="19.5" x2="12" y2="23" />
              <line x1="1" y1="12" x2="4.5" y2="12" />
              <line x1="19.5" y1="12" x2="23" y2="12" />
            </svg>
          )}
      </button>

      {/* Tappable. The watch retries on its own every ten seconds now, but a
          pilot standing on the ramp watching it fail should not have to guess
          whether anything is still happening, or relaunch the app to force it.
          The banner says what went wrong, that it is still trying, and gives
          them a way to ask for it now. */}
      {/* Collapsed: a chip that says the state and nothing more. A pilot
          without GPS needs the CHART more than the advice — they're on dead
          reckoning, and a card covering half the map is the wrong tradeoff.
          The chip never disappears entirely though: silently hiding a
          degraded-navigation state is how a pilot forgets they're in one. */}
      {gpsBannerVisible && gpsHelpCollapsed && (
        <button
          onClick={() => setGpsHelpCollapsed(false)}
          aria-label="Show GPS status"
          style={{
            position: 'absolute', top: 'calc(68px + var(--map-top-inset, 0px))', left: 12, zIndex: 500,
            background: 'var(--bg-card)', borderRadius: 14, padding: '6px 10px',
            border: 'none', boxShadow: 'var(--shadow-sm)', cursor: 'pointer',
            WebkitTapHighlightColor: 'transparent',
            display: 'flex', alignItems: 'center', gap: 6,
            fontSize: 12, fontWeight: 700, color: 'var(--text)',
          }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--warn)', flexShrink: 0 }} />
          {locationDenied ? 'Location blocked' : fixStale ? 'GPS lost' : 'No GPS'}
          <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>▾</span>
        </button>
      )}

      {gpsBannerVisible && !gpsHelpCollapsed && (
        <div
          style={{
            position: 'absolute', top: 'calc(68px + var(--map-top-inset, 0px))', left: 12, right: 12, zIndex: 500,
            background: 'var(--bg-card)', borderRadius: 14, padding: '10px 14px',
            // With the drawer up, the visible strip can be shorter than the
            // tip list — cap the card at the space that's actually free
            // (above the GPS bar) and scroll inside it, rather than running
            // underneath the bar and the zoom rail.
            maxHeight: 'calc(100% - var(--map-bottom-inset, 0px) - 150px)', overflowY: 'auto',
            boxShadow: 'var(--shadow-sm)',
          }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              {locationDenied ? (
                <>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                    Location is blocked for AVIARA
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 3 }}>
                    {locationPermissionHelp()}
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                  {locationUnavailable ? liveError
                    : fixStale ? 'GPS signal lost — position below is your last fix'
                    : 'Still looking for GPS…'}
                </div>
              )}
            </div>
            <button
              onClick={() => setGpsHelpCollapsed(true)}
              aria-label="Hide GPS help"
              style={{
                flexShrink: 0, width: 24, height: 24, borderRadius: 12, border: 'none',
                background: 'var(--bg-card-2)', color: 'var(--text-secondary)',
                fontSize: 12, lineHeight: 1, cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
              }}>
              ▴
            </button>
          </div>
          <button
            onClick={retryLocation}
            style={{
              marginTop: 3, padding: 0, border: 'none', background: 'none', textAlign: 'left',
              fontSize: 12, fontWeight: 700, color: 'var(--accent)',
              cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
            }}>
            {locationDenied ? 'Fixed it? Tap here to try again' : 'Still trying · tap to retry now'}
          </button>
          {slowFix && !locationDenied && (
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
        </div>
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

      {/* Press-and-hold menu: what can be done with a point on the map.
          Portaled to <body>: on Home this map lives in a zIndex:0 layer
          UNDER the drawer, and position:fixed cannot out-z-index its own
          stacking context — an overlay rendered in place sits behind the
          drawer no matter what number it wears. */}
      {pressMenu && createPortal(
        <div
          onClick={() => setPressMenu(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'flex-end' }}>
          <div
            onClick={e => e.stopPropagation()}
            style={{ width: '100%', background: 'var(--bg)', borderRadius: '20px 20px 0 0', padding: '14px 18px calc(20px + env(safe-area-inset-bottom, 0px))' }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>
              Map point
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, fontFamily: 'monospace', color: 'var(--text)', margin: '2px 0 12px' }}>
              {fmtAvCoord(pressMenu.lat, pressMenu.lon)}
            </div>
            <button
              onClick={() => { setWptDraft(pressMenu); setPressMenu(null) }}
              style={{
                display: 'block', width: '100%', padding: '13px 14px', borderRadius: 12, border: 'none',
                background: 'var(--bg-card)', color: 'var(--text)', fontSize: 14, fontWeight: 700,
                textAlign: 'left', cursor: 'pointer', WebkitTapHighlightColor: 'transparent', marginBottom: 8,
              }}>
              📍 Create user waypoint here
            </button>
            <button
              onClick={() => appendPointToRoute(pressMenu)}
              style={{
                display: 'block', width: '100%', padding: '13px 14px', borderRadius: 12, border: 'none',
                background: 'var(--bg-card)', color: 'var(--text)', fontSize: 14, fontWeight: 700,
                textAlign: 'left', cursor: 'pointer', WebkitTapHighlightColor: 'transparent', marginBottom: 8,
              }}>
              ➕ Add this point to the route
            </button>
            <button
              onClick={() => openPirepAt(pressMenu)}
              style={{
                display: 'block', width: '100%', padding: '13px 14px', borderRadius: 12, border: 'none',
                background: 'var(--bg-card)', color: 'var(--text)', fontSize: 14, fontWeight: 700,
                textAlign: 'left', cursor: 'pointer', WebkitTapHighlightColor: 'transparent', marginBottom: 8,
              }}>
              📡 File a PIREP here
            </button>
            <button
              onClick={() => startUapDraftAt(pressMenu)}
              style={{
                display: 'block', width: '100%', padding: '13px 14px', borderRadius: 12, border: 'none',
                background: 'var(--bg-card)', color: 'var(--text)', fontSize: 14, fontWeight: 700,
                textAlign: 'left', cursor: 'pointer', WebkitTapHighlightColor: 'transparent', marginBottom: 8,
              }}>
              🛸 Report a UAP sighting here
            </button>
            <button
              onClick={() => setPressMenu(null)}
              style={{
                display: 'block', width: '100%', padding: '13px 14px', borderRadius: 12, border: 'none',
                background: 'transparent', color: 'var(--text-secondary)', fontSize: 14, fontWeight: 700,
                cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
              }}>
              Cancel
            </button>
          </div>
        </div>,
        document.body
      )}

      {/* Naming dialog for a new user waypoint — from press-and-hold or the
          pin-drop button. Blank name = auto WP01…, so "just save where I
          am" is two taps. Save errors (name taken by an airport/VOR/fix)
          render inline; the restriction exists so the route bar never has
          two meanings for one ident. Portaled for the same stacking-context
          reason as the press menu above. */}
      {wptDraft && createPortal(
        <div
          onClick={() => { if (!wptSaving) { setWptDraft(null); setWptName(''); setWptError(null) } }}
          style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div
            onClick={e => e.stopPropagation()}
            style={{ width: '100%', maxWidth: 400, background: 'var(--bg)', borderRadius: 18, padding: '18px 18px 16px', boxShadow: 'var(--shadow-sm)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>
              New user waypoint
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, fontFamily: 'monospace', color: 'var(--text)', margin: '2px 0 12px' }}>
              {fmtAvCoord(wptDraft.lat, wptDraft.lon)}
            </div>
            <input
              value={wptName}
              onChange={e => { setWptName(e.target.value.toUpperCase()); setWptError(null) }}
              onKeyDown={e => { if (e.key === 'Enter') saveWaypointDraft() }}
              placeholder="Name — blank saves as WP01…"
              autoCapitalize="characters" autoCorrect="off" spellCheck={false}
              style={{
                width: '100%', boxSizing: 'border-box', padding: '12px 14px', borderRadius: 12,
                border: '1px solid var(--border)', background: 'var(--bg-card)', outline: 'none',
                fontSize: 16, fontWeight: 700, fontFamily: 'monospace', letterSpacing: '0.04em', color: 'var(--text)',
              }}
            />
            {wptError && (
              <div style={{ fontSize: 12, color: 'var(--danger)', fontWeight: 600, marginTop: 8 }}>{wptError}</div>
            )}
            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              <button
                onClick={() => { setWptDraft(null); setWptName(''); setWptError(null) }}
                disabled={wptSaving}
                style={{
                  flex: 1, padding: '12px 0', borderRadius: 12, border: 'none',
                  background: 'var(--bg-card)', color: 'var(--text)', fontSize: 14, fontWeight: 700,
                  cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
                }}>
                Cancel
              </button>
              <button
                onClick={saveWaypointDraft}
                disabled={wptSaving}
                style={{
                  flex: 1, padding: '12px 0', borderRadius: 12, border: 'none',
                  background: 'var(--accent)', color: 'var(--accent-fg)', fontSize: 14, fontWeight: 700,
                  cursor: 'pointer', WebkitTapHighlightColor: 'transparent', opacity: wptSaving ? 0.6 : 1,
                }}>
                {wptSaving ? 'Saving…' : 'Save waypoint'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* PIREP form — the standard report's element groups as tap targets.
          Portaled like the other sheets. Chip groups: sky and severity are
          single-choice (radio behavior), weather phenomena multi-choice. */}
      {pirepDraft && createPortal(
        <div
          onClick={() => { if (!pirepSending) setPirepDraft(null) }}
          style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end' }}>
          <div
            onClick={e => e.stopPropagation()}
            style={{ width: '100%', maxHeight: '85vh', overflowY: 'auto', background: 'var(--bg)', borderRadius: '20px 20px 0 0', padding: '16px 18px calc(20px + env(safe-area-inset-bottom, 0px))' }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>
              File PIREP · {fmtAvCoord(pirepDraft.lat, pirepDraft.lon)}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', margin: '3px 0 12px' }}>
              Shared with AVIARA pilots who have the PIREPs layer on — not filed with the FAA.
            </div>

            {[
              { title: 'Report type', single: true, field: 'urgent', opts: [{ v: false, l: 'UA · Routine' }, { v: true, l: 'UUA · Urgent' }] },
              { title: 'Sky', single: true, field: 'sky', opts: PIREP_SKY.map(v => ({ v, l: v })) },
              { title: 'Weather', single: false, field: 'wx', opts: PIREP_WX.map(v => ({ v, l: PIREP_WX_LABELS[v] })) },
              { title: 'Turbulence', single: true, field: 'turbulence', opts: PIREP_TURB.map(v => ({ v, l: v })) },
              { title: 'Icing', single: true, field: 'icing', opts: PIREP_ICING.map(v => ({ v, l: v })) },
            ].map(group => (
              <div key={group.title} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 6 }}>
                  {group.title}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {group.opts.map(o => {
                    const active = group.single
                      ? pirep[group.field] === o.v
                      : pirep.wx.includes(o.v)
                    return (
                      <button key={String(o.v)}
                        onClick={() => setPirep(prev => group.single
                          ? { ...prev, [group.field]: prev[group.field] === o.v && group.field !== 'urgent' ? null : o.v }
                          : { ...prev, wx: prev.wx.includes(o.v) ? prev.wx.filter(x => x !== o.v) : [...prev.wx, o.v] })}
                        style={{
                          padding: '7px 12px', borderRadius: 16, fontSize: 12, fontWeight: 700,
                          border: active ? 'none' : '1px solid var(--border)',
                          background: active ? 'var(--accent)' : 'var(--bg-card)',
                          color: active ? 'var(--accent-fg)' : 'var(--text)',
                          cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
                        }}>
                        {o.l}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}

            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <input
                value={pirep.altitudeFt}
                onChange={e => setPirep(prev => ({ ...prev, altitudeFt: e.target.value.replace(/[^\d]/g, '') }))}
                placeholder="Altitude (ft)" inputMode="numeric"
                style={{
                  flex: 1, minWidth: 0, boxSizing: 'border-box', padding: '10px 12px', borderRadius: 10,
                  border: '1px solid var(--border)', background: 'var(--bg-card)', outline: 'none',
                  fontSize: 14, fontWeight: 700, color: 'var(--text)',
                }} />
              <input
                value={pirep.aircraftType}
                onChange={e => setPirep(prev => ({ ...prev, aircraftType: e.target.value.toUpperCase() }))}
                placeholder="Aircraft (C172)" autoCapitalize="characters" autoCorrect="off" spellCheck={false}
                style={{
                  flex: 1, minWidth: 0, boxSizing: 'border-box', padding: '10px 12px', borderRadius: 10,
                  border: '1px solid var(--border)', background: 'var(--bg-card)', outline: 'none',
                  fontSize: 14, fontWeight: 700, color: 'var(--text)',
                }} />
            </div>
            <input
              value={pirep.remarks}
              onChange={e => setPirep(prev => ({ ...prev, remarks: e.target.value }))}
              placeholder="Remarks (optional)"
              style={{
                width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 10,
                border: '1px solid var(--border)', background: 'var(--bg-card)', outline: 'none',
                fontSize: 14, color: 'var(--text)',
              }} />

            {pirepError && (
              <div style={{ fontSize: 12, color: 'var(--danger)', fontWeight: 600, marginTop: 8 }}>{pirepError}</div>
            )}
            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              <button
                onClick={() => setPirepDraft(null)}
                disabled={pirepSending}
                style={{
                  flex: 1, padding: '12px 0', borderRadius: 12, border: 'none',
                  background: 'var(--bg-card)', color: 'var(--text)', fontSize: 14, fontWeight: 700,
                  cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
                }}>
                Cancel
              </button>
              <button
                onClick={sendPirep}
                disabled={pirepSending}
                style={{
                  flex: 1, padding: '12px 0', borderRadius: 12, border: 'none',
                  background: 'var(--accent)', color: 'var(--accent-fg)', fontSize: 14, fontWeight: 700,
                  cursor: 'pointer', WebkitTapHighlightColor: 'transparent', opacity: pirepSending ? 0.6 : 1,
                }}>
                {pirepSending ? 'Sharing…' : 'Share PIREP'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {uapBanner && (
        <div style={{
          position: 'absolute', top: 'calc(68px + var(--map-top-inset, 0px))', left: 12, right: 12, zIndex: 500,
          background: 'var(--bg-card)', borderRadius: 14, padding: '10px 14px',
          fontSize: 13, color: 'var(--text)', boxShadow: 'var(--shadow-sm)',
        }}>
          🛸 UAP draft saved with this location — finish and submit it in Tools → UAP Report.
        </div>
      )}

      {pirepBanner && (
        <div style={{
          position: 'absolute', top: 'calc(68px + var(--map-top-inset, 0px))', left: 12, right: 12, zIndex: 500,
          background: 'var(--bg-card)', borderRadius: 14, padding: '10px 14px',
          fontSize: 13, color: 'var(--text)', boxShadow: 'var(--shadow-sm)',
        }}>
          📡 PIREP shared — visible to AVIARA pilots with the PIREPs layer on.
        </div>
      )}

      <FlightPlanBar onRouteChange={setRoute} />
      <MapLayersMenu layer={layer} setLayer={setLayer} layerOptions={LAYER_OPTIONS} overlays={overlays} toggleOverlay={handleToggleOverlay} />
      <GpsInfoBar route={route} coords={liveCoords} derived={liveDerived} status={liveStatus} lastKnown={lastKnown} />
    </div>
  )
}
