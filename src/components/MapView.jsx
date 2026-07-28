import { MapContainer, TileLayer, CircleMarker } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { BackButton } from './Shell'
import { useCurrentLocation } from '../hooks/useCurrentLocation'
import { useMapLayer } from '../hooks/useMapLayer'

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
export function LiveMap({ position, zoom, layer, markerRadius = 8, interactive = true }) {
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
      {...interactionProps}
    >
      <MapLayers layer={layer} />
      {position && (
        <CircleMarker
          center={position}
          radius={markerRadius}
          pathOptions={{ color: '#fff', weight: 3, fillColor: '#0a84ff', fillOpacity: 1 }}
        />
      )}
    </MapContainer>
  )
}

function LayerSwitcher({ layer, setLayer }) {
  return (
    <div style={{
      position: 'absolute', bottom: 16, left: 16, right: 16, zIndex: 500,
      display: 'flex', overflowX: 'auto', gap: 8,
      background: 'var(--bg-card)', borderRadius: 14,
      boxShadow: 'var(--shadow-sm)', padding: 6,
    }}>
      {LAYER_OPTIONS.map(opt => (
        <button
          key={opt.key}
          onClick={() => setLayer(opt.key)}
          style={{
            flexShrink: 0, padding: '8px 14px', borderRadius: 10, border: 'none',
            background: layer === opt.key ? 'var(--accent)' : 'transparent',
            color: layer === opt.key ? 'var(--accent-fg)' : 'var(--text)',
            fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
          }}>
          {opt.label}
        </button>
      ))}
    </div>
  )
}

export default function MapView() {
  const { position, error, status } = useCurrentLocation()
  const { layer, setLayer } = useMapLayer()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '20px 20px 0', display: 'flex', alignItems: 'center', gap: 12 }}>
        <BackButton />
        <h2 style={{
          fontSize: 28, fontWeight: 700, letterSpacing: '-0.4px', color: 'var(--text)',
          fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
        }}>Map</h2>
      </div>

      <div style={{ flex: 1, position: 'relative', marginTop: 16 }}>
        {status === 'pending' ? (
          <div style={{
            height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-secondary)', fontSize: 14,
          }}>
            Finding your location…
          </div>
        ) : (
          <LiveMap position={position} zoom={LOCATION_ZOOM} layer={layer} />
        )}

        {(status === 'error' || status === 'unsupported') && (
          <div style={{
            position: 'absolute', top: 12, left: 12, right: 12, zIndex: 500,
            background: 'var(--bg-card)', borderRadius: 14, padding: '10px 14px',
            fontSize: 13, color: 'var(--text-secondary)', boxShadow: 'var(--shadow-sm)',
          }}>
            {error}
          </div>
        )}

        <LayerSwitcher layer={layer} setLayer={setLayer} />
      </div>
    </div>
  )
}
