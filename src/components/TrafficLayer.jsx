// Live traffic, drawn on a canvas over the chart.
//
// A canvas rather than markers because a busy area returns several hundred
// targets and each one moves every frame: that many DOM nodes being
// repositioned is a stutter, and Leaflet's CircleMarker cannot be rotated to
// point along its track, which is most of what makes traffic readable.
//
// The layer never blocks the chart. Its pane is pointer-events none, so taps
// reach the sectional underneath; selecting an aircraft is done by hit-testing
// the map's own click, not by the canvas receiving one.

import { useEffect, useRef } from 'react'
import { useMap } from 'react-leaflet'
import L from 'leaflet'
import { bandFor, isLight } from './trafficBands'

const PANE = 'aviara-traffic'
const PANE_Z = 450          // above tile layers (200-400), below markers (600)

// Below this the picture is a swarm of dots that says nothing, and the fetch
// radius cannot cover the view anyway.
const MIN_ZOOM = 6
const LABEL_ZOOM = 9

// Dead reckoning is a guess, and a guess gets worse with time. Twenty seconds
// is about four missed polls: past that the target is dropped rather than
// flown across the country on stale velocity.
const MAX_EXTRAPOLATE_MS = 20000

const R_EARTH_NM = 3440.065

// Where a target is now, given where it was and how it was moving. Returns
// null when it cannot be reasoned about: no velocity (which is most of the
// ground traffic), or too old to trust.
function project(ac, elapsedMs, reducedMotion) {
  if (elapsedMs > MAX_EXTRAPOLATE_MS) return null
  if (reducedMotion || ac.gs == null || ac.trk == null || ac.gs <= 0) {
    return [ac.lat, ac.lon]
  }
  const distNm = (ac.gs * elapsedMs) / 3_600_000
  const d = distNm / R_EARTH_NM
  const brg = (ac.trk * Math.PI) / 180
  const lat1 = (ac.lat * Math.PI) / 180
  const lon1 = (ac.lon * Math.PI) / 180
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brg))
  const lon2 = lon1 + Math.atan2(
    Math.sin(brg) * Math.sin(d) * Math.cos(lat1),
    Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
  )
  return [(lat2 * 180) / Math.PI, (lon2 * 180) / Math.PI]
}

function drawTarget(ctx, x, y, ac, zoom, emphasis) {
  const band = bandFor(ac)
  const heading = ac.trk ?? 0
  const light = isLight(ac)
  // In a busy area the airliners outnumber the light aircraft three to one.
  // Drawing everything at one weight means the traffic a GA pilot actually
  // shares the sky with disappears into the flow above them, so light aircraft
  // are drawn larger and everything else recedes.
  const size = ac.gnd ? 4 : light ? 8.5 : 6
  const faded = emphasis && !light

  ctx.save()
  ctx.translate(x, y)
  if (faded) ctx.globalAlpha = 0.32

  if (ac.gnd || ac.trk == null) {
    // Nothing to point: a dot is honest, an arrow pointing north would not be.
    ctx.beginPath()
    ctx.arc(0, 0, size, 0, Math.PI * 2)
    ctx.fillStyle = band.color
    ctx.globalAlpha = 0.85
    ctx.fill()
    ctx.globalAlpha = 1
  } else {
    ctx.rotate((heading * Math.PI) / 180)
    ctx.beginPath()
    ctx.moveTo(0, -size * 1.4)
    ctx.lineTo(size, size)
    ctx.lineTo(0, size * 0.45)
    ctx.lineTo(-size, size)
    ctx.closePath()
    // MLAT is triangulated from timing rather than broadcast by the aircraft,
    // so it carries lower confidence and is drawn hollow to say so.
    if (ac.mlat) {
      ctx.strokeStyle = band.color
      ctx.lineWidth = 1.6
      ctx.stroke()
    } else {
      ctx.fillStyle = band.color
      ctx.fill()
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'
      ctx.lineWidth = 1
      ctx.stroke()
    }
    ctx.rotate((-heading * Math.PI) / 180)
  }

  // Labels for light aircraft one zoom level earlier than the rest: they are
  // the ones worth identifying, and at that scale there are few enough of them
  // to label without the map turning into text.
  const labelFrom = light ? LABEL_ZOOM - 1 : LABEL_ZOOM
  if (!faded && zoom >= labelFrom && (ac.cs || ac.alt != null)) {
    const label = [ac.cs, ac.gnd ? 'GND' : ac.alt != null ? Math.round(ac.alt / 100) : null]
      .filter(Boolean).join('  ')
    ctx.font = '600 10px -apple-system, system-ui, sans-serif'
    ctx.textAlign = 'left'
    ctx.lineWidth = 3
    ctx.strokeStyle = 'rgba(255,255,255,0.92)'
    ctx.strokeText(label, size + 4, 3)
    ctx.fillStyle = '#1c1c1e'
    ctx.fillText(label, size + 4, 3)
  }

  ctx.restore()
}

export default function TrafficLayer({ snapshot, onSelect, filter = 'ga' }) {
  const map = useMap()
  // Mirrored into a ref through an effect, not written during render. The draw
  // loop needs a value it can read every frame without the canvas being torn
  // down and rebuilt each time the filter changes, and touching a ref while
  // rendering is what the compiler rules out.
  const filterRef = useRef(filter)
  useEffect(() => { filterRef.current = filter }, [filter])
  const canvasRef = useRef(null)
  const rafRef = useRef(null)
  const positions = useRef([])      // last drawn screen positions, for hit-testing

  useEffect(() => {
    if (!map.getPane(PANE)) {
      const pane = map.createPane(PANE)
      pane.style.zIndex = String(PANE_Z)
      // The whole point: taps fall through to the chart underneath.
      pane.style.pointerEvents = 'none'
    }
    const pane = map.getPane(PANE)

    const canvas = L.DomUtil.create('canvas', 'aviara-traffic-canvas')
    canvas.style.position = 'absolute'
    pane.appendChild(canvas)
    canvasRef.current = canvas

    const dpr = window.devicePixelRatio || 1
    const ctx = canvas.getContext('2d')
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const resize = () => {
      const size = map.getSize()
      canvas.width = size.x * dpr
      canvas.height = size.y * dpr
      canvas.style.width = `${size.x}px`
      canvas.style.height = `${size.y}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()

    // Leaflet moves the pane during a pan, so the canvas has to be pushed back
    // to the top-left of the visible area every frame or it drifts off screen.
    const realign = () => {
      L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]))
    }

    const draw = () => {
      rafRef.current = requestAnimationFrame(draw)
      const size = map.getSize()
      ctx.clearRect(0, 0, size.x, size.y)
      positions.current = []

      const zoom = map.getZoom()
      if (zoom < MIN_ZOOM) return
      realign()

      const snap = snapshot.current
      if (!snap?.aircraft?.length) return

      const elapsed = Date.now() - snap.fetchedAt
      const bounds = map.getBounds().pad(0.1)

      // Heavier traffic first so the light aircraft draw on top of it rather
      // than under it.
      const ordered = filterRef.current === 'light'
        ? snap.aircraft.filter(isLight)
        : [...snap.aircraft].sort((a, b) => Number(isLight(a)) - Number(isLight(b)))
      const emphasis = filterRef.current !== 'all'

      for (const ac of ordered) {
        const pos = project(ac, elapsed, reduced)
        if (!pos) continue
        if (!bounds.contains(pos)) continue
        const p = map.latLngToContainerPoint(pos)
        drawTarget(ctx, p.x, p.y, ac, zoom, emphasis)
        positions.current.push({ ac, x: p.x, y: p.y })
      }
    }

    // Smearing: during a zoom animation the pane transform and the canvas
    // disagree, so anything drawn lands in the wrong place until it settles.
    const hide = () => { canvas.style.display = 'none' }
    const show = () => { canvas.style.display = ''; resize(); realign() }

    map.on('zoomanim', hide)
    map.on('zoomend', show)
    map.on('resize', resize)
    map.on('move', realign)

    rafRef.current = requestAnimationFrame(draw)

    // The canvas cannot be clicked, so the map is asked instead: the nearest
    // target within a finger's width wins, and anything further away is a tap
    // meant for the chart.
    const onClick = (e) => {
      if (!onSelect) return
      const p = e.containerPoint
      let best = null
      let bestD = 22
      for (const hit of positions.current) {
        const d = Math.hypot(hit.x - p.x, hit.y - p.y)
        if (d < bestD) { bestD = d; best = hit.ac }
      }
      if (best) onSelect(best)
    }
    map.on('click', onClick)

    return () => {
      cancelAnimationFrame(rafRef.current)
      map.off('zoomanim', hide)
      map.off('zoomend', show)
      map.off('resize', resize)
      map.off('move', realign)
      map.off('click', onClick)
      canvas.remove()
    }
  }, [map, snapshot, onSelect])

  return null
}
