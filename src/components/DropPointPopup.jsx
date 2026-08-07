// Hold a finger anywhere on a chart and find out where that is.
//
// Lifted out of the route planner so the map home can offer the same thing
// from the same code. It was the planner's alone, which meant the app's main
// map, the one a pilot actually sits on, could not answer the simplest
// question you can ask a chart: what are the coordinates of that.
//
// The gesture is the ForeFlight hold, and it is deliberate: a plain tap has to
// stay free for panning and for tapping traffic.
//
// The hold is counted here rather than left to the browser, which is the whole
// reason it works on a phone at all. It used to be Leaflet's `contextmenu`
// event, and on a desktop that is a right click and still is. On iOS it is
// nothing: Leaflet dropped its Tap handler in 1.8, which was the thing that
// used to synthesise a contextmenu from a long press, and the modern browsers
// it deferred to do not fire one for a plain element.
//
// Worse, and this is the part worth remembering, the CSS added to protect this
// very gesture is what guarantees the silence. `-webkit-touch-callout: none`
// and `user-select: none` on the map (src/index.css) exist so a hold does not
// raise the iOS selection loupe and its handles. They do that by taking the
// long press away from the page entirely, event included. So the gesture that
// the rule was written for was the one thing it prevented.
//
// A timer, a slop radius and a single finger is all it takes to do it
// properly, and it behaves the same on every phone rather than the same as
// whatever the browser decided this year.

import { useEffect, useRef, useState } from 'react'
import { CircleMarker, Popup, useMap, useMapEvents } from 'react-leaflet'
import { fmtAvCoord } from '../lib/geo'
import { crossTrackNm } from '../lib/corridor'
import PopupActions from './PopupActions'
import { ACCENT } from './mapStyle'

// waypoints: the current route, if there is one. Used only to work out which
//            leg a new point belongs in. Omit it and `seg` comes back null.
// Either action may be omitted, and the popup still opens: the coordinate
// readout is useful on its own, which is most of why a pilot holds a finger
// on a chart in the first place.
// onSetDestination: ({ ident, lat, lon }) => void
// onAddWaypoint:    ({ ident, lat, lon, seg }) => void
// tapToAdd:  a plain tap places the point too. For a map that was opened to
//            choose somewhere, where the pilot has already said what they want.
// How long a finger has to stay down, and how far it may stray while it does.
// 450ms is a hold rather than a slow tap, and lands just inside the iOS
// callout's own timing. The slop is generous because a finger resting on glass
// is never still, and a hold that cancels because the pilot breathed is worse
// than one that takes a moment.
const HOLD_MS = 450
const HOLD_SLOP_PX = 12

export default function DropPointPopup({ waypoints = [], onSetDestination, onAddWaypoint, tapToAdd = false }) {
  const [pt, setPt] = useState(null)
  const ignoreNextClick = useRef(false)
  const heldAt = useRef(0)
  const map = useMap()

  // The hold, counted by hand. Touch only: a mouse has a right button and
  // keeps using it through the contextmenu handler below.
  useEffect(() => {
    const el = map.getContainer()
    let timer = null
    let start = null

    const cancel = () => { clearTimeout(timer); timer = null; start = null }

    const onStart = (e) => {
      // One finger only. A second means a pinch, and a chart being zoomed is
      // not a chart being asked about.
      if (e.touches.length !== 1) { cancel(); return }
      const t = e.touches[0]
      start = { x: t.clientX, y: t.clientY }
      clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        if (!start) return
        const box = el.getBoundingClientRect()
        const ll = map.containerPointToLatLng([start.x - box.left, start.y - box.top])
        if (!Number.isFinite(ll?.lat) || !Number.isFinite(ll?.lng)) return
        // Lifting the finger that performed the hold fires ONE click, however
        // long it was held, and that click would close what the hold opened.
        ignoreNextClick.current = true
        heldAt.current = Date.now()
        setPt({ lat: ll.lat, lon: ll.lng })
      }, HOLD_MS)
    }

    const onMove = (e) => {
      const t = e.touches[0]
      if (!start || !t) return
      if (Math.hypot(t.clientX - start.x, t.clientY - start.y) > HOLD_SLOP_PX) cancel()
    }

    // Not passive:false anywhere, and no preventDefault: the map still has to
    // be draggable through the same fingers.
    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: true })
    el.addEventListener('touchend', cancel, { passive: true })
    el.addEventListener('touchcancel', cancel, { passive: true })
    return () => {
      cancel()
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', cancel)
      el.removeEventListener('touchcancel', cancel)
    }
  }, [map])

  useMapEvents({
    contextmenu(e) {
      // A right click on a desktop, and on the phones that do fire it, a
      // second opinion about a hold this component has already handled.
      // Ignored if it lands on the heels of one, so the popup does not jump
      // to a slightly different point a moment after opening.
      if (Date.now() - heldAt.current < 1000) return
      ignoreNextClick.current = true
      setPt({ lat: e.latlng.lat, lon: e.latlng.lng })
    },
    click(e) {
      if (ignoreNextClick.current) { ignoreNextClick.current = false; return }
      if (tapToAdd) {
        // Guarded because everything downstream goes into L.latLng, which
        // throws on a NaN and takes the whole card down with it.
        if (Number.isFinite(e.latlng?.lat) && Number.isFinite(e.latlng?.lng)) {
          setPt({ lat: e.latlng.lat, lon: e.latlng.lng })
        }
        return
      }
      setPt(null)
    },
    // No dismissal on drag: the smallest finger movement while still holding
    // registers as a map drag and was closing the popup. It is anchored to the
    // pressed point, so it simply pans with the map.
  })

  if (!pt) return null

  // The nearest leg, worked out once and handed to whichever action was
  // pressed. A destination ignores it; a waypoint needs it.
  function nearestSeg() {
    let seg = null
    if (waypoints.length >= 2) {
      let best = Infinity
      for (let i = 0; i < waypoints.length - 1; i++) {
        const d = crossTrackNm(pt.lat, pt.lon,
          [waypoints[i].lat, waypoints[i].lon], [waypoints[i + 1].lat, waypoints[i + 1].lon])
        if (d < best) { best = d; seg = i + 1 }
      }
    }
    return seg
  }

  // The coordinate itself is the identifier for a destination. calcRoute
  // parses this format back into a position, so a plan ending on open ground
  // still says where that is rather than inventing a name for it. A waypoint
  // is given WPT1, WPT2 by the caller instead, because a route reads better
  // as KRNO, WPT1, KSFO than with a coordinate in the middle of the line.
  const payload = { ident: fmtAvCoord(pt.lat, pt.lon), lat: pt.lat, lon: pt.lon }
  const run = (fn, withSeg) => {
    fn({ ...payload, seg: withSeg ? nearestSeg() : null })
    setPt(null)
  }

  return (<>
    <CircleMarker center={[pt.lat, pt.lon]} radius={7}
      pathOptions={{ color: '#fff', weight: 2.5, fillColor: ACCENT, fillOpacity: 1 }} />
    <Popup position={[pt.lat, pt.lon]} offset={[0, -6]} closeButton={false} autoPan={false}>
      <div style={{
        textAlign: 'center', minWidth: 176,
        // Inline, because it has to beat every stylesheet: the popup opens
        // under a finger that is still held down, and without these iOS turns
        // that press into a text selection of the coordinates, complete with
        // handles, loupe and a Copy bar.
        userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none',
      }}>
        {/* Monospaced and sized to be read once, out loud, off a moving
            screen. Slightly smaller than a field's identifier because a
            coordinate is longer and wraps otherwise. */}
        <div style={{
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontWeight: 700, fontSize: 15, letterSpacing: '0.2px',
          color: 'var(--map-ink)', lineHeight: 1.25,
        }}>
          {fmtAvCoord(pt.lat, pt.lon)}
        </div>
        {/* What it will be called once it is in the plan. A point on open
            ground has no name, so the plan gives it one, and saying so here
            means the name does not appear from nowhere afterwards. */}
        {onAddWaypoint && (
          <div style={{ fontSize: 11, color: 'var(--map-ink-faint)', marginTop: 3 }}>
            Adds as the next WPT
          </div>
        )}
        <PopupActions
          onSetDestination={onSetDestination ? () => run(onSetDestination, false) : undefined}
          onAddWaypoint={onAddWaypoint ? () => run(onAddWaypoint, true) : undefined}
          {...payload} />
      </div>
    </Popup>
  </>)
}
