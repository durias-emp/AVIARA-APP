import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BackButton } from '../../components/Shell'
import { IconChevronRight } from '../../components/Icons'
import { SegControl } from '../../components/SegControl'
import { useLogbook } from '../../context/Logbook'
import { useActiveAircraft } from '../../context/ActiveAircraft'
import { computeTotalHours } from '../../lib/logbookFields'
import { formatClock, decimalHours, entryDurationMs, recordingKind, isPending } from '../../lib/flightTime'
import FlightShareSheet from '../../components/FlightShareSheet'

function fmtDate(iso) {
  if (!iso) return 'No date'
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// A flight with no Total Time isn't necessarily a broken entry — a sim-only
// session legitimately has none (simulator time isn't flight time, per
// ForeFlight's own convention: see the "Simulated Flight" field), and
// showing a bare "—" for those made them look like import failures rather
// than what they actually are. Falls back to showing simulator hours
// instead, with a small label so it's clearly not being counted as flight
// time.
function EntryRow({ entry, aircraftLabel, first, onShare }) {
  const route = [entry.from, entry.to].filter(Boolean).join(' → ')
  const isSimOnly = !entry.totalTime && entry.simulatedFlight
  const hasTrack = (entry.track?.length ?? 0) >= 2
  return (
    <Link to={`/logbook/${entry.id}`} style={{ textDecoration: 'none' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '13px 16px', borderTop: first ? 'none' : '0.5px solid var(--border)',
        cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{fmtDate(entry.date)}</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
            {route || 'No route'}{aircraftLabel ? ` · ${aircraftLabel}` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {isSimOnly ? (
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>
              Sim · {entry.simulatedFlight} hr
            </span>
          ) : (
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
              {entry.totalTime ? `${entry.totalTime} hr` : '—'}
            </span>
          )}
          {hasTrack && (
            <button
              onClick={e => { e.preventDefault(); e.stopPropagation(); onShare(entry) }}
              aria-label="Share flight"
              style={{
                width: 28, height: 28, borderRadius: '50%', border: 'none', padding: 0,
                background: 'var(--bg-card-2)', color: 'var(--text)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
              }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M12 15V3M8 7l4-4 4 4" />
              </svg>
            </button>
          )}
          <span style={{ color: 'var(--text-tertiary)', display: 'flex' }}><IconChevronRight size={14} /></span>
        </div>
      </div>
    </Link>
  )
}

/* ── A flight the recorder captured, waiting to be accepted ── */
// Shows the duration twice on purpose. The clock is what the pilot watched go
// by; the decimal is what will land in the logbook, already rounded to the
// tenth it will be logged as — so there is no surprise between agreeing to a
// flight and seeing what it added.
//
// It also says what was measured. A detected flight is air time and a timed
// one can be flight time; presenting them identically would quietly mix two
// different quantities in the same column.
function RecordedRow({ entry, aircraftLabel, first, onAdd, onDiscard, onShare, busy }) {
  const ms = entryDurationMs(entry)
  const kind = recordingKind(entry)
  const hasTrack = (entry.track?.length ?? 0) >= 2

  return (
    <div style={{ padding: '14px 16px', borderTop: first ? 'none' : '0.5px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{fmtDate(entry.date)}</div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
            {kind.label} · {kind.detail}{aircraftLabel ? ` · ${aircraftLabel}` : ''}
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
            {formatClock(ms)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
            {decimalHours(ms).toFixed(1)} h to log
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button
          onClick={() => onAdd(entry)}
          disabled={busy}
          style={{
            flex: 1, padding: '9px', borderRadius: 'var(--r-sm)', border: 'none',
            background: 'var(--accent)', color: 'var(--accent-fg)',
            fontSize: 13, fontWeight: 700, cursor: busy ? 'default' : 'pointer',
            opacity: busy ? 0.6 : 1, WebkitTapHighlightColor: 'transparent',
          }}>Add to Logbook</button>
        {/* Only offered when there is a line to draw. A flight with no track
            — a timer stopped before any fix arrived — has nothing to show, and
            a button that always fails is worse than no button. */}
        {hasTrack && (
          <button
            onClick={() => onShare(entry)}
            disabled={busy}
            aria-label="Share flight"
            style={{
              padding: '9px 14px', borderRadius: 'var(--r-sm)',
              border: '0.5px solid var(--border)', background: 'var(--bg-card-2)',
              color: 'var(--text)', fontSize: 13, fontWeight: 600,
              cursor: busy ? 'default' : 'pointer', WebkitTapHighlightColor: 'transparent',
            }}>Share</button>
        )}
        <button
          onClick={() => onDiscard(entry)}
          disabled={busy}
          style={{
            padding: '9px 14px', borderRadius: 'var(--r-sm)',
            border: '0.5px solid var(--border)', background: 'var(--bg-card-2)',
            color: 'var(--text-secondary)', fontSize: 13, fontWeight: 600,
            cursor: busy ? 'default' : 'pointer', WebkitTapHighlightColor: 'transparent',
          }}>Discard</button>
      </div>
    </div>
  )
}

// Reached from Pilot.jsx's Logbook card — a second-level screen (BackButton
// + navigate(-1), same pattern as Profile Setup).
export default function LogbookList() {
  const navigate = useNavigate()
  const { entries, updateEntry, deleteEntry } = useLogbook()
  const { aircraftList } = useActiveAircraft()
  const [tab, setTab] = useState('Logbook')
  const [busyId, setBusyId] = useState(null)
  const [sharing, setSharing] = useState(null)

  // Recorded flights are kept out of the logbook proper until accepted, which
  // is what makes accepting them mean anything.
  const logged = (entries ?? []).filter(e => !isPending(e))
  const recorded = (entries ?? []).filter(isPending)

  // Accepting is only ever "this is real now" — the times and the aircraft are
  // already on the entry, and the row shows exactly what will be logged.
  // Editing it further is the existing entry form's job, reached by tapping it
  // once it is in the logbook.
  function acceptRecorded(entry) {
    setBusyId(entry.id)
    updateEntry(entry.id, { pendingReview: false })
      .catch(() => {})
      .finally(() => setBusyId(null))
  }
  function discardRecorded(entry) {
    setBusyId(entry.id)
    deleteEntry(entry.id)
      .catch(() => {})
      .finally(() => setBusyId(null))
  }

  const totalHours = computeTotalHours(entries)
  // Tracked separately from Total Hours — simulator time isn't flight time
  // (same reasoning as EntryRow above), but it's still real time worth
  // seeing a running total of, since it counts toward other things (e.g.
  // instrument currency) even though it never counts toward Total Hours.
  const simHours = (entries ?? []).reduce((sum, e) => sum + (parseFloat(e.simulatedFlight) || 0), 0)
  const aircraftById = Object.fromEntries((aircraftList ?? []).map(a => [a.id, a.registration || a.id]))

  return (
    <div style={{ paddingBottom: 40 }}>
      {sharing && <FlightShareSheet entry={sharing} onClose={() => setSharing(null)} />}
      <div style={{ padding: '20px 20px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <BackButton onBack={() => navigate(-1)} />
          <h2 style={{
            fontSize: 28, fontWeight: 700, letterSpacing: '-0.4px', color: 'var(--text)',
            fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
          }}>Logbook</h2>
        </div>
        <Link to="/logbook/fields" aria-label="Configure fields" style={{
          width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
          background: 'var(--bg-card-2)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--text)', WebkitTapHighlightColor: 'transparent',
        }}>
          <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="3.5" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </Link>
      </div>

      <div style={{ padding: '16px 18px 0' }}>
        <div style={{
          display: 'flex', justifyContent: 'space-around', textAlign: 'center',
          background: 'var(--bg-card)', borderRadius: 16, boxShadow: 'var(--shadow-sm)',
          padding: '16px', marginBottom: 16,
        }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)' }}>{totalHours.toFixed(1)}</div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>Total Hours</div>
          </div>
          <div>
            <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)' }}>{logged.length}</div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>Entries</div>
          </div>
          {simHours > 0 && (
            <div>
              <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-secondary)' }}>{simHours.toFixed(1)}</div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>Sim Hours</div>
            </div>
          )}
        </div>

        <Link to="/logbook/new" style={{ textDecoration: 'none' }}>
          <div style={{
            width: '100%', boxSizing: 'border-box', padding: '13px', borderRadius: 'var(--r-sm)',
            background: 'var(--accent)', color: 'var(--accent-fg)',
            fontSize: 15, fontWeight: 700, textAlign: 'center', cursor: 'pointer', marginBottom: 10,
          }}>+ Add Entry</div>
        </Link>
        <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
          <Link to="/logbook/import" style={{ textDecoration: 'none', flex: 1 }}>
            <div style={{
              padding: '11px', borderRadius: 'var(--r-sm)', border: '0.5px solid var(--border)',
              background: 'var(--bg-card-2)', color: 'var(--text)',
              fontSize: 14, fontWeight: 600, textAlign: 'center', cursor: 'pointer',
            }}>Import CSV</div>
          </Link>
          <Link to="/logbook/scan" style={{ textDecoration: 'none', flex: 1 }}>
            <div style={{
              padding: '11px', borderRadius: 'var(--r-sm)', border: '0.5px solid var(--border)',
              background: 'var(--bg-card-2)', color: 'var(--text)',
              fontSize: 14, fontWeight: 600, textAlign: 'center', cursor: 'pointer',
            }}>Scan Logbook</div>
          </Link>
        </div>

        {/* The count is in the label because a recorded flight is waiting on
            the pilot — a tab that gave no sign of having anything behind it
            would leave detected flights sitting unnoticed. */}
        <div style={{ marginBottom: 14 }}>
          <SegControl
            options={['Logbook', recorded.length ? `Recorded (${recorded.length})` : 'Recorded']}
            value={tab === 'Logbook' ? 'Logbook' : (recorded.length ? `Recorded (${recorded.length})` : 'Recorded')}
            onChange={v => setTab(v.startsWith('Recorded') ? 'Recorded' : 'Logbook')}
          />
        </div>

        {tab === 'Logbook' ? (
          entries === undefined ? null : logged.length === 0 ? (
            <div style={{
              background: 'var(--bg-card)', borderRadius: 16, boxShadow: 'var(--shadow-sm)',
              padding: '24px 16px', textAlign: 'center', fontSize: 13, color: 'var(--text-tertiary)',
            }}>
              No flights logged yet
            </div>
          ) : (
            <div style={{ background: 'var(--bg-card)', borderRadius: 16, boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
              {logged.map((e, i) => (
                <EntryRow key={e.id} entry={e} aircraftLabel={aircraftById[e.aircraftId]} first={i === 0} onShare={setSharing} />
              ))}
            </div>
          )
        ) : (
          entries === undefined ? null : recorded.length === 0 ? (
            <div style={{
              background: 'var(--bg-card)', borderRadius: 16, boxShadow: 'var(--shadow-sm)',
              padding: '24px 16px', textAlign: 'center', fontSize: 13, color: 'var(--text-tertiary)',
            }}>
              Nothing recorded yet. Flights land here when auto-detect catches
              one, or when you stop the timer on the map.
            </div>
          ) : (
            <div style={{ background: 'var(--bg-card)', borderRadius: 16, boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
              {recorded.map((e, i) => (
                <RecordedRow
                  key={e.id}
                  entry={e}
                  aircraftLabel={aircraftById[e.aircraftId]}
                  first={i === 0}
                  onAdd={acceptRecorded}
                  onDiscard={discardRecorded}
                  onShare={setSharing}
                  busy={busyId === e.id}
                />
              ))}
            </div>
          )
        )}
      </div>
    </div>
  )
}
