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

// The first leg's bearing used to be computed here, to swing the 3D camera
// round to face down the route on arrival. It went with the camera fitting:
// this view follows the flat map now, and the flat map is north-up.

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

        // Wherever the flat map was looking. Always, route or no route.
        //
        // This used to have a second branch: with a route stored it ignored the
        // camera entirely and fitted the whole flight into the frame. That
        // reads as going somewhere, and 3D is not somewhere to go. A pilot
        // zoomed onto the destination who taps 3D to look at the terrain around
        // it does not want the 167 NM they already know about; they want the
        // ground under them, tilted. The route is still drawn, it just does not
        // grab the camera.
        //
        // `.lon`, not `.lng`. The centre comes from SizeWatcher's onMove, which
        // publishes { lat, lon }; reading `.lng` gave undefined, the ?? 0 turned
        // that into the prime meridian, and 3D opened in the Atlantic at the
        // pilot's latitude no matter where they were. Latitude was right, which
        // is what made it look like a camera bug rather than a typo.
        const opts = {
          container: box.current,
          style: `https://tiles.openfreemap.org/styles/${start.dark ? 'dark' : 'liberty'}`,
          attributionControl: false,
          center: [start.centre?.lon ?? 0, start.centre?.lat ?? 0],
          // The same zoom, not a nudged one. Leaflet and MapLibre share the
          // Web Mercator scale, so matching it is what makes the two views the
          // same ground. The old +1 with a floor of 13 was there to guarantee
          // buildings, which start at 14, but buying them by moving the camera
          // is the same jump in miniature.
          zoom: start.zoom ?? 13,
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
        // NOT gated on isStyleLoaded, and that is a fix rather than an
        // oversight. isStyleLoaded asks whether every source has finished
        // fetching its tiles, which is a much later question than "can a layer
        // be added". Gated on it, every one of these events could fire while
        // tiles were still arriving, every call would bail, and nothing would
        // fire again: caught in the browser with the style loaded and no
        // route, no buildings and no taxiways on the tilted map. A parsed
        // style with sources in it is the real precondition, which is what the
        // read below tests.
        const dress = () => {
          let style
          try { style = gl.getStyle() } catch { return }
          if (!style?.sources) return
          // The same taxiways and letters the flat map draws. Tilting is a way
          // of looking at the aerodrome, not a different aerodrome, and a
          // taxiway system that disappeared on the way into 3D would say
          // otherwise.
          dressAeroways(gl)
          try {
            const src = Object.entries(style.sources)
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
            //
            // Pitch only. It used to swing the bearing round to the route's
            // first leg as well, which made sense while the camera was being
            // fitted to that route and makes none now that it stays where the
            // flat map was: north is up on the map the pilot just left, so
            // north stays up here. Turning the world under someone who asked
            // to tilt it is the same surprise this commit is removing.
            if (!tilted.current) {
              tilted.current = true
              gl.easeTo({ pitch: 60, duration: 1200 })
            }
          } catch (e) {
            console.warn('[map3d] dressing failed:', e?.message ?? e)
          }
        }
        // Three, and the third is what makes it reliable. styledata fires
        // while the style is still being assembled; load needs a first render,
        // which a backgrounded tab never grants; idle fires whenever the map
        // has finished whatever it was doing. Every guard inside dress asks
        // whether its own piece is missing, so the repeats cost a lookup.
        gl.on('styledata', dress)
        gl.on('load', dress)
        gl.on('idle', dress)
        dress()
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
