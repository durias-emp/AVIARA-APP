// The 3D the OpenFreeMap homepage sells, reproduced honestly so it can be
// judged for what it is.
//
// A lab page, deliberately outside the app proper: pure MapLibre, no Leaflet,
// no overlays, reached only by its address. It exists to answer one question
// with your own eyes on your own phone: is a tilted camera with extruded
// buildings the 3D you wanted, or were you picturing terrain?
//
// Because that is the line that decides everything downstream. Buildings come
// free with the vector tiles already under the spike's basemap. Terrain in
// relief needs elevation tiles, which OpenFreeMap does not host, from a
// provider that will want a key. The page says so on its face rather than
// letting the demo imply otherwise.

import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

export default function Map3D() {
  const box = useRef(null)
  const navigate = useNavigate()
  const [failed, setFailed] = useState(null)

  useEffect(() => {
    let gl = null
    let cancelled = false
    ;(async () => {
      try {
        await import('maplibre-gl/dist/maplibre-gl.css')
        // v5 is a classic CJS build (the version the Leaflet bridge and the
        // OpenFreeMap docs both expect), so the library arrives as the
        // default; the fallback keeps this working if a future major goes
        // ESM-only with named exports, which v6 already did once.
        const ns = await import('maplibre-gl')
        const maplibregl = ns.default ?? ns
        if (cancelled || !box.current) return
        gl = new maplibregl.Map({
          container: box.current,
          style: 'https://tiles.openfreemap.org/styles/liberty',
          // Midtown Manhattan: dense enough that the extrusions read as a
          // city instead of scattered boxes.
          center: [-73.9857, 40.7484],
          zoom: 15.4,
          pitch: 60,
          bearing: -17,
        })
        gl.on('load', () => {
          try {
            // The vector source, found by type rather than by name, so a
            // renamed style upstream does not quietly kill the demo.
            const styleObj = gl.getStyle()
            const srcId = Object.keys(styleObj.sources).find(k => styleObj.sources[k].type === 'vector')
            if (!srcId) return
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
          } catch { /* the flat map is still a working demo */ }
        })
      } catch (err) {
        if (!cancelled) setFailed(String(err?.message ?? err))
      }
    })()
    return () => { cancelled = true; gl?.remove() }
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
        <strong>3D preview, OpenFreeMap Liberty.</strong> Drag with two fingers to
        tilt and rotate. What stands up is buildings from the same vector tiles
        the spike's basemap uses. This is not terrain: hills and valleys need
        elevation data from a separate provider, which OpenFreeMap does not host.
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
