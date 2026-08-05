import { projectTrack, trackDistanceNm } from './track'
import { formatClock, entryDurationMs } from './flightTime'

// Renders a flight as a picture worth posting.
//
// Two modes, and the difference is not cosmetic. `map` puts the track over the
// ground it was flown across, which needs tiles from someone else's server and
// carries their attribution. `bare` is the track alone on transparency — no
// third-party pixels, nothing to attribute, and it drops onto any background
// the pilot likes. Bare is the one that always works, so it is the default.

export const SHARE_SIZES = {
  square: { w: 1080, h: 1080, label: 'Square' },   // feed posts
  story:  { w: 1080, h: 1920, label: 'Story' },    // stories, reels, TikTok
}

const BRAND = { name: 'AVIARA', accent: '#ff6b35' }

// The basemap the app already draws with, so a shared image looks like the
// screen it came from. Requested with CORS because a canvas that has drawn an
// image from an origin which did not permit it becomes tainted, and a tainted
// canvas cannot be exported at all — the export throws rather than degrading,
// which is why the bare mode exists as a guaranteed path.
const TILE_URL = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png'
const TILE_ATTRIBUTION = '© OpenStreetMap contributors © CARTO'
const TILE_SIZE = 256

function lonToTileX(lon, z) { return ((lon + 180) / 360) * 2 ** z }
function latToTileY(lat, z) {
  const r = (lat * Math.PI) / 180
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('tile failed'))
    img.src = url
  })
}

// Picks the closest zoom at which the whole track still fits the frame. Going
// tighter would crop the flight; going looser wastes the frame on empty ground.
function chooseZoom(track, width, height) {
  const lats = track.map(p => p.lat), lons = track.map(p => p.lon)
  const minLat = Math.min(...lats), maxLat = Math.max(...lats)
  const minLon = Math.min(...lons), maxLon = Math.max(...lons)
  for (let z = 14; z >= 2; z--) {
    const w = (lonToTileX(maxLon, z) - lonToTileX(minLon, z)) * TILE_SIZE
    const h = (latToTileY(minLat, z) - latToTileY(maxLat, z)) * TILE_SIZE
    if (w <= width * 0.82 && h <= height * 0.82) return z
  }
  return 2
}

async function drawTiles(ctx, track, width, height) {
  const z = chooseZoom(track, width, height)
  const lats = track.map(p => p.lat), lons = track.map(p => p.lon)
  const centreX = lonToTileX((Math.min(...lons) + Math.max(...lons)) / 2, z)
  const centreY = latToTileY((Math.min(...lats) + Math.max(...lats)) / 2, z)

  // Pixel position of the frame's top-left corner in the whole-world tile grid.
  const originX = centreX * TILE_SIZE - width / 2
  const originY = centreY * TILE_SIZE - height / 2

  const x0 = Math.floor(originX / TILE_SIZE), x1 = Math.floor((originX + width) / TILE_SIZE)
  const y0 = Math.floor(originY / TILE_SIZE), y1 = Math.floor((originY + height) / TILE_SIZE)

  const jobs = []
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      const max = 2 ** z
      const wrappedX = ((x % max) + max) % max
      if (y < 0 || y >= max) continue
      const url = TILE_URL
        .replace('{s}', 'abc'[Math.abs(x + y) % 3])
        .replace('{z}', z).replace('{x}', wrappedX).replace('{y}', y)
      jobs.push(
        loadImage(url)
          .then(img => ctx.drawImage(img, x * TILE_SIZE - originX, y * TILE_SIZE - originY, TILE_SIZE, TILE_SIZE))
          // One missing tile is a hole, not a failure. The flight is still the
          // subject; a gap in the ground behind it is survivable.
          .catch(() => {})
      )
    }
  }
  await Promise.all(jobs)
  return { z, originX, originY }
}

function drawTrackPath(ctx, points, { glow }) {
  if (points.length < 2) return
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  if (glow) {
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'
    ctx.lineWidth = 22
    ctx.beginPath()
    points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))
    ctx.stroke()
  }
  ctx.strokeStyle = BRAND.accent
  ctx.lineWidth = 11
  ctx.beginPath()
  points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))
  ctx.stroke()

  // Where it began and where it ended, which is most of what makes a track
  // read as a journey rather than a squiggle.
  const ends = [points[0], points[points.length - 1]]
  ends.forEach((p, i) => {
    ctx.beginPath()
    ctx.arc(p.x, p.y, 16, 0, Math.PI * 2)
    ctx.fillStyle = i === 0 ? '#fff' : BRAND.accent
    ctx.strokeStyle = i === 0 ? BRAND.accent : '#fff'
    ctx.lineWidth = 6
    ctx.fill()
    ctx.stroke()
  })
}

function drawFurniture(ctx, { width, height, mode, stats }) {
  const light = mode === 'bare'
  const ink = light ? '#0d1430' : '#fff'
  const sub = light ? 'rgba(13,20,48,0.62)' : 'rgba(255,255,255,0.82)'

  // Over tiles the text needs its own ground; on transparency it must not
  // paint one, or the "no background" mode has a background.
  if (!light) {
    const grad = ctx.createLinearGradient(0, height * 0.58, 0, height)
    grad.addColorStop(0, 'rgba(0,0,0,0)')
    grad.addColorStop(1, 'rgba(0,0,0,0.72)')
    ctx.fillStyle = grad
    ctx.fillRect(0, height * 0.58, width, height * 0.42)
  }

  const pad = Math.round(width * 0.075)
  let y = height - pad

  ctx.textAlign = 'left'
  ctx.fillStyle = sub
  ctx.font = '600 30px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif'
  ctx.fillText(BRAND.name, pad, y)
  y -= 46

  const cells = [
    stats.clock && ['TIME', stats.clock],
    stats.distanceNm > 0 && ['DISTANCE', `${stats.distanceNm.toFixed(1)} NM`],
    stats.date && ['DATE', stats.date],
  ].filter(Boolean)

  const VALUE_PX = 56
  ctx.fillStyle = ink
  ctx.font = `800 ${VALUE_PX}px -apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif`
  const colW = (width - pad * 2) / Math.max(1, cells.length)
  cells.forEach(([, value], i) => ctx.fillText(value, pad + colW * i, y))

  // Clear of the value's ascender, not merely of its baseline. Canvas text is
  // positioned by baseline, so a gap measured from there puts the label
  // straight through the top of the digits above it.
  y -= VALUE_PX * 0.78 + 14
  ctx.fillStyle = sub
  ctx.font = '700 22px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif'
  cells.forEach(([label], i) => ctx.fillText(label, pad + colW * i, y))

  if (mode === 'map') {
    ctx.textAlign = 'right'
    ctx.fillStyle = 'rgba(255,255,255,0.72)'
    ctx.font = '500 18px -apple-system, BlinkMacSystemFont, sans-serif'
    ctx.fillText(TILE_ATTRIBUTION, width - pad, height - pad + 34)
  }
}

// Returns a PNG blob of the flight, or throws if there is no track to draw.
//
// `mode` is 'bare' (track on transparency) or 'map' (track over the ground).
// The map mode falls back to bare rather than failing: a tile server that is
// slow, blocked or missing CORS headers should cost the background, not the
// picture.
export async function renderFlightImage(entry, { mode = 'bare', size = 'square' } = {}) {
  const track = (entry?.track ?? []).filter(p => p && p.lat != null && p.lon != null)
  if (track.length < 2) throw new Error('This flight has no track to draw.')

  const { w: width, h: height } = SHARE_SIZES[size] ?? SHARE_SIZES.square
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')

  let usedMode = mode
  let placement = null
  if (mode === 'map') {
    try {
      placement = await drawTiles(ctx, track, width, height)
    } catch {
      usedMode = 'bare'
    }
  }

  if (usedMode === 'map' && placement) {
    // Points come from the same tile arithmetic the background used, so the
    // line lands on the ground it was actually flown over.
    const pts = track.map(p => ({
      x: lonToTileX(p.lon, placement.z) * TILE_SIZE - placement.originX,
      y: latToTileY(p.lat, placement.z) * TILE_SIZE - placement.originY,
    }))
    drawTrackPath(ctx, pts, { glow: true })
  } else {
    const { points } = projectTrack(track, { width, height: height * 0.78, padding: 0.14 })
    drawTrackPath(ctx, points, { glow: false })
  }

  drawFurniture(ctx, {
    width, height, mode: usedMode,
    stats: {
      clock: formatClock(entryDurationMs(entry)),
      distanceNm: entry.distanceNm ?? trackDistanceNm(track),
      date: entry.date ?? null,
    },
  })

  const blob = await new Promise((resolve, reject) => {
    // Throws a SecurityError if any tile tainted the canvas, which is exactly
    // the case the caller needs told about rather than silently handed a
    // broken file.
    try { canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Could not render the image.'))), 'image/png') }
    catch { reject(new Error('The map background could not be exported. Try the plain trail instead.')) }
  })

  return { blob, width, height, mode: usedMode }
}
