import { useCallback, useEffect, useRef, useState } from 'react'
import { get, put, del } from '../lib/db'

const STORE = 'settings'
const KEY = 'breadcrumbTrail'

// A fix earns its place on the trail only if it is accurate enough to mean
// anything and far enough from the last one to be movement rather than noise.
// A phone on the glareshield jitters by tens of metres; drawn, that jitter is
// a scribble around the parking spot, and summed it would be invented
// distance. Same reasoning the flight recorder will need.
const MAX_ACCURACY_M = 100
const MIN_STEP_NM = 0.02          // ~37 m
// Faster than any light aircraft manages between two fixes means the GPS
// jumped — a cold fix, a tunnel, a tower handoff. Drawing it produces a
// straight line across a county that the aircraft never flew.
const MAX_STEP_KT = 600
// A long cross-country at one point per few seconds would otherwise grow
// without limit. At this cap a trail is still smooth on screen and small
// enough to write to IndexedDB repeatedly.
const MAX_POINTS = 4000
// Writing every fix would hammer storage for no benefit; the trail only has
// to survive an unmount, not a power cut.
const PERSIST_EVERY_MS = 15000

const R_NM = 3440.065
function haversineNm(a, b) {
  const toRad = d => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(h)))
}

// Drops every other point once the cap is reached, keeping the ends. The trail
// loses resolution rather than losing its beginning — where you have been is
// the point of it, and a trail that silently forgets its start is worse than
// one drawn slightly coarser.
function decimate(points) {
  const kept = points.filter((_, i) => i % 2 === 0)
  if (kept[kept.length - 1] !== points[points.length - 1]) kept.push(points[points.length - 1])
  return kept
}

// The breadcrumb trail: every place the aircraft has been since the overlay
// was switched on.
//
// Switching it ON clears whatever was there and starts fresh — that is what
// makes off-then-on the reset gesture. Switching it OFF stops recording but
// does not erase, so a mis-tap does not cost the trail.
//
// The reset is exposed as a function for the toggle to call, NOT inferred from
// `enabled` going false -> true. That inference looks right and is badly
// wrong: the overlay's own state is loaded from IndexedDB after first render,
// so every single app launch looks exactly like the pilot flipping the switch
// on, and the trail is wiped before they ever see it. Only a real toggle
// should reset; a real toggle is the one thing an effect cannot recognise.
//
// Persisted, because the trail's whole value is that it outlives the moment.
// Home unmounts whenever the pilot walks into a route like /profile, and a
// trail that vanished on the way back would be a trail nobody could trust.
export function useBreadcrumbTrail({ enabled, coords }) {
  const [trail, setTrail] = useState([])
  const pointsRef = useRef([])
  const lastPersistRef = useRef(0)

  // Load once, so a trail survives Home unmounting and coming back.
  useEffect(() => {
    let cancelled = false
    get(STORE, KEY).then(row => {
      if (cancelled || !Array.isArray(row?.value)) return
      pointsRef.current = row.value
      setTrail(row.value)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  const reset = useCallback(() => {
    pointsRef.current = []
    lastPersistRef.current = 0
    setTrail([])
    del(STORE, KEY).catch(() => {})
  }, [])

  useEffect(() => {
    if (!enabled || !coords) return
    if (coords.accuracyM != null && coords.accuracyM > MAX_ACCURACY_M) return

    const point = { lat: coords.lat, lon: coords.lon, altFt: coords.altFt ?? null, t: Date.now() }
    const points = pointsRef.current
    const last = points[points.length - 1]

    if (last) {
      const nm = haversineNm(last, point)
      if (nm < MIN_STEP_NM) return
      const hours = (point.t - last.t) / 3_600_000
      if (hours > 0 && nm / hours > MAX_STEP_KT) return
    }

    let next = [...points, point]
    if (next.length > MAX_POINTS) next = decimate(next)
    pointsRef.current = next
    setTrail(next)

    const now = Date.now()
    if (now - lastPersistRef.current > PERSIST_EVERY_MS) {
      lastPersistRef.current = now
      put(STORE, { key: KEY, value: next }).catch(() => {})
    }
  }, [enabled, coords])

  return { trail, reset }
}
