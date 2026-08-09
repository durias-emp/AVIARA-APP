// The 3D view, reached from the layers panel: your route, in the scene.
//
// A separate MapLibre map rather than a mode of the main one, and that is a
// constraint, not a shortcut: the main map's camera is Leaflet's, Leaflet's
// camera is flat, and every overlay on it is positioned by that flatness.
// This page owns its own tilted camera, draws the route from the same stored
// record the main map draws it from, and hands back with its back button.
// ForeFlight splits its 3D exactly the same way, for the same reason.
//
// What stands up is buildings, from the same vector tiles as the basemap.
// It is said on the face of the page: this is not terrain. Hills need
// elevation data from a separate provider, which OpenFreeMap does not host,
// and that decision sits downstream of a different conversation.

import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { get } from '../../lib/db'
import { findAirport } from '../../lib/aerodromes'
import { ROUTE_COLOR, ROUTE_OPACITY, ROUTE_WEIGHT } from '../../components/mapStyle'

// Where the camera looks when there is nothing of the pilot's to look at:
// Midtown, dense enough that the extrusions read as a city.
const DEMO = { center: [-73.9857, 40.7484], zoom: 15.4 }

function bearingDeg(a, b) {
  const r = Math.PI / 180
  const dLon = (b[0] - a[0]) * r
  const y = Math.sin(dLon) * Math.cos(b[1] * r)
  const x = Math.cos(a[1] * r) * Math.sin(b[1] * r) -
    Math.sin(a[1] * r) * Math.cos(b[1] * r) * Math.cos(dLon)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

export default function Map3D() {
  const box = useRef(null)
  const navigate = useNavigate()
  const [failed, setFailed] = useState(null)
  const [hasRoute, setHasRoute] = useState(false)

  useEffect(() => {
    let gl = null
    let cancelled = false
    ;(async () => {
      try {
        await import('maplibre-gl/dist/maplibre-gl.css')
        const ns = await import('maplibre-gl')
        const maplibregl = ns.default ?? ns

        // The same record the main map draws. GeoJSON wants [lon, lat], the
        // store keeps [lat, lon]: the flip is here and nowhere else.
        const route = await get('settings', 'route').catch(() => null)
        const pts = []
        if (route?.depPos && route?.destPos) {
          pts.push([route.depPos[1], route.depPos[0]])
          for (const w of route.wpts ?? []) {
            if (w?.lat != null && w?.lon != null) pts.push([w.lon, w.lat])
          }
          pts.push([route.destPos[1], route.destPos[0]])
        }
        if (cancelled || !box.current) return
        setHasRoute(pts.length >= 2)

        const opts = {
          container: box.current,
          style: 'https://tiles.openfreemap.org/styles/liberty',
          // Same iOS composite-flash guard as the basemap bridge: the caption
          // card's blur samples this canvas, and without a preserved buffer
          // each recomposite may catch it cleared and flash. v5 spelling.
          canvasContextAttributes: { preserveDrawingBuffer: true },
        }
        if (pts.length >= 2) {
          const lons = pts.map(p => p[0]), lats = pts.map(p => p[1])
          opts.bounds = [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]]
          opts.fitBoundsOptions = { padding: 90 }
        } else {
          // No route: the pilot's own field if it is known, else the demo.
          const home = await get('settings', 'homeAirport').catch(() => null)
          const hit = home?.value ? await findAirport(home.value).catch(() => null) : null
          if (cancelled || !box.current) return
          opts.center = hit ? [hit.lon, hit.lat] : DEMO.center
          opts.zoom = hit ? 13.5 : DEMO.zoom
        }

        gl = new maplibregl.Map(opts)
        // A lab page carries its own inspection hatch.
        window.__map3d = gl

        // On style-ready rather than on 'load': load waits for a first render,
        // and a render needs animation frames a backgrounded tab never grants.
        // styledata fires the moment the style itself is usable.
        let dressed = false
        const dress = () => {
          if (dressed || !gl.isStyleLoaded()) return
          dressed = true
          try {
            const styleObj = gl.getStyle()
            const srcId = Object.keys(styleObj.sources).find(k => styleObj.sources[k].type === 'vector')
            if (srcId) {
              gl.addLayer({
                id: 'aviara-3d-buildings',
                type: 'fill-extrusion',
                source: srcId,
                'source-layer': 'building',
                minzoom: 14,
                paint: {
                  'fill-extrusion-color': '#c9ced8',
                  'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 12],
                  'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
                  'fill-extrusion-opacity': 0.88,
                },
              })
            }
            if (pts.length >= 2) {
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
              // The arrival: tilt in, nose pointed down the first leg, so the
              // route runs away from the pilot the way it will out the window.
              gl.easeTo({ pitch: 60, bearing: bearingDeg(pts[0], pts[1]), duration: 1400 })
            } else {
              gl.easeTo({ pitch: 60, bearing: -17, duration: 1400 })
            }
          } catch (e) {
            // The flat vector map is still a working demo without its dressing.
            console.warn('[map3d] dressing failed:', e?.message ?? e)
          }
        }
        gl.on('styledata', dress)
        gl.on('load', dress)
      } catch (err) {
        if (!cancelled) setFailed(String(err?.message ?? err))
      }
    })()
    return () => { cancelled = true; gl?.remove(); if (window.__map3d === gl) delete window.__map3d }
  }, [])

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0b0d10', zIndex: 500 }}>
      <div ref={box} style={{ position: 'absolute', inset: 0 }} />

      <button
        onClick={() => navigate('/')}
        aria-label="Back to the map"
        style={{
          position: 'absolute', top: 'calc(var(--safe-top, 0px) + 14px)', left: 14,
          width: 44, height: 44, borderRadius: 22, border: 'none', cursor: 'pointer',
          background: 'rgba(20,20,22,0.82)', color: '#fff', fontSize: 20, fontWeight: 700,
          backdropFilter: 'blur(10px)', zIndex: 2,
        }}>
        {'←'}
      </button>

      <div style={{
        position: 'absolute', left: 14, right: 14,
        bottom: 'calc(var(--safe-bottom, 0px) + 14px)',
        background: 'rgba(20,20,22,0.82)', backdropFilter: 'blur(10px)',
        borderRadius: 14, padding: '10px 14px', zIndex: 2,
        color: '#fff', fontSize: 12, lineHeight: 1.5,
      }}>
        <strong>3D view, OpenFreeMap Liberty.</strong>{' '}
        {hasRoute
          ? 'Your route, tilted down its first leg. Drag with two fingers to tilt and rotate.'
          : 'Drag with two fingers to tilt and rotate.'}{' '}
        What stands up is buildings from the vector tiles. This is not terrain:
        hills and valleys need elevation data from a separate provider, which
        OpenFreeMap does not host.
      </div>

      {failed && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
          justifyContent: 'center', textAlign: 'center', padding: 30,
          color: '#fff', fontSize: 14, lineHeight: 1.6, zIndex: 2,
        }}>
          This device could not start the 3D engine.<br />{failed}
        </div>
      )}
    </div>
  )
}
