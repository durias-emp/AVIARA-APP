import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BackButton } from '../../components/Shell'
import { IconChevronRight } from '../../components/Icons'
import { useLogbook } from '../../context/Logbook'
import { useActiveAircraft } from '../../context/ActiveAircraft'
import FlightDebriefSheet from '../../components/FlightDebriefSheet'
import { analyseFlight } from '../../lib/flightAnalysis'
import { formatClock, recordingKind } from '../../lib/flightTime'

const fmtDate = iso => (iso
  ? new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  : 'No date')

// Every flight there is a track for, in one place.
//
// The debrief used to be reachable only from inside the logbook — a button on
// a recorded row, an icon on a logged one — which meant you had to already be
// in the logbook and know to look. A recorded flight is worth reviewing on its
// own terms, so it gets its own door.
//
// Flights without a track are simply absent rather than listed and disabled: a
// hand-typed entry has nothing to debrief, and a list of things you cannot open
// is worse than a shorter list.
export default function FlightDebriefs() {
  const navigate = useNavigate()
  const { entries } = useLogbook()
  const { aircraftList } = useActiveAircraft()
  const [open, setOpen] = useState(null)

  const aircraftById = Object.fromEntries((aircraftList ?? []).map(a => [a.id, a.registration || a.id]))

  // Analysed once here rather than per row, so the list can show air time and
  // distance without each row re-deriving a whole flight as it scrolls.
  const flights = useMemo(() => (entries ?? [])
    .filter(e => (e.track?.length ?? 0) >= 2)
    .map(e => ({ entry: e, analysis: analyseFlight(e) }))
    .filter(f => f.analysis)
    .sort((a, b) => (b.entry.startedAt ?? 0) - (a.entry.startedAt ?? 0)), [entries])

  return (
    <div style={{ paddingBottom: 40 }}>
      {open && <FlightDebriefSheet entry={open} onClose={() => setOpen(null)} />}

      <div style={{ padding: '20px 20px 0', display: 'flex', alignItems: 'center', gap: 12 }}>
        <BackButton onBack={() => navigate(-1)} />
        <h2 style={{
          fontSize: 28, fontWeight: 700, letterSpacing: '-0.4px', color: 'var(--text)',
          fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
        }}>Debriefs</h2>
      </div>

      <div style={{ padding: '16px 18px 0' }}>
        {entries === undefined ? null : flights.length === 0 ? (
          <div style={{
            background: 'var(--bg-card)', borderRadius: 16, boxShadow: 'var(--shadow-sm)',
            padding: '24px 16px', textAlign: 'center', fontSize: 13, color: 'var(--text-tertiary)', lineHeight: 1.5,
          }}>
            Nothing to debrief yet. A flight appears here once it has been
            recorded — by auto-detect, or by the timer on the map.
          </div>
        ) : (
          <div style={{ background: 'var(--bg-card)', borderRadius: 16, boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
            {flights.map(({ entry, analysis }, i) => (
              <div
                key={entry.id}
                onClick={() => setOpen(entry)}
                role="button"
                tabIndex={0}
                aria-label={`Debrief flight on ${fmtDate(entry.date)}`}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(entry) } }}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                  padding: '13px 16px', borderTop: i === 0 ? 'none' : '0.5px solid var(--border)',
                  cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
                }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{fmtDate(entry.date)}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                    {recordingKind(entry).label}
                    {aircraftById[entry.aircraftId] ? ` · ${aircraftById[entry.aircraftId]}` : ''}
                    {entry.pendingReview ? ' · not yet logged' : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
                      {analysis.airTimeMs != null ? formatClock(analysis.airTimeMs) : '—'}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-tertiary)', fontVariantNumeric: 'tabular-nums' }}>
                      {analysis.distanceNm.toFixed(1)} NM
                    </div>
                  </div>
                  <span style={{ color: 'var(--text-tertiary)', display: 'flex' }}><IconChevronRight size={14} /></span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
