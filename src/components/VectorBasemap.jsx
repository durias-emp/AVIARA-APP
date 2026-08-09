// The OpenFreeMap vector basemap, rendered by MapLibre underneath Leaflet.
//
// This is the spike's whole trick: the official maplibre-gl-leaflet bridge
// draws a GL canvas inside a Leaflet pane and keeps its camera glued to
// Leaflet's, so every overlay this app already has, the route editor, the
// draggable waypoints, the FAA raster charts, the aerodrome layers, keeps
// working untouched on top of it. We swap the floor, not the furniture.
//
// Everything loads lazily because MapLibre is roughly a megabyte of engine:
// the app's first paint should not pay for it, and a device that cannot run
// it should not download it twice.
//
// Failure falls back, loudly to the console and invisibly to the pilot: the
// caller swaps back to the CARTO raster basemap, which is the exact map the
// app shipped with yesterday. WebGL missing, style unreachable, engine
// failed to boot: all the same answer, the old floor.

import { useEffect } from 'react'
import { useMap } from 'react-leaflet'

// Their styles, by app theme. Liberty is the rich road map, closest to the
// voyager raster it replaces; dark is their night scheme on the same data.
const STYLE = {
  light: 'https://tiles.openfreemap.org/styles/liberty',
  dark: 'https://tiles.openfreemap.org/styles/dark',
}

export default function VectorBasemap({ dark = false, onFail }) {
  const map = useMap()

  useEffect(() => {
    let layer = null
    let cancelled = false
    ;(async () => {
      try {
        await import('maplibre-gl/dist/maplibre-gl.css')
        const [{ default: L }] = await Promise.all([
          import('leaflet'),
          // Registers L.maplibreGL as a side effect; it needs window.maplibregl
          // or its own import of maplibre-gl, which its package declares.
          import('@maplibre/maplibre-gl-leaflet'),
        ])
        if (cancelled) return
        layer = L.maplibreGL({
          style: dark ? STYLE.dark : STYLE.light,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; OpenMapTiles &copy; <a href="https://openfreemap.org/">OpenFreeMap</a>',
        })
        // A device without WebGL throws right here, during the layer's own
        // onAdd, which is the honest moment to find out.
        layer.addTo(map)
      } catch (err) {
        console.warn('[vector-basemap] failed, falling back to raster:', err?.message ?? err, err?.stack)
        if (!cancelled) onFail?.(err)
      }
    })()
    return () => {
      cancelled = true
      if (layer && map.hasLayer(layer)) map.removeLayer(layer)
    }
  }, [map, dark, onFail])

  return null
}
