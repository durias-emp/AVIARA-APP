import { haversineNm, trackDistanceNm } from './track'

// Turning a recorded track into something worth debriefing.
//
// Scoped honestly to what a phone in a cockpit can actually know. CloudAhoy
// segments and *scores* manoeuvres — chandelles, steep turns, stabilised
// approaches — but it does that on avionics-grade data at several samples a
// second. This has GPS position at best every few seconds, no attitude, no
// airspeed, no engine. So it answers the questions that data honestly
// supports: when did it leave the ground, when did it come back, how high, how
// fast, how far, and what was the shape of the climb, cruise and descent.
//
// Anything claiming more than that from these inputs would be invented, and an
// invented debrief is worse than none — a pilot might believe it.

export const PHASES = {
  ground:  { label: 'Ground',  color: '#8b93a5' },
  takeoff: { label: 'Takeoff', color: '#34c759' },
  climb:   { label: 'Climb',   color: '#0a84ff' },
  cruise:  { label: 'Cruise',  color: '#ff6b35' },
  descent: { label: 'Descent', color: '#af52de' },
  landing: { label: 'Landing', color: '#ff9500' },
}

// Ground is decided on groundspeed rather than altitude: GPS altitude is the
// least trustworthy thing a phone reports, routinely tens of metres out and
// worse under a cabin roof. Speed is comparatively solid.
const GROUND_SPEED_KT = 25
// A climb or descent has to be sustained to count. Light chop moves a phone's
// reported altitude hundreds of feet a minute with the aircraft level.
const VS_THRESHOLD_FPM = 250

function vsFpmBetween(a, b) {
  if (a?.altFt == null || b?.altFt == null) return null
  const dtMin = (b.t - a.t) / 60000
  if (dtMin <= 0) return null
  return (b.altFt - a.altFt) / dtMin
}

// Groundspeed, preferring what the GPS reported and falling back to distance
// over time. The reported value is a Doppler solution and much better than
// differencing two noisy positions, but it is not always present.
function speedKtAt(track, i) {
  const p = track[i]
  if (p?.speedKt != null) return p.speedKt
  const prev = track[i - 1]
  if (!prev) return null
  const hours = (p.t - prev.t) / 3_600_000
  if (hours <= 0) return null
  return haversineNm(prev, p) / hours
}

// Smooths a series with a centred moving average. Phase changes should come
// from the aeroplane, not from one noisy sample, and a raw vertical-speed
// series from phone GPS flips sign constantly in level flight.
function smooth(values, window = 5) {
  const half = Math.floor(window / 2)
  return values.map((_, i) => {
    let sum = 0, n = 0
    for (let j = Math.max(0, i - half); j <= Math.min(values.length - 1, i + half); j++) {
      if (values[j] == null) continue
      sum += values[j]; n++
    }
    return n ? sum / n : null
  })
}

// Labels every fix with a phase of flight.
export function classifyPhases(track) {
  if (!track || track.length < 2) return []
  const speeds = smooth(track.map((_, i) => speedKtAt(track, i)), 3)
  const vs = smooth(track.map((p, i) => (i ? vsFpmBetween(track[i - 1], p) : null)), 5)

  const phases = track.map((_, i) => {
    const s = speeds[i]
    const v = vs[i]
    if (s == null) return 'ground'
    if (s < GROUND_SPEED_KT) return 'ground'
    if (v != null && v > VS_THRESHOLD_FPM) return 'climb'
    if (v != null && v < -VS_THRESHOLD_FPM) return 'descent'
    return 'cruise'
  })

  // The first airborne fix after ground is the takeoff, the first ground fix
  // after being airborne is the landing. Naming those two specifically is what
  // lets a debrief answer "wheels up at" without pretending to detect a
  // rotation it cannot see.
  //
  // Read from an unmutated copy. Comparing against `phases[i-1]` while writing
  // into `phases` makes the label cascade: once a fix is marked 'landing' it is
  // no longer 'ground', so the next ground fix looks like another landing, and
  // the whole taxi-in comes back labelled as touchdown.
  const base = [...phases]
  for (let i = 1; i < base.length; i++) {
    if (base[i - 1] === 'ground' && base[i] !== 'ground') phases[i] = 'takeoff'
    if (base[i - 1] !== 'ground' && base[i] === 'ground') phases[i] = 'landing'
  }
  return phases
}

// Collapses per-fix phases into contiguous runs, which is what a timeline draws
// and what "3 minutes of climb" is counted from.
export function phaseSegments(track, phases) {
  const raw = []
  let start = 0
  for (let i = 1; i <= phases.length; i++) {
    if (i === phases.length || phases[i] !== phases[start]) {
      raw.push({
        phase: phases[start],
        from: start,
        to: i - 1,
        startedAt: track[start].t,
        endedAt: track[i - 1].t,
        durationMs: track[i - 1].t - track[start].t,
      })
      start = i
    }
  }

  // A single fix that disagrees with its neighbours is smoothing residue at a
  // boundary, not a phase of flight. Left in, a timeline grows hairline slivers
  // — a "cruise" of zero seconds between the descent and the landing — which
  // read as real events. Absorb them into whatever came before.
  const merged = []
  for (const seg of raw) {
    const prev = merged[merged.length - 1]
    const trivial = seg.to === seg.from && prev && seg.phase !== 'takeoff' && seg.phase !== 'landing'
    if (trivial) {
      prev.to = seg.to
      prev.endedAt = seg.endedAt
      prev.durationMs = prev.endedAt - prev.startedAt
      continue
    }
    merged.push(seg)
  }
  return merged
}

// Everything a debrief header states, derived once.
//
// Wheels-up and wheels-down are the first and last airborne fixes, so they are
// the times the recorder can actually stand behind. Air time is the gap between
// them, which is NOT the same as the entry's logged time when that came from
// the manual timer — the timer includes taxi. Both are reported rather than
// reconciled, because they measure different things.
export function analyseFlight(entry) {
  const track = (entry?.track ?? []).filter(p => p && p.lat != null && p.lon != null)
  if (track.length < 2) return null

  const phases = classifyPhases(track)
  const segments = phaseSegments(track, phases)
  const airborne = track.filter((_, i) => phases[i] !== 'ground')

  const alts = track.map(p => p.altFt).filter(v => v != null)
  const speeds = track.map((_, i) => speedKtAt(track, i)).filter(v => v != null)
  const climbRates = track.map((p, i) => (i ? vsFpmBetween(track[i - 1], p) : null)).filter(v => v != null)

  const wheelsUp = airborne[0]?.t ?? null
  const wheelsDown = airborne[airborne.length - 1]?.t ?? null

  return {
    track,
    phases,
    segments,
    wheelsUp,
    wheelsDown,
    airTimeMs: wheelsUp != null && wheelsDown != null ? wheelsDown - wheelsUp : null,
    recordedMs: track[track.length - 1].t - track[0].t,
    distanceNm: trackDistanceNm(track),
    maxAltFt: alts.length ? Math.max(...alts) : null,
    maxSpeedKt: speeds.length ? Math.max(...speeds) : null,
    maxClimbFpm: climbRates.length ? Math.max(...climbRates) : null,
    maxDescentFpm: climbRates.length ? Math.min(...climbRates) : null,
    // Straight-line start to finish. A big gap between this and distance flown
    // is the signature of a local flight — circuits, training, sightseeing —
    // rather than a cross-country.
    directNm: haversineNm(track[0], track[track.length - 1]),
    // What the altitude series is worth. GPS altitude is the weakest number
    // here and a debrief should say so rather than presenting it as surveyed.
    altitudeConfidence: alts.length < track.length * 0.6 ? 'partial' : 'gps',
  }
}

// GPX, because it is the interchange format every debrief tool reads —
// CloudAhoy included. A pilot who wants CloudAhoy's analysis can have it
// without this app pretending to do the analysis itself.
export function toGpx(entry, { name = 'AVIARA flight' } = {}) {
  const track = (entry?.track ?? []).filter(p => p && p.lat != null && p.lon != null)
  if (track.length < 2) return null
  const pts = track.map(p => {
    const ele = p.altFt != null ? `<ele>${(p.altFt / 3.28084).toFixed(1)}</ele>` : ''
    return `<trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}">${ele}<time>${new Date(p.t).toISOString()}</time></trkpt>`
  }).join('\n      ')
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="AVIARA" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${name}</name>
    <trkseg>
      ${pts}
    </trkseg>
  </trk>
</gpx>`
}
