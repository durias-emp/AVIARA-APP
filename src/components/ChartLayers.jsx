// The chart tile layers, on their own so more than one map can wear them.
//
// Lifted verbatim from the planner's map (RouteAltitude's MapLayers), which
// still carries its own copy: that map is entangled with waypoints, dropped
// pins and aerodrome popups, and pulling it apart mid-redesign would risk the
// one screen pilots already rely on. This is the shared half, and the planner
// can adopt it later without either map changing what it draws.
//
// Every tuning note below was paid for once already. Do not simplify:
//
// tileSize 128 + zoomOffset 1 is why the chart looks sharp. The FAA publishes
// 256px tiles at 96 dpi, so on a 3x phone each chart pixel was smeared over
// three device pixels. This pulls the next zoom level down and draws it into
// half the space. Four times the tiles for the same area, worth it for a
// chart being read for terrain and airspace, not worth it for the basemap
// (which already serves @2x).
//
// maxNativeZoom sits one below the service's real limit because the offset is
// added to it: at map zoom 11 this asks for zoom 12, the deepest level the FAA
// caches.
//
// minZoom matters more than it looks. Below its minZoom a Leaflet layer draws
// NOTHING, silently, and the basemap showing through reads as "the chart is
// broken" rather than "zoom in". The sectional is unreadable below 8 anyway
// and its mosaic edges look ragged, so handing off to the basemap is the
// deliberate behaviour, the same one ForeFlight has.

import { TileLayer } from 'react-leaflet'
import TerrainLayer from '../pages/Checklists/sections/TerrainLayer'

// A transparent 1px PNG. A missing chart tile is a hole in the mosaic, not an
// error, and the browser's broken-image glyph tiled across the map is worse
// than nothing.
const BLANK = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

const FAA = 'https://tiles.arcgis.com/tiles/ssFJjBXIUyZDrSYZ/arcgis/rest/services'

export function Basemap() {
  return (
    <TileLayer
      url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>' />
  )
}

export default function ChartLayers({ layers, openaipKey }) {
  return (<>
    {layers.sectional && (
      <TileLayer url={`${FAA}/VFR_Sectional/MapServer/tile/{z}/{y}/{x}`}
        tileSize={128} zoomOffset={1}
        opacity={1} minZoom={8} maxNativeZoom={11} maxZoom={13}
        className="sectional-layer" errorTileUrl={BLANK}
        attribution="&copy; FAA AIS" />
    )}
    {layers.ifrlo && (
      <TileLayer url={`${FAA}/IFR_AreaLow/MapServer/tile/{z}/{y}/{x}`}
        tileSize={128} zoomOffset={1}
        opacity={1} minZoom={8} maxNativeZoom={11} maxZoom={13}
        className="sectional-layer" errorTileUrl={BLANK}
        attribution="&copy; FAA AIS" />
    )}
    {layers.ifrhi && (
      <TileLayer url={`${FAA}/IFR_High/MapServer/tile/{z}/{y}/{x}`}
        tileSize={128} zoomOffset={1}
        opacity={1} minZoom={5} maxNativeZoom={8} maxZoom={12}
        className="sectional-layer" errorTileUrl={BLANK}
        attribution="&copy; FAA AIS" />
    )}
    {/* Client-rendered relief from open elevation tiles. The FAA charts stop
        at the border; this does not, which is the whole point of it south of
        one. */}
    {layers.terrain && <TerrainLayer />}
    {layers.airspace && openaipKey && (
      <TileLayer key={openaipKey}
        url={`https://api.tiles.openaip.net/api/data/openaip/{z}/{x}/{y}.png?apiKey=${openaipKey}`}
        opacity={0.9} minZoom={4} maxZoom={17}
        attribution='&copy; <a href="https://www.openaip.net">openAIP</a>' />
    )}
  </>)
}
