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

import { TileLayer, Polygon, CircleMarker, Popup } from 'react-leaflet'
import TerrainLayer from '../pages/Checklists/sections/TerrainLayer'
import { tfrColor } from '../lib/tfr'
// The marker overlays, shared with the app's other map so both draw the same
// airports from the same code rather than two copies that drift apart.
import {
  AirportLayer, HeliportLayer, SeaplaneBaseLayer, RadarLayer, FlightCategoryLayer,
} from './aerodromeLayers'

// A transparent 1px PNG. A missing chart tile is a hole in the mosaic, not an
// error, and the browser's broken-image glyph tiled across the map is worse
// than nothing.
const BLANK = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

const FAA = 'https://tiles.arcgis.com/tiles/ssFJjBXIUyZDrSYZ/arcgis/rest/services'

// The basemap follows the app's appearance. A daylight road map under a dark
// cockpit app is the brightest thing on the screen at night, which is the one
// time a pilot most wants it not to be. CARTO publishes a dark variant on the
// same scheme, so this is a URL change and nothing else.
//
// key forces Leaflet to rebuild the layer on the swap: changing only the url
// prop leaves the already-loaded light tiles on screen until something else
// invalidates them.
export function Basemap({ dark = false }) {
  const style = dark ? 'dark_all' : 'rastertiles/voyager'
  return (
    <TileLayer
      key={style}
      url={`https://{s}.basemaps.cartocdn.com/${style}/{z}/{x}/{y}{r}.png`}
      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>' />
  )
}

export default function ChartLayers({ layers, openaipKey, tfrData, onAddToRoute }) {
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
    {/* Restrictions draw above the charts: a TFR hidden under a chart layer is
        worse than no TFR at all. Polygons where the feed gives geometry, a
        marker where it only gives a point. */}
    {layers.tfr && tfrData?.map((t, i) => {
      const color = tfrColor(t.type)
      const info = (
        <Popup>
          <div style={{ fontSize: 12, lineHeight: 1.5, maxWidth: 210 }}>
            <strong style={{ color }}>{t.type}</strong> · {t.id}<br />
            <span style={{ fontSize: 11 }}>{(t.desc || '').slice(0, 140)}</span>
          </div>
        </Popup>
      )
      return t.polygon?.length > 2 ? (
        <Polygon key={`tfr-${i}`} positions={t.polygon}
          pathOptions={{ color, fillColor: color, fillOpacity: 0.18, weight: 2, opacity: 0.9 }}>
          {info}
        </Polygon>
      ) : (
        <CircleMarker key={`tfr-${i}`} center={[t.lat, t.lon]} radius={10}
          pathOptions={{ color, fillColor: color, fillOpacity: 0.25, weight: 2 }}>
          {info}
        </CircleMarker>
      )
    })}

    {layers.airspace && openaipKey && (
      <TileLayer key={openaipKey}
        url={`https://api.tiles.openaip.net/api/data/openaip/{z}/{x}/{y}.png?apiKey=${openaipKey}`}
        opacity={0.9} minZoom={4} maxZoom={17}
        attribution='&copy; <a href="https://www.openaip.net">openAIP</a>' />
    )}

    {/* Radar sits under the aerodrome markers on purpose: it is a tile layer
        covering whole states, and a field hidden under a precipitation cell is
        exactly the field the pilot is looking for. */}
    {layers.radar && <RadarLayer />}
    {/* onAddToRoute is optional: the planner's own pick-a-point map passes
        nothing, because there the tap already means something else. */}
    {layers.airports && <AirportLayer onAddToRoute={onAddToRoute} />}
    {layers.heliports && <HeliportLayer onAddToRoute={onAddToRoute} />}
    {layers.seaplane && <SeaplaneBaseLayer onAddToRoute={onAddToRoute} />}
    {layers.fltcat && <FlightCategoryLayer />}
  </>)
}
