// The route line you can bend, on the map you fly from.
//
// Modelled on the planner's own PolylineEditor (RouteAltitude.jsx), which
// already solved most of this the hard way: a fat invisible line so a fingertip
// can find a 4px course, window-level listeners so a finger leaving the map
// still finishes the gesture, a guard against pointerdown and touchstart both
// firing for one finger, and a sweep for temporary layers an interrupted drag
// left behind. Those lessons are carried over rather than rediscovered.
//
// What is different here is how the gesture starts, and it matters more on this
// map than on the planner's. The planner grabs the line on touch, which means
// putting a finger on the course and pulling pans nothing and bends the route.
// That is fine on a screen whose whole job is editing a route. The map home is
// a map: panning is what a finger does, and a magenta line drawn corner to
// corner is the easiest thing on it to touch by accident.
//
// So it takes a hold, which is what ForeFlight and Garmin Pilot both ask for.
// In ForeFlight you touch and hold the magenta line until it gives, then drag
// the bend where you want it and let go; Garmin Pilot's rubber-band routing is
// the same gesture. Holding is what separates "I mean this line" from "I am
// moving the map", and it is the gesture this app already uses for picking up a
// chip in the route strip, so a pilot only learns it once.
//
//   hold the line, then drag   put a waypoint where you let go
//   hold and let go            put one on the line, where you held it
//   drag across the line       pan the map, as if the line were not there
//   tap a waypoint             its name, and the way to take it out
//
// Deliberately NOT tap-to-add. The planner learned that one: a tap on the line
// opened an add-waypoint prompt, and the line is a target the width of the map.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Polyline, CircleMarker, Tooltip, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import { crossTrackNm } from '../lib/geo'
import { ROUTE_COLOR, ROUTE_OPACITY, ROUTE_WEIGHT } from './mapStyle'

// The same figures the route strip uses to tell a pick-up from a scroll, so the
// two gestures feel like one idea rather than two thresholds.
const HOLD_MS = 350
const HOLD_SLOP_PX = 10

export default function RouteLineEditor({
  positions,          // [[lat, lon], ...] the whole route, ends included
  onInsert,           // ({ lat, lon, seg }) seg counts legs from 1
  onRemove,           // (middleIndex) 0-based into the waypoints between the ends
  middleNames = [],   // names for those middle points, for the remove popup
  depIdent, destIdent,
}) {
  const map = useMap()
  const hitRef = useRef(null)
  const visRef = useRef(null)
  const drag = useRef(null)
  const tempLayers = useRef([])
  const [armed, setArmed] = useState(false)
  const [picked, setPicked] = useState(null)   // { i, lat, lon } a tapped waypoint

  // Positions get a fresh array identity every render, so the gesture effect
  // keys on their value rather than tearing itself down and rebuilding its
  // listeners mid-drag. The ref is written from an effect declared first, so it
  // is already current by the time the one below reads it.
  const key = JSON.stringify(positions)
  const posRef = useRef(positions)
  useEffect(() => { posRef.current = positions }, [key, positions])

  // The visible course line is deaf to the pointer, so every touch reaches the
  // fat target underneath it.
  //
  // It is drawn after the hit line and therefore sits above it, and a finger
  // landing dead centre on the 4px course hit THIS and never reached the 36px
  // target: the gesture failed precisely where the pilot aimed best, and worked
  // when they aimed slightly off. Set on the element rather than through
  // Leaflet's `interactive` option, which react-leaflet does not pass on from
  // pathOptions — verified in the DOM, the class and pointer-events were
  // unchanged.
  useEffect(() => {
    const el = visRef.current?._path
    if (el) el.style.pointerEvents = 'none'
  }, [key])

  useEffect(() => {
    const path = hitRef.current?._path
    if (!path) return

    const pointFrom = (ev) => {
      const t = ev.touches?.[0] ?? ev.changedTouches?.[0] ?? ev
      if (t.clientX == null) return null
      return map.containerPointToLatLng(
        map.mouseEventToContainerPoint({ clientX: t.clientX, clientY: t.clientY }))
    }

    // Which leg the bend belongs to.
    const segmentAt = (lat, lon) => {
      const p = posRef.current
      let bestSeg = 1, bestDist = Infinity
      for (let i = 0; i < p.length - 1; i++) {
        const d = crossTrackNm(lat, lon, p[i], p[i + 1])
        if (d < bestDist) { bestDist = d; bestSeg = i + 1 }
      }
      return bestSeg
    }

    const withBend = (seg, ll) => {
      const next = posRef.current.map(p => [...p])
      next.splice(seg, 0, [ll.lat, ll.lng])
      return next
    }

    // The moment the line gives. Everything visible about the gesture starts
    // here, because before this the pilot may simply be panning.
    const arm = (d) => {
      d.armed = true
      setArmed(true)
      map.dragging.disable()
      // Where it is supported. iOS Safari ignores it, which is why the handle
      // appearing is the real confirmation and this is only ever a bonus.
      try { navigator.vibrate?.(12) } catch { /* not available */ }
      visRef.current?.setStyle({ opacity: 0 })
      d.line = L.polyline(withBend(d.seg, d.latlng), {
        color: ROUTE_COLOR, weight: ROUTE_WEIGHT, opacity: ROUTE_OPACITY,
        lineCap: 'round', lineJoin: 'round',
      }).addTo(map)
      d.dot = L.circleMarker(d.latlng, {
        radius: 9, color: '#fff', weight: 3, fillColor: ROUTE_COLOR, fillOpacity: 1,
      }).addTo(map)
      tempLayers.current.push(d.line, d.dot)
    }

    const cleanup = (d) => {
      if (d?.timer) clearTimeout(d.timer)
      if (d?.line) { map.removeLayer(d.line); tempLayers.current = tempLayers.current.filter(l => l !== d.line) }
      if (d?.dot) { map.removeLayer(d.dot); tempLayers.current = tempLayers.current.filter(l => l !== d.dot) }
      visRef.current?.setStyle({ opacity: ROUTE_OPACITY })
      map.dragging.enable()
      setArmed(false)
    }

    const onMove = (ev) => {
      const d = drag.current
      if (!d) return
      const ll = pointFrom(ev)
      if (!ll) return
      const px = map.latLngToContainerPoint(ll)

      if (!d.armed) {
        // Moved before the hold completed, so it was a pan all along. Let the
        // map have it: no bend, no captured gesture, nothing to undo.
        if (px.distanceTo(d.startPx) > HOLD_SLOP_PX) {
          clearTimeout(d.timer)
          drag.current = null
        }
        return
      }
      ev.preventDefault()
      d.latlng = ll
      d.line.setLatLngs(withBend(d.seg, ll))
      d.dot.setLatLng(ll)
    }

    const onUp = () => {
      const d = drag.current
      if (!d) return
      drag.current = null
      const wasArmed = d.armed
      const { lat, lng } = d.latlng
      const seg = d.seg
      cleanup(d)
      // Only a completed hold does anything. A finger that touched the line and
      // came straight off was a tap, and a tap on this line means nothing.
      if (wasArmed) onInsert({ lat, lon: lng, seg })
    }

    const onDown = (ev) => {
      // One finger fires both pointerdown and touchstart. Without this the
      // second call overwrites drag.current and the first gesture's temporary
      // layers lose their only reference and stay on the map for good.
      if (drag.current) return
      const ll = pointFrom(ev)
      if (!ll) return
      const d = {
        seg: segmentAt(ll.lat, ll.lng),
        latlng: ll,
        startPx: map.latLngToContainerPoint(ll),
        armed: false,
        timer: null,
      }
      // NOT stopPropagation and NOT preventDefault yet: until the hold
      // completes this is still the map's gesture, and taking it here is what
      // made the line impossible to pan across.
      d.timer = setTimeout(() => { if (drag.current === d) arm(d) }, HOLD_MS)
      drag.current = d
    }

    path.style.touchAction = 'none'
    path.style.cursor = 'grab'
    path.addEventListener('pointerdown', onDown)
    if (!window.PointerEvent) path.addEventListener('touchstart', onDown, { passive: false })
    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    window.addEventListener('touchmove', onMove, { passive: false })
    window.addEventListener('touchend', onUp)

    return () => {
      path.removeEventListener('pointerdown', onDown)
      path.removeEventListener('touchstart', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onUp)
      if (drag.current) { cleanup(drag.current); drag.current = null }
      // Sweep everything this editor ever put on the map, not only the current
      // drag's pair, so an interrupted gesture cannot leave a stray line.
      for (const layer of tempLayers.current) {
        if (map.hasLayer(layer)) map.removeLayer(layer)
      }
      tempLayers.current = []
    }
  }, [map, key, onInsert])

  const ends = useMemo(() => [
    [positions[0], depIdent],
    [positions[positions.length - 1], destIdent],
  ], [positions, depIdent, destIdent])

  if (positions.length < 2) return null

  return (<>
    {/* A fingertip is 36px and a course line is 4. Invisible, so what the pilot
        aims at is the line they can see and what they hit is the line they can
        reach. */}
    <Polyline
      ref={hitRef}
      positions={positions}
      pathOptions={{ color: 'transparent', weight: 36, opacity: 0 }}
    />
    <Polyline
      ref={visRef}
      positions={positions}
      pathOptions={{
        color: ROUTE_COLOR, opacity: ROUTE_OPACITY,
        // Thickens the moment the line gives, so on a phone with no haptics
        // there is still something that says "you have hold of it".
        weight: armed ? ROUTE_WEIGHT + 2 : ROUTE_WEIGHT,
        lineCap: 'round', lineJoin: 'round',
      }} />

    {/* Turning points, small: they are structure, not destinations. Tappable,
        which is the only way to take one out again. */}
    {positions.slice(1, -1).map((p, i) => (
      <CircleMarker key={`wpt-${i}-${p[0]}-${p[1]}`} center={p} radius={5}
        pathOptions={{ color: '#fff', weight: 1.5, fillColor: ROUTE_COLOR, fillOpacity: 1 }}
        eventHandlers={{
          click: (e) => { L.DomEvent.stopPropagation(e); setPicked({ i, lat: p[0], lon: p[1] }) },
        }} />
    ))}

    {ends.map(([p, ident]) => (
      <CircleMarker key={`end-${ident}`} center={p} radius={6}
        pathOptions={{ color: '#fff', weight: 2.5, fillColor: ROUTE_COLOR, fillOpacity: 1 }}>
        <Tooltip permanent direction="top" offset={[0, -10]} className="home-base-label">
          {ident}
        </Tooltip>
      </CircleMarker>
    ))}

    {/* Tapped a turning point. Its name and the way out, which is ForeFlight's
        answer too: the map offers the choice rather than acting on a press the
        pilot cannot take back.

        Panned into view, unlike the hold-anywhere popup this borrows from. A
        turning point near the edge of the screen put Remove half off it, and
        the whole popup exists to offer that one button. */}
    {picked && (
      <Popup position={[picked.lat, picked.lon]} offset={[0, -6]} closeButton={false}
        autoPan autoPanPadding={[24, 24]}
        eventHandlers={{ remove: () => setPicked(null) }}>
        <div style={{ textAlign: 'center', minWidth: 132, userSelect: 'none', WebkitUserSelect: 'none' }}>
          <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 13, letterSpacing: '0.3px' }}>
            {middleNames[picked.i] || 'Waypoint'}
          </div>
          <button
            onClick={() => { const i = picked.i; setPicked(null); onRemove?.(i) }}
            style={{
              marginTop: 8, width: '100%', padding: '7px 0', borderRadius: 8,
              border: 'none', cursor: 'pointer', fontFamily: 'inherit',
              background: 'var(--danger)', color: '#fff', fontSize: 12, fontWeight: 700,
            }}>
            Remove
          </button>
        </div>
      </Popup>
    )}
  </>)
}
