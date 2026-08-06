// Hold a finger anywhere on a chart and find out where that is.
//
// Lifted out of the route planner so the map home can offer the same thing
// from the same code. It was the planner's alone, which meant the app's main
// map, the one a pilot actually sits on, could not answer the simplest
// question you can ask a chart: what are the coordinates of that.
//
// The gesture is Leaflet's `contextmenu`, which is a long press on touch and a
// right click on a desktop. That is the ForeFlight hold, and it is deliberate:
// a plain tap has to stay free for panning and for tapping traffic.

import { useRef, useState } from 'react'
import { CircleMarker, Popup, useMapEvents } from 'react-leaflet'
import { fmtAvCoord } from '../lib/geo'
import { crossTrackNm } from '../lib/corridor'

// waypoints: the current route, if there is one. Used only to work out which
//            leg a new point belongs in. Omit it and `seg` comes back null.
// canAdd:    whether to offer the button at all. The coordinate readout is
//            useful on its own, so the popup still opens without it.
// onAdd:     ({ lat, lon, seg }) => void
// tapToAdd:  a plain tap places the point too. For a map that was opened to
//            choose somewhere, where the pilot has already said what they want.
export default function DropPointPopup({ waypoints = [], canAdd = true, onAdd, tapToAdd = false, addLabel = '+ Add to route' }) {
  const [pt, setPt] = useState(null)
  const ignoreNextClick = useRef(false)

  useMapEvents({
    contextmenu(e) {
      // Lifting the finger that performed the long press fires ONE click,
      // however long the press was held. A time window cannot cover that, so
      // swallow exactly the first click that follows instead.
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

  function addHere() {
    let seg = null
    if (waypoints.length >= 2) {
      let best = Infinity
      for (let i = 0; i < waypoints.length - 1; i++) {
        const d = crossTrackNm(pt.lat, pt.lon,
          [waypoints[i].lat, waypoints[i].lon], [waypoints[i + 1].lat, waypoints[i + 1].lon])
        if (d < best) { best = d; seg = i + 1 }
      }
    }
    onAdd?.({ lat: pt.lat, lon: pt.lon, seg })
    setPt(null)
  }

  return (<>
    <CircleMarker center={[pt.lat, pt.lon]} radius={7}
      pathOptions={{ color: '#fff', weight: 2.5, fillColor: '#0a84ff', fillOpacity: 1 }} />
    <Popup position={[pt.lat, pt.lon]} offset={[0, -6]} closeButton={false} autoPan={false}>
      <div style={{
        textAlign: 'center', minWidth: 168,
        // Inline, because it has to beat every stylesheet: the popup opens
        // under a finger that is still held down, and without these iOS turns
        // that press into a text selection of the coordinates, complete with
        // handles, loupe and a Copy bar.
        userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none',
      }}>
        <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 13, letterSpacing: '0.3px' }}>
          {fmtAvCoord(pt.lat, pt.lon)}
        </div>
        {canAdd && (
          <button onClick={addHere} style={{
            marginTop: 8, width: '100%', padding: '8px 12px', borderRadius: 8, border: 'none',
            background: '#0a84ff', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer',
          }}>
            {addLabel}
          </button>
        )}
      </div>
    </Popup>
  </>)
}
