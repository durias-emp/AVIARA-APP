import { useCallback, useEffect, useRef, useState } from 'react'
import { get, put, del } from '../lib/db'
import { isUsableFix, shouldKeepFix, fixFrom } from '../lib/track'

const STORE = 'settings'
const KEY = 'breadcrumbTrail'

// A long cross-country at one point per few seconds would otherwise grow
// without limit. At this cap a trail is still smooth on screen and small
// enough to write to IndexedDB repeatedly.
const MAX_POINTS = 4000
// Writing every fix would hammer storage for no benefit; the trail only has
// to survive an unmount, not a power cut.
const PERSIST_EVERY_MS = 15000

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
    if (!enabled || !isUsableFix(coords)) return

    const point = fixFrom(coords)
    const points = pointsRef.current
    if (!shouldKeepFix(points[points.length - 1], point)) return

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
