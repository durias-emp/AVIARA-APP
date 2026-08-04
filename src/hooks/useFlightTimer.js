import { useCallback, useEffect, useRef, useState } from 'react'
import { get, put, del } from '../lib/db'

const STORE = 'settings'
const KEY = 'manualFlightTimer'

// Formats for the two things a logbook needs from the same number.
//
// Pilots read a timer as hours:minutes:seconds and log it as a decimal, and
// the conversion between them is exactly the sort of arithmetic nobody should
// be doing on the ramp. Both come from one source so they can never disagree.
export function formatClock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// Logbooks are kept in tenths, and the FAA's own guidance is to round to the
// nearest tenth rather than truncate. 0.05 h is three minutes, so a six-minute
// hop logs as 0.1 rather than disappearing.
export function decimalHours(ms) {
  return Math.max(0, Math.round((ms / 3_600_000) * 10) / 10)
}

// The manual flight timer: the pilot's own clock, started and stopped by hand.
//
// It exists because the automatic detector measures AIR time — it can only see
// the aircraft moving — and air time is not flight time. Flight time runs from
// the moment the aircraft moves under its own power for the purpose of flight
// until it comes to rest after landing, which includes the taxi the detector
// cannot see. For a helicopter the gap is worse still: a machine that hovers
// defeats a speed threshold and an altitude threshold at the same time, so for
// those this is not a supplement to detection, it is the only honest source.
//
// The elapsed time is derived from a stored start timestamp rather than
// counted in memory. A counter is wrong the moment anything interrupts it —
// the screen locking, the tab being evicted, the app being closed on a long
// leg — and it fails by under-reporting, which in a logbook is the direction
// that matters. A timestamp survives all of that: whenever the app comes back,
// the elapsed time is simply now minus then.
export function useFlightTimer() {
  const [startedAt, setStartedAt] = useState(null)
  const [now, setNow] = useState(() => Date.now())
  const [loaded, setLoaded] = useState(false)
  const tickRef = useRef(null)

  // A timer already running when the app opens is the whole point: the pilot
  // started it, put the phone down, and flew.
  useEffect(() => {
    let cancelled = false
    get(STORE, KEY).then(row => {
      if (cancelled) return
      if (row?.value?.startedAt) setStartedAt(row.value.startedAt)
      setLoaded(true)
    }).catch(() => { if (!cancelled) setLoaded(true) })
    return () => { cancelled = true }
  }, [])

  // Ticks only while running, and only to redraw — the number itself is
  // computed from the timestamps, so a missed tick costs nothing and the
  // first one need not be immediate. start() seeds the clock for the case
  // that matters; resuming a running timer is at most a second stale.
  useEffect(() => {
    if (!startedAt) { clearInterval(tickRef.current); return }
    tickRef.current = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(tickRef.current)
  }, [startedAt])

  const start = useCallback(() => {
    const at = Date.now()
    setStartedAt(at)
    setNow(at)
    put(STORE, { key: KEY, value: { startedAt: at } }).catch(() => {})
  }, [])

  // Returns the finished flight for the caller to log, and clears itself. It
  // deliberately does not write the logbook entry: what a flight is worth
  // recording as belongs to the screen that knows which aircraft is active.
  const stop = useCallback(() => {
    if (!startedAt) return null
    const endedAt = Date.now()
    const elapsedMs = endedAt - startedAt
    setStartedAt(null)
    del(STORE, KEY).catch(() => {})
    return {
      startedAt,
      endedAt,
      elapsedMs,
      clock: formatClock(elapsedMs),
      hours: decimalHours(elapsedMs),
    }
  }, [startedAt])

  return {
    running: !!startedAt,
    loaded,
    startedAt,
    elapsedMs: startedAt ? Math.max(0, now - startedAt) : 0,
    start,
    stop,
  }
}
