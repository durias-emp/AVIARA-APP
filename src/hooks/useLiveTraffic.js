// Polls the traffic proxy and hands the result to the canvas layer.
//
// The snapshot lives in a ref, not in state. The layer redraws every frame
// from dead reckoning, and putting a few hundred aircraft into state would
// re-render the whole tree at 60 Hz to produce a picture the canvas was going
// to draw anyway. Only the handful of values a legend shows go into state.

import { useCallback, useEffect, useRef, useState } from 'react'
import { isLight } from '../components/trafficBands'

const POLL_MS = 5000
// After a failure, try again sooner than the normal beat. A dropped request on
// a phone changing cell tower is the common case and it recovers in seconds;
// waiting a full interval to find that out makes a blip look like an outage.
const RETRY_MS = 2000

// A request that has not answered in this long is not going to. Without it a
// hung fetch never settles, the .finally that schedules the next poll never
// runs, and the layer stops updating for the rest of the session while showing
// a picture that looks current. That is the failure mode this whole file has
// to be built against: a frozen traffic picture is worse than no traffic
// picture, because it looks like the sky is empty.
const REQUEST_TIMEOUT_MS = 12000

// How long a snapshot may go without a successful refresh before it stops
// being drawn at all. The layer dead reckons between polls, so an old snapshot
// does not sit still: it keeps flying aircraft along their last known track,
// minutes after anyone last heard from them. Generous enough that a couple of
// failed polls change nothing, short enough that ghosts never accumulate.
const SNAPSHOT_MAX_AGE_MS = 90000

// The proxy snaps to the same grid. Matching it here means panning inside one
// cell never refetches, and crossing into the next one does.
const GRID_DEG = 1
const snap = (v) => Math.round(v / GRID_DEG) * GRID_DEG

export default function useLiveTraffic({ enabled, lat, lon }) {
  // { aircraft, fetchedAt, serverNow }. Read by the rAF loop, never rendered.
  const snapshot = useRef({ aircraft: [], fetchedAt: 0, serverNow: 0 })
  const [meta, setMeta] = useState({
    count: 0, lightCount: 0, fetchedAt: 0, attribution: null, error: null, loading: false,
  })

  const cell = Number.isFinite(lat) && Number.isFinite(lon)
    ? `${snap(lat)},${snap(lon)}`
    : null

  const abort = useRef(null)
  const timer = useRef(null)

  // Resolves true on a good fetch, false on anything else, so the caller can
  // decide how soon to come back. It never rejects.
  const fetchOnce = useCallback(async (la, lo) => {
    abort.current?.abort()
    const ctrl = new AbortController()
    abort.current = ctrl
    // A plain timer rather than AbortSignal.timeout composed with any(): both
    // are recent additions and this runs on whatever iOS the pilot has. The
    // flag is what tells a timeout apart from being superseded by the next
    // poll, which is not a failure and must not be reported as one.
    let timedOut = false
    const killer = setTimeout(() => { timedOut = true; ctrl.abort() }, REQUEST_TIMEOUT_MS)
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
        // Counted here rather than in the legend so the number survives the
        // snapshot living in a ref.
        lightCount: (data.aircraft ?? []).filter(isLight).length,
        fetchedAt: Date.now(),
        attribution: data.attribution ?? null,
        error: null,
        loading: false,
      })
      return true
    } catch (err) {
      // Superseded, not failed: a newer poll or a teardown aborted this one,
      // and there is nothing to report.
      if (err.name === 'AbortError' && !timedOut) return false

      // The snapshot is left in place for now, so a single dropped request
      // ages visibly rather than blanking the map. The loop below is what
      // eventually throws it away if nothing succeeds, because an old snapshot
      // is not a still picture: the layer keeps flying it.
      setMeta(m => ({
        ...m,
        error: timedOut ? 'timed out' : err.message,
        loading: false,
      }))
      return false
    } finally {
      clearTimeout(killer)
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
    // One request at a time, and the request in flight is the one that owns
    // the beat.
    //
    // Without this, anything that calls loop() while a poll is running aborts
    // that poll to start an identical one. Coming back to the app does exactly
    // that, and if it happens on any kind of rhythm the two take turns killing
    // each other and NOTHING ever completes: the requests all leave, the
    // responses all come back 200, and the legend sits on "no data yet"
    // because every one of them was cancelled a moment before it landed. Seen
    // in the browser, alternating ABORTED and OK down the network log.
    let busy = false

    const loop = () => {
      if (stopped || busy || document.hidden) return
      busy = true
      fetchOnce(la, lo).then((ok) => {
        busy = false
        if (stopped) return
        // Nothing has answered for long enough that the picture cannot be
        // shown any more. Emptying the snapshot is what stops the layer dead
        // reckoning aircraft nobody has heard from, and the legend goes to
        // "no signal" rather than to a plausible-looking count.
        if (!ok && snapshot.current.fetchedAt
            && Date.now() - snapshot.current.fetchedAt > SNAPSHOT_MAX_AGE_MS) {
          snapshot.current = { aircraft: [], fetchedAt: 0, serverNow: 0 }
          setMeta(m => ({ ...m, count: 0, lightCount: 0 }))
        }
        if (document.hidden) return
        // Exactly one timer, always. Returning to the app calls loop() while
        // the previous poll may still be in flight; that poll is aborted and
        // resolves false, and without this it would schedule a second beat
        // alongside the one that replaced it, doubling on every round trip.
        clearTimeout(timer.current)
        timer.current = setTimeout(loop, ok ? POLL_MS : RETRY_MS)
      })
    }

    // A backgrounded tab must not poll: the phone is in a pocket and the
    // picture is not being looked at. Coming back resumes immediately rather
    // than after a full interval, because the first thing a pilot does on
    // returning is look at it.
    // `loop` guards on `busy` itself, so a return while a poll is already
    // running leaves that poll alone rather than restarting it.
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
