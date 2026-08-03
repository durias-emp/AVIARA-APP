// Polls the traffic proxy and hands the result to the canvas layer.
//
// The snapshot lives in a ref, not in state. The layer redraws every frame
// from dead reckoning, and putting a few hundred aircraft into state would
// re-render the whole tree at 60 Hz to produce a picture the canvas was going
// to draw anyway. Only the handful of values a legend shows go into state.

import { useCallback, useEffect, useRef, useState } from 'react'

const POLL_MS = 5000
// The proxy snaps to the same grid. Matching it here means panning inside one
// cell never refetches, and crossing into the next one does.
const GRID_DEG = 1
const snap = (v) => Math.round(v / GRID_DEG) * GRID_DEG

export default function useLiveTraffic({ enabled, lat, lon }) {
  // { aircraft, fetchedAt, serverNow }. Read by the rAF loop, never rendered.
  const snapshot = useRef({ aircraft: [], fetchedAt: 0, serverNow: 0 })
  const [meta, setMeta] = useState({
    count: 0, fetchedAt: 0, attribution: null, error: null, loading: false,
  })

  const cell = Number.isFinite(lat) && Number.isFinite(lon)
    ? `${snap(lat)},${snap(lon)}`
    : null

  const abort = useRef(null)
  const timer = useRef(null)

  const fetchOnce = useCallback(async (la, lo) => {
    abort.current?.abort()
    const ctrl = new AbortController()
    abort.current = ctrl
    setMeta(m => ({ ...m, loading: true }))
    try {
      const res = await fetch(`/api/traffic?lat=${la}&lon=${lo}`, { signal: ctrl.signal })
      if (!res.ok) throw new Error(`traffic ${res.status}`)
      const data = await res.json()
      snapshot.current = {
        aircraft: data.aircraft ?? [],
        fetchedAt: Date.now(),
        serverNow: data.now ?? Date.now(),
      }
      setMeta({
        count: data.count ?? 0,
        fetchedAt: Date.now(),
        attribution: data.attribution ?? null,
        error: null,
        loading: false,
      })
    } catch (err) {
      if (err.name === 'AbortError') return
      // The previous snapshot is deliberately left in place. A momentary
      // failure should age visibly rather than blank the map, and the legend
      // shows how old the picture is.
      setMeta(m => ({ ...m, error: err.message, loading: false }))
    }
  }, [])

  useEffect(() => {
    if (!enabled || !cell) {
      // Off means off: no timer, no in-flight request, and an empty snapshot
      // so nothing is left painted from last time.
      clearTimeout(timer.current)
      abort.current?.abort()
      snapshot.current = { aircraft: [], fetchedAt: 0, serverNow: 0 }
      return
    }

    const [la, lo] = cell.split(',').map(Number)
    let stopped = false

    const loop = () => {
      if (stopped || document.hidden) return
      fetchOnce(la, lo).finally(() => {
        if (stopped || document.hidden) return
        timer.current = setTimeout(loop, POLL_MS)
      })
    }

    // A backgrounded tab must not poll: the phone is in a pocket and the
    // picture is not being looked at. Coming back resumes immediately rather
    // than after a full interval, because the first thing a pilot does on
    // returning is look at it.
    const onVisibility = () => {
      clearTimeout(timer.current)
      if (!document.hidden && !stopped) loop()
    }
    document.addEventListener('visibilitychange', onVisibility)

    // Deferred so the fetch is not kicked off synchronously with the effect.
    const start = setTimeout(loop, 0)

    return () => {
      stopped = true
      clearTimeout(start)
      clearTimeout(timer.current)
      abort.current?.abort()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [enabled, cell, fetchOnce])

  return { snapshot, meta }
}
