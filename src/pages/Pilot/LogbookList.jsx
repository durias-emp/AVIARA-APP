import { Link, useNavigate } from 'react-router-dom'
import { BackButton } from '../../components/Shell'
import { IconChevronRight } from '../../components/Icons'
import { useLogbook } from '../../context/Logbook'
import { useActiveAircraft } from '../../context/ActiveAircraft'
import { computeTotalHours } from '../../lib/logbookFields'

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
function EntryRow({ entry, aircraftLabel, first }) {
  const route = [entry.from, entry.to].filter(Boolean).join(' → ')
  const isSimOnly = !entry.totalTime && entry.simulatedFlight
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
          <span style={{ color: 'var(--text-tertiary)', display: 'flex' }}><IconChevronRight size={14} /></span>
        </div>
      </div>
    </Link>
  )
}

// Reached from Pilot.jsx's Logbook card — a second-level screen (BackButton
// + navigate(-1), same pattern as Profile Setup).
export default function LogbookList() {
  const navigate = useNavigate()
  const { entries } = useLogbook()
  const { aircraftList } = useActiveAircraft()

  const totalHours = computeTotalHours(entries)
  // Tracked separately from Total Hours — simulator time isn't flight time
  // (same reasoning as EntryRow above), but it's still real time worth
  // seeing a running total of, since it counts toward other things (e.g.
  // instrument currency) even though it never counts toward Total Hours.
  const simHours = (entries ?? []).reduce((sum, e) => sum + (parseFloat(e.simulatedFlight) || 0), 0)
  const aircraftById = Object.fromEntries((aircraftList ?? []).map(a => [a.id, a.registration || a.id]))

  return (
    <div style={{ paddingBottom: 40 }}>
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
            <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)' }}>{(entries ?? []).length}</div>
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

        {entries === undefined ? null : entries.length === 0 ? (
          <div style={{
            background: 'var(--bg-card)', borderRadius: 16, boxShadow: 'var(--shadow-sm)',
            padding: '24px 16px', textAlign: 'center', fontSize: 13, color: 'var(--text-tertiary)',
          }}>
            No flights logged yet
          </div>
        ) : (
          <div style={{ background: 'var(--bg-card)', borderRadius: 16, boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
            {entries.map((e, i) => (
              <EntryRow key={e.id} entry={e} aircraftLabel={aircraftById[e.aircraftId]} first={i === 0} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
