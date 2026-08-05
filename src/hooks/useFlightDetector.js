import { useEffect, useRef, useState } from 'react'

export const DEFAULT_AUTO_DETECT_CONFIG = { mode: 'both', speedKt: 30, altAglFt: 200 }

// On by default. A pilot who never opens Settings should still come back from
// a flight and find it waiting for them — a recorder that has to be switched
// on before it is useful gets discovered after the flight worth recording.
//
// Read through this rather than `!!row?.value`, which cannot tell "never
// answered" from "answered no". Only an explicit stored false turns it off,
// so a pilot who deliberately disabled it stays disabled.
export const AUTO_DETECT_DEFAULT_ENABLED = true
export function autoDetectEnabledFrom(row) {
  return row?.value == null ? AUTO_DETECT_DEFAULT_ENABLED : !!row.value
}

// Consecutive above/below-threshold GPS fixes required before starting or
// ending a detected flight — guards against a single noisy fix (a bad
// multipath reading, a momentary speed spike) triggering a false start/stop.
const SUSTAIN_COUNT = 3
// Track points are buffered at most this often, to keep a whole flight's
// worth of samples reasonably small in storage.
const SAMPLE_INTERVAL_MS = 12000

// Foreground-only flight detection: watches whatever live GPS coords the
// caller feeds it for the pilot-configured speed/altitude thresholds being
// sustained, and buffers a lightweight track while "in flight." This can
// only run while the app is open and on screen — true background tracking
// needs a native wrapper (Capacitor or similar) to get real OS-level
// background location permission, which is a separate, larger future
// project (see Settings.jsx's Flight Detection section for the user-facing
// explanation). This hook is deliberately not attempting that.
//
// Deliberately takes `coords` as a parameter rather than calling
// useLiveLocation() itself: the caller (MapView) already has a live watch
// running via useHomeLocation's shared context, and a second independent
// watchPosition call here would reintroduce the exact GPS-contention bug
// fixed earlier this session (two concurrent high-accuracy requests
// degrading each other on real devices).
//
// AGL is approximated as (current MSL altitude − the MSL altitude recorded
// when this hook first got a fix while enabled), not a real terrain lookup —
// this assumes tracking starts on the ground near the aircraft (the pilot
// has the map open before taxiing), which is the normal case for this
// feature, and avoids needing a live terrain-elevation service on every GPS
// tick just to classify "on the ground" vs "airborne."
export function useFlightDetector({ enabled, config, coords }) {
  const [state, setState] = useState('idle') // 'idle' | 'recording' | 'done'
  const [draft, setDraft] = useState(null)
  const groundAltRef = useRef(null)
  const aboveCountRef = useRef(0)
  const belowCountRef = useRef(0)
  const trackRef = useRef([])
  const startRef = useRef(null)
  const lastSampleRef = useRef(0)

  function reset() {
    setState('idle')
    setDraft(null)
    groundAltRef.current = null
    aboveCountRef.current = 0
    belowCountRef.current = 0
    trackRef.current = []
    startRef.current = null
  }

  useEffect(() => {
    if (!enabled) { reset(); return }
    if (!coords) return

    if (groundAltRef.current == null && coords.altFt != null) {
      groundAltRef.current = coords.altFt
    }

    const aglFt = groundAltRef.current != null && coords.altFt != null
      ? coords.altFt - groundAltRef.current
      : null
    const speedKt = coords.speedKt

    const meetsSpeed = speedKt != null && speedKt >= config.speedKt
    const meetsAlt = aglFt != null && aglFt >= config.altAglFt
    const meetsThreshold =
      config.mode === 'speed' ? meetsSpeed :
      config.mode === 'altitude' ? meetsAlt :
      meetsSpeed && meetsAlt

    const now = coords.timestamp ?? Date.now()

    if (state === 'idle') {
      aboveCountRef.current = meetsThreshold ? aboveCountRef.current + 1 : 0
      if (aboveCountRef.current >= SUSTAIN_COUNT) {
        startRef.current = now
        trackRef.current = [{ lat: coords.lat, lon: coords.lon, altFt: coords.altFt, speedKt, t: now }]
        lastSampleRef.current = now
        belowCountRef.current = 0
        setState('recording')
      }
    } else if (state === 'recording') {
      if (now - lastSampleRef.current >= SAMPLE_INTERVAL_MS) {
        trackRef.current.push({ lat: coords.lat, lon: coords.lon, altFt: coords.altFt, speedKt, t: now })
        lastSampleRef.current = now
      }
      belowCountRef.current = meetsThreshold ? 0 : belowCountRef.current + 1
      if (belowCountRef.current >= SUSTAIN_COUNT) {
        const hours = (now - startRef.current) / 3600000
        setDraft({
          date: new Date(startRef.current).toISOString().slice(0, 10),
          totalTime: hours.toFixed(1),
          track: trackRef.current,
          startedAt: startRef.current,
          endedAt: now,
        })
        setState('done')
      }
    }
  }, [enabled, coords, config.mode, config.speedKt, config.altAglFt, state])

  return { state, draft, reset }
}
