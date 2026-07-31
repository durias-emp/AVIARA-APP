import { useEffect, useRef, useState } from 'react'
import { MapContainer, TileLayer, CircleMarker, Polyline, Polygon, Popup, ZoomControl, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { HomeButton } from './Shell'
import { useCurrentLocation } from '../hooks/useCurrentLocation'
import { useMapLayer } from '../hooks/useMapLayer'
import { useMapOverlays } from '../hooks/useMapOverlays'
import { FLTCAT } from '../lib/weather'
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
    minZoom: 8, maxNativeZoom: 11, maxZoom: 13,
  },
  ifrlo: {
    url: 'https://tiles.arcgis.com/tiles/ssFJjBXIUyZDrSYZ/arcgis/rest/services/IFR_AreaLow/MapServer/tile/{z}/{y}/{x}',
    minZoom: 8, maxNativeZoom: 11, maxZoom: 13,
  },
  ifrhi: {
    url: 'https://tiles.arcgis.com/tiles/ssFJjBXIUyZDrSYZ/arcgis/rest/services/IFR_High/MapServer/tile/{z}/{y}/{x}',
    minZoom: 5, maxNativeZoom: 8, maxZoom: 12,
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
          minZoom={chart.minZoom} maxNativeZoom={chart.maxNativeZoom} maxZoom={chart.maxZoom}
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
export function LiveMap({ position, zoom, layer, markerRadius = 8, interactive = true, zoomControlPosition, children }) {
  const interactionProps = interactive ? {} : {
    zoomControl: false, dragging: false, scrollWheelZoom: false,
    doubleClickZoom: false, touchZoom: false, keyboard: false, boxZoom: false,
  }
  return (
    <MapContainer
      center={position ?? FALLBACK_CENTER}
      zoom={position ? zoom : 4}
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

export default function MapView() {
  const { position, error, status } = useCurrentLocation()
  const { layer, setLayer } = useMapLayer()
  const { overlays, toggleOverlay } = useMapOverlays()
  const [route, setRoute] = useState(null)

  return (
    <div style={{ height: '100%', position: 'relative', isolation: 'isolate' }}>
      {status === 'pending' ? (
        <div style={{
          height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--text-secondary)', fontSize: 14,
        }}>
          Finding your location…
        </div>
      ) : (
        <LiveMap position={position} zoom={LOCATION_ZOOM} layer={layer} zoomControlPosition="bottomright">
          {overlays.radar && <RadarLayer />}
          {overlays.flightCategory && <FlightCategoryLayer />}
          {overlays.tfr && <TfrLayer />}
          <RoutePreview route={route} />
        </LiveMap>
      )}

      <div style={{ position: 'absolute', top: 12, left: 12, zIndex: 600 }}>
        <HomeButton />
      </div>

      {(status === 'error' || status === 'unsupported') && (
        <div style={{
          position: 'absolute', top: 68, left: 12, right: 12, zIndex: 500,
          background: 'var(--bg-card)', borderRadius: 14, padding: '10px 14px',
          fontSize: 13, color: 'var(--text-secondary)', boxShadow: 'var(--shadow-sm)',
        }}>
          {error}
        </div>
      )}

      {status !== 'pending' && <FlightPlanBar onRouteChange={setRoute} />}
      <MapLayersMenu layer={layer} setLayer={setLayer} layerOptions={LAYER_OPTIONS} overlays={overlays} toggleOverlay={toggleOverlay} />
      {status !== 'pending' && <GpsInfoBar route={route} />}
    </div>
  )
}
