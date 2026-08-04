import { useCallback, useEffect, useRef, useState } from 'react'

// Continuous GPS watch — the low-level primitive behind both
// HomeLocationProvider (src/context/HomeLocation.jsx, shared by Home's map
// preview and the full Map screen) and AirportDiagram.jsx's own independent
// "you are here" marker, which deliberately runs its own separate instance
// of this hook only while its fullscreen view is open, rather than sharing
// the Home-level watch. Each caller gets its own watchPosition — don't call
// this from two places that might be mounted at the same time, since two
// concurrent high-accuracy geolocation requests were the root of a real bug
// (they contend with each other on real devices and can make both slow or
// fail). Exposes the full coords object (altitude, heading, speed,
// accuracy) plus a smoothed rate of turn and vertical speed derived from
// consecutive readings.
// Deliberately NO automatic teardown-and-recreate cycle.
//
// An earlier version restarted the whole acquisition sequence every ten
// seconds forever whenever it had no fix. That was wrong twice over.
// watchPosition already keeps trying on its own and fires success the moment
// a fix arrives, so recreating it does not help — it discards whatever
// progress the chip had made. And every open tab ran its own copy, so a few
// tabs left open meant the OS location service was being started and stopped
// several times a second, indefinitely. On macOS that wedges CoreLocation for
// the entire browser process: every site, including unrelated ones, starts
// getting POSITION_UNAVAILABLE instantly. Which is exactly what happened.
//
// So: one watch, left alone to do its job. It is recreated only on a real
// signal — the pilot asking, or the tab coming back to the foreground.

export function useLiveLocation() {
  const [coords, setCoords] = useState(null) // { lat, lon, altFt, accuracyM, headingDeg, speedKt, timestamp }
  const [derived, setDerived] = useState({ rotDegSec: null, vsFpm: null })
  const [status, setStatus] = useState('pending')
  const [error, setError] = useState(null)
  const prev = useRef(null)
  // Bumping this tears the watch down and starts the sequence again. Driven
  // only by a deliberate retry or by the tab regaining focus — never by a
  // timer.
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!navigator.geolocation) {
      setStatus('unsupported')
      setError('Location is not available on this device.')
      return
    }

    // Tracks whether we've ever gotten a real fix, and whether we've already
    // dropped down to relaxed accuracy — both survive across watchPosition
    // restarts below, so a restart doesn't just retry the same request.
    let watchId
    let everGotFix = false
    let relaxed = false

    function handleSuccess(result) {
      everGotFix = true
      setStatus('success')
      setError(null)
      const c = result.coords
      const next = {
        lat: c.latitude,
        lon: c.longitude,
        altFt: c.altitude != null ? c.altitude * 3.28084 : null,
        accuracyM: c.accuracy ?? null,
        headingDeg: c.heading ?? null,
        speedKt: c.speed != null ? c.speed * 1.94384 : null,
        timestamp: result.timestamp,
      }
      const p = prev.current
      if (p && next.timestamp > p.timestamp) {
        const dtSec = (next.timestamp - p.timestamp) / 1000
        let rot = null
        if (dtSec >= 0.5 && next.headingDeg != null && p.headingDeg != null) {
          let dh = next.headingDeg - p.headingDeg
          if (dh > 180) dh -= 360
          if (dh < -180) dh += 360
          rot = dh / dtSec
        }
        let vs = null
        if (dtSec >= 0.5 && next.altFt != null && p.altFt != null) {
          vs = ((next.altFt - p.altFt) / dtSec) * 60
        }
        setDerived(d => ({
          rotDegSec: rot != null ? rot : d.rotDegSec,
          vsFpm: vs != null ? vs : d.vsFpm,
        }))
      }
      prev.current = next
      setCoords(next)
    }

    function handleError(err) {
      setStatus('error')
      setError(`Location error (code ${err.code}): ${err.message || 'unknown'}`)
      // A raw high-accuracy GPS fix can be slow or unavailable (weak sky
      // view, chip still warming up) — same story as useCurrentLocation's
      // one-shot retry. watchPosition itself just keeps hammering the same
      // failing request forever with no fallback, so if we've never gotten
      // a fix yet, drop down once to relaxed accuracy (network/cell
      // location, longer window, willing to accept a cached fix) by tearing
      // down this watch and starting a new one — PERMISSION_DENIED is the
      // one code that's genuinely terminal and not worth retrying at all.
      if (err.code === err.PERMISSION_DENIED) return   // genuinely terminal

      if (!everGotFix && !relaxed) {
        relaxed = true
        navigator.geolocation.clearWatch(watchId)
        watchId = navigator.geolocation.watchPosition(handleSuccess, handleError, {
          enableHighAccuracy: false, maximumAge: 30000, timeout: 20000,
        })
        return
      }

      // Both attempts have failed. The relaxed watch stays open and running —
      // it will still deliver a fix the moment one becomes available, which is
      // the walk-outside case — so there is nothing useful left to do here.
      // Restarting it on a timer would only reset the chip's progress and
      // thrash the OS.
    }

    // A hidden tab must not hold a location session open. Several backgrounded
    // copies of this app contending for the same GPS is the documented cause
    // of both failing (see this hook's own header) — and with nothing on
    // screen reading the position, it buys nothing. onVisible above starts it
    // the moment the tab is looked at.
    if (document.visibilityState !== 'hidden') {
      watchId = navigator.geolocation.watchPosition(handleSuccess, handleError, {
        enableHighAccuracy: true, maximumAge: 1000, timeout: 15000,
      })
    }
    // Registered before any early return below, deliberately. A tab that opens
    // in the background must still start watching the moment it is looked at;
    // an earlier draft returned first and left such a tab permanently
    // location-less.
    function onVisible() {
      if (document.visibilityState === 'visible' && !everGotFix) setAttempt(a => a + 1)
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      if (watchId != null) navigator.geolocation.clearWatch(watchId)
    }
  }, [attempt])

  // Offered so the UI can put a retry in front of the pilot rather than making
  // them relaunch the app — and now the only thing besides refocusing that
  // starts a fresh attempt at all.
  const retry = useCallback(() => setAttempt(a => a + 1), [])

  return { coords, derived, status, error, retry }
}
