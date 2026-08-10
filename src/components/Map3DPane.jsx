// The 3D map, as a layer of the home screen rather than a screen of its own.
//
// It used to be a page: tapping 3D left the app, took the whole screen, and
// carried its own back button and explanation card. That reads as leaving,
// and there is nothing to leave for. The drawer, the route strip, the weather
// pill and the layer chips all still apply to the same flight, so 3D is a way
// of looking at the map, not a different place. This fills the map area and
// nothing else; every piece of chrome above it stays exactly where it was.
//
// Its own MapLibre map rather than a tilt of the main one, and that is the
// architecture, not a shortcut: the main map's camera belongs to Leaflet,
// Leaflet's camera is flat, and every overlay on it, the route editor, the
// draggable waypoints, the FAA charts, is positioned by that flatness. Tilt
// that floor and the furniture floats. So this draws the route itself, from
// the same stored record the flat map draws it from.
//
// What stands up is buildings, from the same vector tiles as the basemap.
// Not terrain: hills need elevation data from a provider that OpenFreeMap is
// not, which is a separate decision and is said in the chip's own tooltip
// rather than in a card over the map.

import { useEffect, useRef, useState } from 'react'
import { ROUTE_COLOR, ROUTE_OPACITY, ROUTE_WEIGHT } from './mapStyle'
import { dressAeroways } from './aerowayStyle'

function bearingDeg(a, b) {
  const r = Math.PI / 180
  const dLon = (b[0] - a[0]) * r
  const y = Math.sin(dLon) * Math.cos(b[1] * r)
  const x = Math.cos(a[1] * r) * Math.sin(b[1] * r) -
    Math.sin(a[1] * r) * Math.cos(b[1] * r) * Math.cos(dLon)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

// route: the stored record. centre/zoom: where the flat map is looking, so
// switching to 3D lands on the same ground rather than somewhere else.
export default function Map3DPane({ route, centre, zoom, dark = false, onFail }) {
  const box = useRef(null)
  const glRef = useRef(null)
  const [failed, setFailed] = useState(false)

  // Same discipline as the vector basemap, and for the same reason: the
  // parent re-renders constantly, and anything in this dependency list that
  // changes identity would rebuild the whole engine several times a second.
  const onFailRef = useRef(onFail)
  const initial = useRef({ route, centre, zoom, dark })
  // The theme as it is NOW, for the parts that are re-applied after a restyle.
  // `initial` is only ever the starting point; reading it later is how the view
  // ends up stranded in the theme it was born in.
  const darkRef = useRef(dark)
  const appliedDark = useRef(dark)
  const tilted = useRef(false)
  useEffect(() => { onFailRef.current = onFail }, [onFail])
  useEffect(() => { darkRef.current = dark }, [dark])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        await import('maplibre-gl/dist/maplibre-gl.css')
        const ns = await import('maplibre-gl')
        const maplibregl = ns.default ?? ns
        if (cancelled || !box.current) return

        const start = initial.current
        // GeoJSON wants [lon, lat]; the store keeps [lat, lon]. The flip is
        // here and nowhere else.
        const pts = []
        const r = start.route
        if (r?.depPos && r?.destPos) {
          pts.push([r.depPos[1], r.depPos[0]])
          for (const w of r.wpts ?? []) {
            if (w?.lat != null && w?.lon != null) pts.push([w.lon, w.lat])
          }
          pts.push([r.destPos[1], r.destPos[0]])
        }

        const opts = {
          container: box.current,
          style: `https://tiles.openfreemap.org/styles/${start.dark ? 'dark' : 'liberty'}`,
          attributionControl: false,
        }
        if (pts.length >= 2) {
          const lons = pts.map(p => p[0]), lats = pts.map(p => p[1])
          opts.bounds = [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]]
          opts.fitBoundsOptions = { padding: 70 }
        } else {
          // No route: stay exactly where the flat map was looking, so the
          // switch reads as the same place seen differently.
          opts.center = [start.centre?.lng ?? 0, start.centre?.lat ?? 0]
          opts.zoom = Math.max(13, (start.zoom ?? 13) + 1)
        }

        const gl = new maplibregl.Map(opts)
        glRef.current = gl
        window.__map3d = gl

        // styledata rather than load: load waits for a first render, and a
        // backgrounded tab never grants the frames that would produce one.
        //
        // Written to be run again, not once. setStyle throws away every layer
        // and source added to the old style, so switching theme would leave a
        // bare map with no buildings and no route unless this can put them
        // back. styledata fires again when the new style lands, so each guard
        // below asks whether its own piece is missing rather than trusting a
        // flag that only knows about the first time.
        const dress = () => {
          if (!gl.isStyleLoaded()) return
          // The same taxiways and letters the flat map draws. Tilting is a way
          // of looking at the aerodrome, not a different aerodrome, and a
          // taxiway system that disappeared on the way into 3D would say
          // otherwise.
          dressAeroways(gl)
          try {
            const src = Object.entries(gl.getStyle().sources)
              .find(([, s]) => s.type === 'vector')?.[0]
            if (src && !gl.getLayer('aviara-3d-buildings')) {
              gl.addLayer({
                id: 'aviara-3d-buildings',
                type: 'fill-extrusion',
                source: src,
                'source-layer': 'building',
                minzoom: 14,
                paint: {
                  'fill-extrusion-color': darkRef.current ? '#3a3f46' : '#c9ced8',
                  'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 12],
                  'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
                  'fill-extrusion-opacity': 0.88,
                },
              })
            }
            if (pts.length >= 2 && !gl.getSource('aviara-route')) {
              gl.addSource('aviara-route', {
                type: 'geojson',
                data: { type: 'Feature', geometry: { type: 'LineString', coordinates: pts } },
              })
              gl.addLayer({
                id: 'aviara-route',
                type: 'line',
                source: 'aviara-route',
                layout: { 'line-cap': 'round', 'line-join': 'round' },
                paint: { 'line-color': ROUTE_COLOR, 'line-width': ROUTE_WEIGHT, 'line-opacity': ROUTE_OPACITY },
              })
              gl.addSource('aviara-route-points', {
                type: 'geojson',
                data: {
                  type: 'FeatureCollection',
                  features: pts.map((p, i) => ({
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: p },
                    properties: { end: i === 0 || i === pts.length - 1 ? 1 : 0 },
                  })),
                },
              })
              gl.addLayer({
                id: 'aviara-route-points',
                type: 'circle',
                source: 'aviara-route-points',
                paint: {
                  'circle-radius': ['case', ['==', ['get', 'end'], 1], 7, 4.5],
                  'circle-color': ROUTE_COLOR,
                  'circle-stroke-color': '#ffffff',
                  'circle-stroke-width': ['case', ['==', ['get', 'end'], 1], 2.5, 1.5],
                },
              })
            }
            // The arrival, once. A theme change re-runs everything above so
            // the buildings and the route come back, but re-tilting would
            // swing the camera out from under a pilot who only changed the
            // colour of the app.
            if (!tilted.current) {
              tilted.current = true
              gl.easeTo(pts.length >= 2
                ? { pitch: 60, bearing: bearingDeg(pts[0], pts[1]), duration: 1200 }
                : { pitch: 60, duration: 1200 })
            }
          } catch (e) {
            console.warn('[map3d] dressing failed:', e?.message ?? e)
          }
        }
        gl.on('styledata', dress)
        gl.on('load', dress)
      } catch (err) {
        console.warn('[map3d] failed:', err?.message ?? err)
        if (!cancelled) { setFailed(true); onFailRef.current?.(err) }
      }
    })()
    return () => {
      cancelled = true
      const gl = glRef.current
      glRef.current = null
      if (window.__map3d === gl) delete window.__map3d
      gl?.remove()
    }
  }, [])

  // Follow the app's theme while open. The style was read once at creation, so
  // turning the app light while the tilted view was up left it stranded in the
  // dark scheme with every other surface around it white. Restyling keeps the
  // camera and the engine; `dress` above puts the buildings and the route back
  // when the new style lands.
  useEffect(() => {
    const gl = glRef.current
    if (!gl || appliedDark.current === dark) return
    appliedDark.current = dark
    try {
      gl.setStyle(`https://tiles.openfreemap.org/styles/${dark ? 'dark' : 'liberty'}`)
    } catch { /* keep the style already on screen */ }
  }, [dark])

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div ref={box} style={{ position: 'absolute', inset: 0 }} />
      {failed && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
          justifyContent: 'center', padding: 30, textAlign: 'center',
          background: 'var(--map-panel-solid)', color: 'var(--map-ink)',
          fontSize: 13, lineHeight: 1.6,
        }}>
          This device could not start the 3D engine.
        </div>
      )}
    </div>
  )
}
