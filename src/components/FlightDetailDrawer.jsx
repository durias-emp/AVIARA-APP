import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

function fmtDuration(h) {
  if (h == null) return '—'
  const totalMin = Math.round(h * 60)
  return `${Math.floor(totalMin / 60)}h ${String(totalMin % 60).padStart(2, '0')}m`
}

function StatTile({ label, value }) {
  return (
    <div style={{
      flex: '1 1 45%', minWidth: 130, background: 'var(--bg-card-2)',
      border: '0.5px solid var(--border)', borderRadius: 14, padding: '10px 12px',
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.2px' }}>
        {value ?? '—'}
      </div>
    </div>
  )
}

export default function FlightDetailDrawer({ flight, onClose }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(id)
  }, [])

  function handleClose() {
    setVisible(false)
    setTimeout(onClose, 260)
  }

  if (!flight) return null

  const route = flight.dep && flight.dest ? `${flight.dep} → ${flight.dest}` : (flight.dep || flight.dest || 'Flight')

  return createPortal(
    <div
      onClick={handleClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 300,
        background: visible ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0)',
        backdropFilter: visible ? 'blur(6px)' : 'blur(0px)',
        WebkitBackdropFilter: visible ? 'blur(6px)' : 'blur(0px)',
        transition: 'background 0.26s ease, backdrop-filter 0.26s ease',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          position: 'absolute', left: 0, right: 0, bottom: 0,
          maxHeight: '86vh', overflowY: 'auto', overscrollBehavior: 'contain',
          background: 'var(--bg-card)',
          borderRadius: '24px 24px 0 0',
          border: '0.5px solid var(--border)', borderBottom: 'none',
          boxShadow: '0 -12px 40px rgba(0,0,0,0.35)',
          padding: '10px 20px calc(var(--safe-bottom) + 24px)',
          transform: visible ? 'translateY(0)' : 'translateY(100%)',
          transition: 'transform 0.28s cubic-bezier(0.32, 0.72, 0, 1)',
        }}
      >
        {/* Drag handle */}
        <div style={{ display: 'flex', justifyContent: 'center', padding: '6px 0 14px' }}>
          <div style={{ width: 36, height: 5, borderRadius: 3, background: 'var(--border-strong)' }} />
        </div>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 4 }}>
          <div>
            <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.5px' }}>
              {route}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
              {fmtDate(flight.savedAt)}
            </div>
          </div>
          <button
            onClick={handleClose}
            style={{
              width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
              background: 'var(--bg-card-2)', border: '0.5px solid var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
            }}
          >
            <span style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1 }}>✕</span>
          </button>
        </div>

        {/* Aircraft row */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          marginTop: 16, marginBottom: 20,
          padding: '12px 14px', borderRadius: 14,
          background: 'var(--bg-card-2)', border: '0.5px solid var(--border)',
        }}>
          <div style={{
            width: 38, height: 38, borderRadius: 11, flexShrink: 0,
            background: 'var(--accent-light)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <img
              src={flight.category === 'helicopter' ? '/helicopter.png' : '/modo-avion.png'}
              width={18} height={18} alt=""
              style={{ objectFit: 'contain', filter: 'var(--icon-filter)' }}
            />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.2px' }}>
              {flight.aircraft || 'Aircraft'}
            </div>
            {flight.registration && (
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2, fontFamily: 'monospace', letterSpacing: '0.04em' }}>
                {flight.registration}
              </div>
            )}
          </div>
        </div>

        {/* Stats grid */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <StatTile label="Flight Time" value={fmtDuration(flight.flightTimeH)} />
          <StatTile label="Distance" value={flight.distNm != null ? `${flight.distNm} NM` : '—'} />
          <StatTile label="Cruise Altitude" value={flight.cruiseAlt != null ? `${flight.cruiseAlt} ft` : '—'} />
          <StatTile label="Flight Rules" value={flight.flightRules ?? '—'} />
          <StatTile label="Cruise TAS" value={flight.tas != null ? `${flight.tas} kt` : '—'} />
          <StatTile label="Fuel Burn Rate" value={flight.burnRate != null ? `${flight.burnRate} GPH` : '—'} />
          <StatTile label="Fuel on Board" value={flight.fuelOnBoard != null ? `${flight.fuelOnBoard} gal` : '—'} />
          <StatTile label="Fuel Required" value={flight.fuelRequired != null ? `${flight.fuelRequired} gal` : '—'} />
        </div>
      </div>
    </div>,
    document.body
  )
}
