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

import { memo, useCallback, useState } from 'react'
import { TileLayer, Polygon, CircleMarker, Popup } from 'react-leaflet'
import VectorBasemap from './VectorBasemap'
import TerrainLayer from '../pages/Checklists/sections/TerrainLayer'
import { tfrColor } from '../lib/tfr'
// The marker overlays, shared with the app's other map so both draw the same
// airports from the same code rather than two copies that drift apart.
import {
  AirportLayer, HeliportLayer, SeaplaneBaseLayer, RadarLayer, FlightCategoryLayer,
} from './aerodromeLayers'
import TilePrefetch from './TilePrefetch'
import RunwayLayer from './RunwayLayer'

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
export const Basemap = memo(function Basemap({ dark = false }) {
  // SPIKE (vector-map-spike branch): the floor is OpenFreeMap vector tiles,
  // with yesterday's CARTO raster kept whole underneath as the fallback for
  // any device whose WebGL will not carry it. Reverting the whole experiment
  // is `git switch strava-layout`; the tag pre-vector-map marks the exact
  // point this branch grew from.
  const [vectorDown, setVectorDown] = useState(false)
  // Stable identity. VectorBasemap holds this in a ref precisely so it cannot
  // matter, but a fresh arrow function on every render of a component that
  // re-renders this often is the exact shape of the bug that was there, and
  // it should not be re-created here either.
  const fallBack = useCallback(() => setVectorDown(true), [])
  if (!vectorDown) return <VectorBasemap dark={dark} onFail={fallBack} />
  return <RasterBasemap dark={dark} />
})

function RasterBasemap({ dark = false }) {
  const style = dark ? 'dark_all' : 'rastertiles/voyager'
  return (<>
    <TileLayer
      key={style}
      url={`https://{s}.basemaps.cartocdn.com/${style}/{z}/{x}/{y}{r}.png`}
      // Grey patches on zoom and pan were mostly self-inflicted. keepBuffer
      // holds three rings of tiles past the edges instead of throwing them
      // away the moment they scroll off, and updateWhenIdle=false starts
      // fetches DURING a drag rather than after the finger settles, which on
      // a phone is the difference between tiles arriving with the motion and
      // arriving a beat after it.
      keepBuffer={6}
      updateWhenIdle={false}
      // CORS, same as the flight-image exporter already uses on these tiles,
      // so the service worker can store real responses it is allowed to
      // count and expire rather than opaque ones it cannot.
      crossOrigin="anonymous"
      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>' />
    {/* And the tiles nobody asked for yet: the zoom levels underneath the
        view, fetched while the map sits still, so zooming out lands on a map
        that is already there. */}
    <TilePrefetch style={style} />
  </>)
}

function ChartLayers({ layers, openaipKey, tfrData, onSetDestination, onAddWaypoint, onFocusField }) {
  // Which fields already have their pavement drawn, so the marker layer can
  // step aside for exactly those. Held here because it is a conversation
  // between two sibling layers and neither should have to know about the
  // other's existence to have it.
  const [drawnFields, setDrawnFields] = useState(null)
  return (<>
    {/* THE ZOOM NUMBERS ARE MEASURED. Do not "correct" them by reading the
        service metadata, which is how this nearly shipped blank.
        Leaflet clamps the tile zoom to maxNativeZoom and THEN adds zoomOffset,
        so the deepest tile these layers ever ask for is maxNativeZoom + 1.
        With 11 that is z12, which is exactly the deepest tile the FAA has:
        fetched over San Diego, sectional and Terminal answer 200 at z12 and
        404 at z13. Raising maxNativeZoom to 12 looks like it recovers a level
        and instead asks for tiles that do not exist, which errorTileUrl turns
        into a blank chart.
        tileSize 128 with zoomOffset 1 is the retina trick and is why the
        charts are as sharp as they are: a 256px tile in a 128 CSS box means a
        3x screen upscales by 1.5 rather than 3. */}
    {layers.sectional && (
      <TileLayer url={`${FAA}/VFR_Sectional/MapServer/tile/{z}/{y}/{x}`}
        tileSize={128} zoomOffset={1}
        opacity={1} minZoom={8} maxNativeZoom={11} maxZoom={13}
        className="sectional-layer" errorTileUrl={BLANK}
        attribution="&copy; FAA AIS" />
    )}
    {/* After the sectional on purpose, so where a Terminal Area Chart exists
        it covers the sectional with the more detailed drawing, and where it
        does not the sectional shows through untouched. Its own coverage starts
        around z10; below that there is nothing to draw. */}
    {layers.tac && (
      <TileLayer url={`${FAA}/VFR_Terminal/MapServer/tile/{z}/{y}/{x}`}
        tileSize={128} zoomOffset={1}
        opacity={1} minZoom={9} maxNativeZoom={11} maxZoom={14}
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
    {/* Both handlers are optional. The planner's own pick-a-point map passes
        neither, because there a tap already means something else, and
        onAddWaypoint is absent until a route exists to add one to. */}
    {/* Not chip-gated, and above the aerodrome markers so the numbers on the
        pavement are not hidden by the disc that marked the field from ten
        miles out. It draws nothing until the pilot is right down on one
        aerodrome, and at that zoom the marker has stopped being the answer.
        See RunwayLayer's own header for why this is a zoom floor rather than
        another chip. */}
    <RunwayLayer onFocusField={onFocusField} onDrawnFields={setDrawnFields}
      onSetDestination={onSetDestination} onAddWaypoint={onAddWaypoint} />
    {layers.airports && (
      <AirportLayer onSetDestination={onSetDestination} onAddWaypoint={onAddWaypoint}
        hideIdents={drawnFields} />
    )}
    {layers.heliports && <HeliportLayer onSetDestination={onSetDestination} onAddWaypoint={onAddWaypoint} />}
    {layers.seaplane && <SeaplaneBaseLayer onSetDestination={onSetDestination} onAddWaypoint={onAddWaypoint} />}
    {layers.fltcat && <FlightCategoryLayer />}
  </>)
}

// Memoized, and this is the one that matters most, because skipping it skips
// everything underneath it: the tile layers, the TFR polygons, the runway
// layer and all four aerodrome layers are its children, so a re-render here is
// a re-render of the entire chart stack.
//
// Its six props are stable between real changes. layers, openaipKey and
// tfrData are state, and the three callbacks are useCallback in MapHome. The
// tfrData map below builds fresh Polygon and CircleMarker elements with inline
// pathOptions on every render, which is exactly the work now being skipped.
export default memo(ChartLayers)
