// The OpenFreeMap vector basemap, rendered by MapLibre underneath Leaflet.
//
// This is the spike's whole trick: the official maplibre-gl-leaflet bridge
// draws a GL canvas inside a Leaflet pane and keeps its camera glued to
// Leaflet's, so every overlay this app already has, the route editor, the
// draggable waypoints, the FAA raster charts, the aerodrome layers, keeps
// working untouched on top of it. We swap the floor, not the furniture.
//
// THE RULE THIS FILE EXISTS TO ENFORCE: the engine is built once and then
// left alone.
//
// It was not, and that was the flicker. The creation effect listed `onFail`
// among its dependencies, and the parent passed a fresh arrow function on
// every render, so every re-render of the map's parent destroyed the GL map
// and built another one. Measured during a single drawer drag: seven engines
// created, seven canvases, each one blank until it had refetched its style
// and drawn its first frame. That is not a map that flickers, it is a map
// being thrown away and replaced several times a second, and no amount of
// fade tuning or buffer preservation could have covered it.
//
// So: the creation effect depends on the Leaflet map and nothing else. The
// callback lives in a ref, because its identity must never be able to matter.
// A theme change restyles the running engine rather than replacing it.
//
// Two earlier guesses at the flicker are gone with it, because they were
// treatments for a disease this file did not have and both cost something:
// preserveDrawingBuffer, which forces the GPU to keep a copy of every frame
// and is the one option MapLibre's own docs tell you not to turn on unless
// you are reading pixels back; and a 0.3 padding, which was rendering two and
// a half screens of map to show one. A stable engine needs neither.
//
// Everything loads lazily because MapLibre is roughly a megabyte of engine:
// the app's first paint should not pay for it.
//
// Failure falls back, loudly to the console and invisibly to the pilot: the
// caller swaps to the CARTO raster basemap, which is the exact map the app
// shipped with before the spike. WebGL missing, style unreachable, engine
// failed to boot: all the same answer, the old floor.

import { useEffect, useRef, useState } from 'react'
import { useMap } from 'react-leaflet'

// Their styles, by app theme. Liberty is the rich road map, closest to the
// voyager raster it replaces; dark is their night scheme on the same data.
const STYLE = {
  light: 'https://tiles.openfreemap.org/styles/liberty',
  dark: 'https://tiles.openfreemap.org/styles/dark',
}

export default function VectorBasemap({ dark = false, onFail }) {
  const map = useMap()
  const layerRef = useRef(null)
  const [ready, setReady] = useState(false)

  // Held in refs so neither can reach the creation effect's dependency list.
  // `dark` is captured at first render for the initial style; any later change
  // is handled by the restyle effect below, without touching the engine.
  const onFailRef = useRef(onFail)
  const initialDark = useRef(dark)
  const appliedStyle = useRef(null)
  useEffect(() => { onFailRef.current = onFail }, [onFail])

  // Built once per Leaflet map. The dependency list is deliberately this
  // short, and adding to it is how the flicker comes back.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        await import('maplibre-gl/dist/maplibre-gl.css')
        const [{ default: L }] = await Promise.all([
          import('leaflet'),
          // Registers L.maplibreGL as a side effect.
          import('@maplibre/maplibre-gl-leaflet'),
        ])
        if (cancelled) return
        const style = initialDark.current ? STYLE.dark : STYLE.light
        appliedStyle.current = style
        const layer = L.maplibreGL({
          style,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; OpenMapTiles &copy; <a href="https://openfreemap.org/">OpenFreeMap</a>',
          // A little more map than the screen shows, so a pan reveals drawn
          // ground rather than blank margin while the throttled reposition
          // catches up. Every extra tenth is real fragment work on a phone
          // (0.3 is 2.5x the viewport's pixels, 0.15 is 1.7x), so this is the
          // smallest padding that covers a normal pan.
          padding: 0.15,
          // Labels and tiles fade in over ~300ms by default. Harmless on a
          // stable engine, but the fade restarts on every restyle, so a theme
          // change would read as the map blinking. One step instead.
          fadeDuration: 0,
        })
        // A device without WebGL throws here, during the layer's own onAdd,
        // which is the honest moment to find out.
        layer.addTo(map)
        layerRef.current = layer

        // The flicker's other half, and a real one. During a pinch the bridge
        // re-renders the GL scene at every zoom tick while Leaflet is
        // simultaneously scaling the same canvas with CSS, and the two
        // alternate on screen. Unhooking the per-tick re-render leaves the
        // gesture to the CSS scale, exactly as raster tiles have always
        // behaved, and the crisp frame lands once at zoomend.
        map.off('zoom', layer._pinchZoom, layer)

        if (!cancelled) setReady(true)
      } catch (err) {
        console.warn('[vector-basemap] failed, falling back to raster:', err?.message ?? err)
        if (!cancelled) onFailRef.current?.(err)
      }
    })()
    return () => {
      cancelled = true
      const layer = layerRef.current
      layerRef.current = null
      if (layer && map.hasLayer(layer)) map.removeLayer(layer)
    }
  }, [map])

  // A theme change restyles the running engine. Rebuilding it would mean a
  // blank map and a fresh download of every tile for what is a colour change.
  useEffect(() => {
    if (!ready) return
    const want = dark ? STYLE.dark : STYLE.light
    if (appliedStyle.current === want) return
    const gl = layerRef.current?.getMaplibreMap?.()
    if (!gl) return
    appliedStyle.current = want
    try { gl.setStyle(want) } catch { /* keep the style already on screen */ }
  }, [dark, ready])

  return null
}
