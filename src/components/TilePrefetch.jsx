// The map underneath the map, fetched before it is asked for.
//
// Zooming out is the one move that always outran the tiles: every step out
// asks for a fresh set the viewport has never seen, so the screen went grey
// patchwork exactly when the pilot wanted the big picture. The fix is cheap
// arithmetic: a viewport needs roughly the same NUMBER of tiles at any zoom,
// because each level out covers four times the ground with tiles that each
// cover four times as much. Warming three levels down plus one ring around
// the current view costs about sixty small images on the first settle, then
// pennies after, because everything fetched is remembered and skipped.
//
// The images land in the browser's HTTP cache and in the service worker's
// tile cache (see vite.config.js), which is what the tile layer itself reads
// from, so by the time a pinch-out asks, the answer is already local. Same
// subdomain choice as Leaflet's own (x + y over the list) and the same
// retina suffix, or the cache would fill with copies of tiles under names
// the layer never asks for.
//
// Deliberately polite: nothing runs when the tab is hidden, offline, or the
// phone asks for reduced data, and a session cap keeps a long flight of
// panning from turning into a bulk download nobody asked for.

import { useEffect, useRef } from 'react'
import { useMap } from 'react-leaflet'
import L from 'leaflet'

const SUBS = 'abc'
const TILE = 256
const ZOOM_STEPS = 3      // levels below the current one to keep warm
const MIN_ZOOM = 3        // below this the whole world is a handful of tiles anyway
const MAX_BURST = 80      // per settle
const SESSION_CAP = 700   // per app session, both styles together

export default function TilePrefetch({ style }) {
  const map = useMap()
  const done = useRef(new Set())
  const total = useRef(0)
  const timer = useRef(null)

  useEffect(() => {
    // The phone said data is expensive. Prefetch is the first luxury to go.
    if (navigator.connection?.saveData) return undefined

    const retina = L.Browser.retina ? '@2x' : ''
    const urlFor = (x, y, z) =>
      `https://${SUBS[Math.abs(x + y) % SUBS.length]}.basemaps.cartocdn.com/${style}/${z}/${x}/${y}${retina}.png`

    // Tile columns and rows covering `bounds` at zoom `z`, x wrapped across
    // the antimeridian, y clamped to the projection.
    const tilesFor = (bounds, z) => {
      const nw = map.project(bounds.getNorthWest(), z)
      const se = map.project(bounds.getSouthEast(), z)
      const range = Math.pow(2, z)
      const out = []
      for (let x = Math.floor(nw.x / TILE); x <= Math.floor(se.x / TILE); x++) {
        for (let y = Math.floor(nw.y / TILE); y <= Math.floor(se.y / TILE); y++) {
          if (y < 0 || y >= range) continue
          out.push([((x % range) + range) % range, y])
        }
      }
      return out
    }

    const warm = () => {
      if (document.hidden || navigator.onLine === false) return
      const z = Math.round(map.getZoom())
      const jobs = []
      // A ring past the edges at the current zoom, so a pan starts loaded too.
      jobs.push(...tilesFor(map.getBounds().pad(0.6), z).map(([x, y]) => [x, y, z]))
      // The pyramid underneath. A zoom out by k steps shows 2^k times the
      // span, so the bounds grow by (2^k - 1) / 2 on each side to cover what
      // that step will reveal.
      for (let k = 1; k <= ZOOM_STEPS; k++) {
        const zk = z - k
        if (zk < MIN_ZOOM) break
        const pad = (Math.pow(2, k) - 1) / 2
        jobs.push(...tilesFor(map.getBounds().pad(pad), zk).map(([x, y]) => [x, y, zk]))
      }
      let burst = 0
      for (const [x, y, zk] of jobs) {
        if (burst >= MAX_BURST || total.current >= SESSION_CAP) break
        const url = urlFor(x, y, zk)
        if (done.current.has(url)) continue
        done.current.add(url)
        burst++; total.current++
        const img = new Image()
        // Same mode as the tile layer, or the browser treats these as a
        // different resource and fetches everything twice.
        img.crossOrigin = 'anonymous'
        img.decoding = 'async'
        img.src = url
      }
    }

    const schedule = () => { clearTimeout(timer.current); timer.current = setTimeout(warm, 400) }
    map.on('moveend zoomend', schedule)
    schedule()
    return () => { clearTimeout(timer.current); map.off('moveend zoomend', schedule) }
  }, [map, style])

  return null
}
