// The two ways a pilot needs to see the same duration, and the one place that
// converts between them.
//
// A timer is read as hours:minutes:seconds and a logbook is kept in decimal
// hours. Deriving both from one function means they can never drift apart, and
// spares anyone doing that arithmetic on the ramp.

export function formatClock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// Logbooks are kept in tenths, rounded rather than truncated: 0.05 h is three
// minutes, so a six-minute hop logs as 0.1 instead of disappearing.
export function decimalHours(ms) {
  return Math.max(0, Math.round((ms / 3_600_000) * 10) / 10)
}

// A recorded entry knows its duration one of two ways. The timer stores it
// outright; a detected flight only has its endpoints, because that is what the
// detector had. Fall back to the logged decimal last, which is lossy — it has
// already been rounded to a tenth — but is better than showing nothing.
export function entryDurationMs(entry) {
  if (entry?.durationMs != null) return entry.durationMs
  if (entry?.startedAt != null && entry?.endedAt != null) return entry.endedAt - entry.startedAt
  const hours = parseFloat(entry?.totalTime)
  return Number.isFinite(hours) ? hours * 3_600_000 : 0
}

// What a recorded flight actually measured, which is not the same question as
// where it came from.
//
// The detector can only see the aircraft moving, so it measures AIR time. The
// manual timer is started and stopped by the pilot, so it can cover flight
// time proper — from moving under its own power for the purpose of flight
// until coming to rest. Labelling both "recorded" and leaving it there would
// put two different quantities in one column, which is how logbooks stop being
// trustworthy.
export const RECORDING_KINDS = {
  auto:  { label: 'Air time',    detail: 'Detected from movement' },
  timer: { label: 'Flight time', detail: 'Timed by you' },
}
export function recordingKind(entry) {
  return RECORDING_KINDS[entry?.source] ?? { label: 'Recorded', detail: 'Source unknown' }
}

// A flight the pilot has not yet accepted. Both the detector and the timer
// land entries this way rather than committing them.
export function isPending(entry) {
  return entry?.pendingReview === true
}
