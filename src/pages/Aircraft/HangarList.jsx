import { useRef } from 'react'
import { BackButton } from '../../components/Shell'

const MS_PER_DAY = 24 * 60 * 60 * 1000
const RETENTION_DAYS = 7

function daysLeft(deletedAt) {
  const remaining = RETENTION_DAYS - (Date.now() - deletedAt) / MS_PER_DAY
  return Math.max(0, Math.ceil(remaining))
}

export function HangarEmptyState({ onAdd, onBack, onImport, importError }) {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '20px 18px 0' }}>
        <BackButton onBack={onBack} />
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 32px', gap: 16 }}>
        <div style={{ fontSize: 40 }}>✈️</div>
        <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)', textAlign: 'center' }}>
          No aircraft yet
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', textAlign: 'center', lineHeight: 1.5, maxWidth: 260 }}>
          Add an aircraft to set up its performance numbers and weight &amp; balance.
        </div>
        <button
          onClick={onAdd}
          style={{
            marginTop: 8, display: 'flex', alignItems: 'center', gap: 8,
            padding: '13px 22px', borderRadius: 'var(--r-sm)', border: 'none',
            background: 'var(--accent)', color: 'var(--accent-fg)',
            fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
          }}>
          <span style={{ fontSize: 18, lineHeight: 1 }}>+</span> Add Aircraft
        </button>
        <ImportAircraftControl onImport={onImport} error={importError} />
      </div>
    </div>
  )
}

function AircraftRow({ aircraft, active, onClick }) {
  return (
    <div
      onClick={onClick}
      role="button" tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } }}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        background: 'var(--bg-card)', borderRadius: 16, boxShadow: 'var(--shadow-sm)',
        padding: '12px 14px', cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
      }}>
      <div style={{
        width: 48, height: 48, borderRadius: 12, flexShrink: 0, overflow: 'hidden',
        background: 'var(--bg-card-2)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {aircraft.image
          ? <img src={aircraft.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <span style={{ fontSize: 20 }}>✈️</span>}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {aircraft.fullName || aircraft.label || 'Untitled Aircraft'}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'monospace', marginTop: 1 }}>
          {aircraft.registration || '—'}
        </div>
      </div>
      {active && (
        <span style={{
          fontSize: 10, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase',
          color: 'var(--accent)', background: 'var(--accent-light, rgba(10,132,255,0.12))',
          padding: '4px 8px', borderRadius: 20, flexShrink: 0,
        }}>
          Active
        </span>
      )}
    </div>
  )
}

function DeletedAircraftRow({ aircraft, onRestore }) {
  const left = daysLeft(aircraft.deletedAt)
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      background: 'var(--bg-card)', borderRadius: 16, boxShadow: 'var(--shadow-sm)',
      padding: '12px 14px', opacity: 0.65,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 14, fontWeight: 700, color: 'var(--text)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {aircraft.fullName || aircraft.label || 'Untitled Aircraft'}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 1 }}>
          Deletes in {left} day{left === 1 ? '' : 's'}
        </div>
      </div>
      <button
        onClick={() => onRestore(aircraft.id)}
        style={{
          fontSize: 13, fontWeight: 700, color: 'var(--accent)', background: 'transparent',
          border: 'none', cursor: 'pointer', padding: '6px 4px', fontFamily: 'inherit',
          WebkitTapHighlightColor: 'transparent', flexShrink: 0,
        }}>
        Restore
      </button>
    </div>
  )
}

function RecentlyDeletedSection({ deletedList, onRestore, onClearAll }) {
  if (!deletedList?.length) return null
  return (
    <div style={{ marginTop: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 2px 8px' }}>
        <span style={{
          fontSize: 12, fontWeight: 700, color: 'var(--text-tertiary)',
          textTransform: 'uppercase', letterSpacing: '0.05em',
        }}>
          Recently Deleted
        </span>
        <button
          onClick={onClearAll}
          style={{
            fontSize: 12, fontWeight: 700, color: 'var(--danger)', background: 'transparent',
            border: 'none', cursor: 'pointer', fontFamily: 'inherit',
          }}>
          Clear
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {deletedList.map(a => (
          <DeletedAircraftRow key={a.id} aircraft={a} onRestore={onRestore} />
        ))}
      </div>
    </div>
  )
}

// Counterpart to the aircraft detail view's "Share Aircraft Profile" — reads
// back a file shared by another pilot (via Messages/AirDrop/email/...) and
// hands it to onImport as a plain File; Hangar.jsx does the actual parsing.
function ImportAircraftControl({ onImport, error }) {
  const inputRef = useRef(null)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, marginTop: 2 }}>
      <button
        onClick={() => inputRef.current?.click()}
        style={{
          fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', background: 'transparent',
          border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: '4px 0',
          WebkitTapHighlightColor: 'transparent',
        }}>
        Import Aircraft
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="application/json,.json"
        style={{ display: 'none' }}
        onChange={e => {
          const file = e.target.files?.[0]
          if (file) onImport(file)
          e.target.value = ''
        }}
      />
      {error && <div style={{ fontSize: 12, color: 'var(--danger)', textAlign: 'center' }}>{error}</div>}
    </div>
  )
}

export function HangarListView({ aircraftList, activeId, onSelect, onAdd, onBack, deletedList, onRestore, onClearDeleted, onImport, importError }) {
  return (
    <div style={{ paddingBottom: 40 }}>
      <div style={{ padding: '20px 18px 0', display: 'flex', alignItems: 'center', gap: 12 }}>
        <BackButton onBack={onBack} />
        <h2 style={{
          fontSize: 28, fontWeight: 700, letterSpacing: '-0.4px', color: 'var(--text)',
          fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
        }}>Hangar</h2>
      </div>

      <div style={{ padding: '16px 18px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {aircraftList.map(a => (
          <AircraftRow key={a.id} aircraft={a} active={a.id === activeId} onClick={() => onSelect(a.id)} />
        ))}

        <button
          onClick={onAdd}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            padding: '13px 0', borderRadius: 16, border: '1.5px dashed var(--border)',
            background: 'transparent', color: 'var(--accent)',
            fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
            WebkitTapHighlightColor: 'transparent',
          }}>
          <span style={{ fontSize: 16, lineHeight: 1 }}>+</span> Add Aircraft
        </button>

        <ImportAircraftControl onImport={onImport} error={importError} />

        <RecentlyDeletedSection deletedList={deletedList} onRestore={onRestore} onClearAll={onClearDeleted} />
      </div>
    </div>
  )
}
