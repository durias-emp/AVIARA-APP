// Terrain relief, rendered in the browser from open elevation tiles.
//
// The FAA charts this app leans on stop at the US border. South of it the map
// is a road basemap with airspace drawn over it, which is a thin thing to hand
// a pilot crossing the Sierra Madre. This fills that in: hypsometric tint plus
// hillshade, in the colours a sectional uses, anywhere on earth.
//
// Source: AWS Terrain Tiles, an open DEM (SRTM, ASTER, Copernicus and national
// sources) published in terrarium encoding on the same XYZ scheme every other
// layer here uses.
//
//     elevation_m = (R * 256 + G + B / 256) - 32768
//
// Rendered client side rather than pre-generated and hosted. Pre-rendering
// means a tile pipeline, storage, and a coverage decision made months before
// anyone flies there; this works everywhere immediately and costs nothing to
// serve. The price is the decode and shade per tile, which is 65k pixels of
// arithmetic and lands well inside a frame.
//
// What this is not: a chart. There are no obstacles, no airspace, no
// boundaries, and the elevation under any one pixel is a sample rather than a
// surveyed summit. Terrain clearance figures come from lib/terrain.js, which
// refines to 0.25 NM around the peak precisely because a coarse sample reads
// low. Do not let a number be read off this layer.

import { useEffect } from 'react'
import { useMap } from 'react-leaflet'
import L from 'leaflet'

const SRC = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
const TILE = 256
const M_TO_FT = 3.28084

// Breaks in feet, so the colour changes where a pilot's decisions change
// rather than at round metric numbers.
const RAMP = [
  [0, [0xC8, 0xDC, 0xB4]],
  [500, [0xC0, 0xD6, 0xA4]],
  [1000, [0xD2, 0xD9, 0x9C]],
  [2000, [0xE2, 0xD8, 0x9E]],
  [3000, [0xE2, 0xC8, 0x92]],
  [5000, [0xD8, 0xAC, 0x7C]],
  [7000, [0xC8, 0x90, 0x6A]],
  [9000, [0xB4, 0x78, 0x5C]],
  [12000, [0xA0, 0x60, 0x50]],
  [16000, [0x8C, 0x50, 0x44]],
]
const SEA = [0xAE, 0xCF, 0xE0]

// A 256 entry lookup, built once. Interpolating the ramp per pixel is the
// difference between a tile that renders in a frame and one that does not.
const LUT = (() => {
  const lut = new Uint8Array(1024 * 3)          // 0 to 16,000 ft in 1024 steps
  for (let i = 0; i < 1024; i++) {
    const ft = (i / 1023) * 16000
    let a = RAMP[0], b = RAMP[RAMP.length - 1]
    for (let k = 0; k < RAMP.length - 1; k++) {
      if (ft >= RAMP[k][0] && ft <= RAMP[k + 1][0]) { a = RAMP[k]; b = RAMP[k + 1]; break }
    }
    const t = b[0] === a[0] ? 0 : (ft - a[0]) / (b[0] - a[0])
    for (let c = 0; c < 3; c++) lut[i * 3 + c] = a[1][c] + (b[1][c] - a[1][c]) * t
  }
  return lut
})()

// Metres per pixel at this zoom and latitude, so the hillshade's slope angles
// mean something instead of being scaled to the pixel grid.
function groundRes(z, y) {
  const n = 2 ** z
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / n)))
  return (156543.03392 * Math.cos(latRad)) / n
}

function renderTile(ctx, img, coords) {
  ctx.drawImage(img, 0, 0)
  const src = ctx.getImageData(0, 0, TILE, TILE)
  const s = src.data

  const elev = new Float32Array(TILE * TILE)
  for (let i = 0, p = 0; i < elev.length; i++, p += 4) {
    elev[i] = s[p] * 256 + s[p + 1] + s[p + 2] / 256 - 32768
  }

  const res = groundRes(coords.z, coords.y)
  // Modest vertical exaggeration. True relief at these zooms is legible but
  // flat, and the job is reading the shape of a ridge, not measuring it.
  const zf = 1.6
  const azRad = ((360 - 315 + 90) * Math.PI) / 180
  const altRad = (45 * Math.PI) / 180
  const sinAlt = Math.sin(altRad)
  const cosAlt = Math.cos(altRad)

  const out = ctx.createImageData(TILE, TILE)
  const o = out.data

  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const i = y * TILE + x
      const h = elev[i]
      const p = i * 4

      if (h <= 0) {
        o[p] = SEA[0]; o[p + 1] = SEA[1]; o[p + 2] = SEA[2]; o[p + 3] = 255
        continue
      }

      // Edges replicate rather than wrap, which would fold the far side of the
      // tile into the gradient and draw a bright seam.
      const xl = x > 0 ? x - 1 : x, xr = x < TILE - 1 ? x + 1 : x
      const yu = y > 0 ? y - 1 : y, yd = y < TILE - 1 ? y + 1 : y
      const dx = ((elev[y * TILE + xr] - elev[y * TILE + xl]) * zf) / ((xr - xl) * res)
      const dy = ((elev[yd * TILE + x] - elev[yu * TILE + x]) * zf) / ((yd - yu) * res)

      const slope = Math.atan(Math.hypot(dx, dy))
      const aspect = Math.atan2(-dx, dy)
      let shade = sinAlt * Math.cos(slope) + cosAlt * Math.sin(slope) * Math.cos(azRad - aspect)
      if (shade < 0) shade = 0

      const ft = h * M_TO_FT
      let idx = Math.round((ft / 16000) * 1023)
      if (idx < 0) idx = 0; else if (idx > 1023) idx = 1023
      const li = idx * 3
      // Never shade all the way to black: the tint has to survive the shadow
      // or the high ground reads as a hole rather than as high ground.
      const k = 0.55 + 0.55 * shade
      o[p] = Math.min(255, LUT[li] * k)
      o[p + 1] = Math.min(255, LUT[li + 1] * k)
      o[p + 2] = Math.min(255, LUT[li + 2] * k)
      o[p + 3] = 255
    }
  }
  ctx.putImageData(out, 0, 0)
}

export default function TerrainLayer({ opacity = 1, zIndex = 190 }) {
  const map = useMap()

  useEffect(() => {
    const Grid = L.GridLayer.extend({
      createTile(coords, done) {
        const tile = document.createElement('canvas')
        tile.width = TILE
        tile.height = TILE
        const ctx = tile.getContext('2d', { willReadFrequently: true })

        const img = new Image()
        // Required: without it the canvas is tainted and getImageData throws,
        // which is a silent blank layer rather than an error anyone sees.
        img.crossOrigin = 'anonymous'
        img.onload = () => {
          try { renderTile(ctx, img, coords) } catch { /* leave the tile blank */ }
          done(null, tile)
        }
        img.onerror = () => done(null, tile)   // a hole in the DEM is not an error
        img.src = SRC
          .replace('{z}', coords.z)
          .replace('{x}', coords.x)
          .replace('{y}', coords.y)
        return tile
      },
    })

    // maxNativeZoom 12: the source has data above it, but at 295 m per pixel
    // and finer the relief stops adding information and the decode cost keeps
    // rising. Overzoom the good level instead.
    //
    // maxZoom is deliberately past anything the app uses. It caps where the
    // layer stops drawing, not where it stops fetching, so a value that merely
    // looks generous makes the terrain vanish while the basemap carries on:
    // the same silent blank the sectional gives below its minZoom. Found by
    // zooming to 18 against a cap of 17 and getting an empty layer.
    const layer = new Grid({ minZoom: 3, maxZoom: 22, maxNativeZoom: 12, opacity, zIndex })
    layer.addTo(map)
    return () => { map.removeLayer(layer) }
  }, [map, opacity, zIndex])

  return null
}
