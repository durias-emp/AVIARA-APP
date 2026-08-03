// Recording a flight as it happens: the track, the clock, the distance.
//
// This is the piece the planner never had. The app could always answer "can I
// make this flight"; nothing answered "what did I actually fly". A recorded
// flight is what the feed is built from, so this is the bottom of that stack.
//
// Deliberately not a React hook and not a component: a recording has to
// survive a re-render, a navigation, and the pilot putting the phone down.

const MS_PER_H = 3_600_000
const R_NM = 3440.065          // earth radius in nautical miles

export function haversineNm(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(a)))
}

// A fix is kept only if it is both accurate enough to mean something and far
// enough from the last one to be movement rather than noise. A phone sitting
// on the glareshield reports jitter of tens of metres; summing that over an
// hour invents distance the aircraft never flew, and an invented distance in a
// logbook is worse than no logbook.
const MAX_ACCURACY_M = 100
const MIN_STEP_NM = 0.02       // about 37 m
// Faster than any light aircraft between two fixes means the GPS jumped
// (tunnel, cold fix, tower handoff). Drop it rather than draw a straight line
// across three counties.
const MAX_GS_KT = 700

export function createRecorder({ onUpdate }) {
  let watchId = null
  let state = null

  const snapshot = () => ({
    ...state,
    // Wall-clock elapsed, not the sum of fix intervals: the pilot's block time
    // runs even where the GPS does not.
    elapsedMs: state ? Date.now() - state.startedAt - state.pausedMs : 0,
  })

  const emit = () => { if (onUpdate && state) onUpdate(snapshot()) }

  function onFix(pos) {
    if (!state || state.paused) return
    const { latitude: lat, longitude: lon, accuracy, altitude, speed } = pos.coords
    if (accuracy != null && accuracy > MAX_ACCURACY_M) return

    const t = pos.timestamp ?? Date.now()
    const last = state.track[state.track.length - 1]

    if (last) {
      const stepNm = haversineNm(last.lat, last.lon, lat, lon)
      if (stepNm < MIN_STEP_NM) return
      const hours = (t - last.t) / MS_PER_H
      if (hours > 0 && stepNm / hours > MAX_GS_KT) return
      state.distNm += stepNm
    }

    state.track.push({ lat, lon, t, alt: altitude ?? null })
    // The device's own Doppler speed when it has one: differencing positions
    // is noisier, and this number is read in flight.
    state.gsKt = speed != null && speed >= 0 ? speed * 1.94384 : state.gsKt
    if (altitude != null) {
      state.altFt = altitude * 3.28084
      state.maxAltFt = Math.max(state.maxAltFt ?? 0, state.altFt)
    }
    state.maxGsKt = Math.max(state.maxGsKt ?? 0, state.gsKt ?? 0)
    emit()
  }

  function onError(err) {
    if (!state) return
    // Permission refused is terminal and worth surfacing; a single timeout is
    // not, and a recording that stops itself because one fix was slow would
    // lose the flight.
    state.error = err.code === err.PERMISSION_DENIED
      ? 'Location permission is off, so the track cannot be recorded.'
      : state.error
    emit()
  }

  return {
    start(meta = {}) {
      if (state) return snapshot()
      state = {
        startedAt: Date.now(), pausedMs: 0, paused: false,
        track: [], distNm: 0, gsKt: null, altFt: null,
        maxGsKt: 0, maxAltFt: 0, error: null, meta,
      }
      if (navigator.geolocation) {
        watchId = navigator.geolocation.watchPosition(onFix, onError, {
          enableHighAccuracy: true, maximumAge: 0, timeout: 15000,
        })
      } else {
        state.error = 'This device cannot report its position.'
      }
      emit()
      return snapshot()
    },

    pause() {
      if (!state || state.paused) return
      state.paused = true
      state.pausedAt = Date.now()
      emit()
    },

    resume() {
      if (!state || !state.paused) return
      state.pausedMs += Date.now() - state.pausedAt
      state.paused = false
      state.pausedAt = null
      emit()
    },

    // Returns the finished flight for saving, and clears the recorder. The
    // caller decides whether it is worth keeping: a 30-second taxi is not a
    // flight, and silently saving it would fill the logbook with noise.
    stop() {
      if (!state) return null
      if (watchId != null) navigator.geolocation.clearWatch(watchId)
      watchId = null
      const finished = snapshot()
      state = null
      return finished
    },

    isRecording: () => state != null,
    snapshot: () => (state ? snapshot() : null),
  }
}

// Shape a finished recording into the record the flights store already holds,
// so recorded flights and checklist-completed flights sit in one logbook
// rather than two.
export function toFlightRecord(rec, extra = {}) {
  const hours = rec.elapsedMs / MS_PER_H
  return {
    id: Date.now(),
    savedAt: new Date().toISOString(),
    source: 'recorded',
    dep: extra.dep ?? null,
    dest: extra.dest ?? null,
    distNm: Number(rec.distNm.toFixed(1)),
    flightTimeH: Number(hours.toFixed(2)),
    track: rec.track.map(p => [Number(p.lat.toFixed(5)), Number(p.lon.toFixed(5))]),
    maxGsKt: rec.maxGsKt ? Math.round(rec.maxGsKt) : null,
    maxAltFt: rec.maxAltFt ? Math.round(rec.maxAltFt) : null,
    aircraft: extra.aircraft ?? null,
    registration: extra.registration ?? null,
    category: extra.category ?? null,
  }
}

export const fmtClock = (ms) => {
  if (!ms || ms < 0) ms = 0
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}
