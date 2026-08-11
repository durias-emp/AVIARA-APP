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

// Magenta, and not the app's orange. The track on a shared card is competing
// with whatever photograph a pilot chose behind it, and magenta holds against
// foliage, tarmac, cloud and evening light in a way a warm orange does not:
// almost nothing outdoors is this colour, which is exactly what a line drawn
// over the outdoors needs.
const BRAND = { name: 'AVIARA', accent: '#ff2d95' }

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
  // Over a photograph or tiles the text needs its own ground. On transparency
  // it must not paint one, or the "no background" mode has a background.
  const light = mode === 'bare'
  const ink = light ? '#0d1430' : '#fff'
  const sub = light ? 'rgba(13,20,48,0.62)' : 'rgba(255,255,255,0.88)'

  if (!light) {
    // Top and bottom, not bottom alone: the figures sit high on the card and a
    // gradient only under them leaves white text on whatever the sky happened
    // to be.
    const top = ctx.createLinearGradient(0, 0, 0, height * 0.52)
    top.addColorStop(0, 'rgba(0,0,0,0.55)')
    top.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = top
    ctx.fillRect(0, 0, width, height * 0.52)

    const bottom = ctx.createLinearGradient(0, height * 0.72, 0, height)
    bottom.addColorStop(0, 'rgba(0,0,0,0)')
    bottom.addColorStop(1, 'rgba(0,0,0,0.6)')
    ctx.fillStyle = bottom
    ctx.fillRect(0, height * 0.72, width, height * 0.28)
  }

  // Label above value, stacked down the middle. Each figure is its own line
  // rather than a row of columns, because four numbers across a phone-width
  // card leaves each one too small to read at a glance in a feed, which is the
  // only place this picture is ever seen.
  const cells = [
    ['Distance Flown', stats.distance],
    ['Top Ground Speed', stats.topSpeed],
    ['Flight Time', stats.clock],
    ['Total Pilot Time', stats.totalTime],
  ].filter(([, v]) => v)

  const LABEL_PX = Math.round(width * 0.030)
  const VALUE_PX = Math.round(width * 0.082)
  const GROUP = Math.round(VALUE_PX * 1.72)

  ctx.textAlign = 'center'
  const cx = width / 2
  let y = Math.round(height * 0.10) + LABEL_PX

  cells.forEach(([label, value]) => {
    ctx.fillStyle = sub
    ctx.font = `700 ${LABEL_PX}px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif`
    ctx.fillText(label, cx, y)

    ctx.fillStyle = ink
    ctx.font = `800 ${VALUE_PX}px -apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif`
    ctx.fillText(value, cx, y + VALUE_PX * 0.98)

    y += GROUP
  })

  // The name at the foot, centred under the track, where the pilot's eye
  // finishes rather than where it starts.
  ctx.fillStyle = ink
  ctx.font = `800 ${Math.round(width * 0.052)}px -apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif`
  ctx.textAlign = 'center'
  ctx.fillText(BRAND.name, cx, height - Math.round(height * 0.055))

  if (mode === 'map') {
    ctx.textAlign = 'right'
    ctx.fillStyle = 'rgba(255,255,255,0.72)'
    ctx.font = '500 18px -apple-system, BlinkMacSystemFont, sans-serif'
    ctx.fillText(TILE_ATTRIBUTION, width - Math.round(width * 0.05), height - 24)
  }
}

// Returns a PNG blob of the flight, or throws if there is no track to draw.
//
// `mode` is 'bare' (track on transparency) or 'map' (track over the ground).
// The map mode falls back to bare rather than failing: a tile server that is
// slow, blocked or missing CORS headers should cost the background, not the
// picture.
// Top ground speed is read off the track rather than stored: the recorder
// samples speed with every point, so the fastest the aircraft went is already
// in hand and does not need a second number kept in step with it.
function topSpeedKt(track) {
  return track.reduce((best, p) => (p.speedKt > best ? p.speedKt : best), 0)
}

export async function renderFlightImage(entry, {
  mode = 'bare', size = 'square', photo = null, totalPilotHours = null,
} = {}) {
  const track = (entry?.track ?? []).filter(p => p && p.lat != null && p.lon != null)
  if (track.length < 2) throw new Error('This flight has no track to draw.')

  const { w: width, h: height } = SHARE_SIZES[size] ?? SHARE_SIZES.square
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')

  let usedMode = mode
  let placement = null

  // The pilot's own picture, covering the canvas the way a background should:
  // scaled to fill and centre-cropped, never squashed to the frame. A portrait
  // photo in a square card loses its top and bottom, which is what every app
  // that does this does, and is far better than an aircraft made narrow.
  if (mode === 'photo' && photo) {
    try {
      const img = await loadImage(photo)
      const scale = Math.max(width / img.width, height / img.height)
      const dw = img.width * scale
      const dh = img.height * scale
      ctx.drawImage(img, (width - dw) / 2, (height - dh) / 2, dw, dh)
    } catch {
      usedMode = 'bare'
    }
  }

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
    // Placed low on the card, under the figures, the way the stacked numbers
    // above it leave room for. Glowing over a photograph, because a bare line
    // on somebody's holiday snap disappears into it.
    const overlay = usedMode === 'photo'
    const { points } = projectTrack(track, {
      width, height: height * 0.42, padding: 0.16,
    })
    const shift = height * 0.46
    drawTrackPath(ctx, points.map(p => ({ x: p.x, y: p.y + shift })), { glow: overlay })
  }

  drawFurniture(ctx, {
    width, height, mode: usedMode,
    stats: {
      distance: `${(entry.distanceNm ?? trackDistanceNm(track)).toFixed(1)} NM`,
      topSpeed: topSpeedKt(track) > 0 ? `${Math.round(topSpeedKt(track))} kt` : null,
      clock: formatClock(entryDurationMs(entry)),
      // From the logbook, and omitted rather than guessed at when the caller
      // has not worked it out: a total pilot time this card invented would be
      // the one figure on it that is not about this flight and not true.
      totalTime: totalPilotHours != null ? `${totalPilotHours.toFixed(1)} hrs` : null,
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
