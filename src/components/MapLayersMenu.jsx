import { useState } from 'react'

// Overlays beyond the base chart — checkboxes, can combine with each other
// and with any base chart. `live: true` ones actually render real data now;
// the rest are listed (and toggleable) so the layer picker already matches
// where this is headed, but show "Coming soon" until a data source is wired
// up behind them — they never silently pretend to have data they don't.
export const OVERLAY_OPTIONS = [
  { key: 'radar',          label: 'Radar',              live: true },
  { key: 'flightCategory', label: 'Flight Category',    live: true },
  { key: 'tfr',            label: 'TFRs',                live: true },
  { key: 'notams',         label: 'NOTAMs',              live: false },
  { key: 'traffic',        label: 'Traffic',             live: false },
  { key: 'winds',          label: 'Winds',                live: false },
  { key: 'icing',          label: 'Icing',                live: false },
  { key: 'clouds',         label: 'Clouds',               live: false },
  { key: 'surfaceAnalysis',label: 'Surface Analysis',     live: false },
]

function Row({ label, sub, right, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '11px 4px', cursor: onClick ? 'pointer' : 'default',
        WebkitTapHighlightColor: 'transparent',
      }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{label}</div>
        {sub && <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 1 }}>{sub}</div>}
      </div>
      {right}
    </div>
  )
}

function Radio({ active }) {
  return (
    <div style={{
      width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
      border: active ? 'none' : '1.5px solid var(--border)',
      background: active ? 'var(--accent)' : 'transparent',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {active && <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent-fg)' }} />}
    </div>
  )
}

function Check({ active }) {
  return (
    <div style={{
      width: 20, height: 20, borderRadius: 6, flexShrink: 0,
      border: active ? 'none' : '1.5px solid var(--border)',
      background: active ? 'var(--accent)' : 'transparent',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 12, color: 'var(--accent-fg)', fontWeight: 900,
    }}>
      {active && '✓'}
    </div>
  )
}

export default function MapLayersMenu({ layer, setLayer, layerOptions, overlays, toggleOverlay }) {
  const [open, setOpen] = useState(false)
  const activeOverlayCount = Object.values(overlays).filter(Boolean).length

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        style={{
          position: 'absolute', bottom: 16, left: 16, zIndex: 500,
          display: 'flex', alignItems: 'center', gap: 7,
          background: 'var(--bg-card)', borderRadius: 14, boxShadow: 'var(--shadow-sm)',
          border: 'none', padding: '10px 14px', cursor: 'pointer',
          WebkitTapHighlightColor: 'transparent',
        }}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--text)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="12 2 2 7 12 12 22 7 12 2" />
          <polyline points="2 17 12 22 22 17" />
          <polyline points="2 12 12 17 22 12" />
        </svg>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Layers</span>
        {activeOverlayCount > 0 && (
          <span style={{
            minWidth: 16, height: 16, padding: '0 4px', borderRadius: 8,
            background: 'var(--accent)', color: 'var(--accent-fg)',
            fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>{activeOverlayCount}</span>
        )}
      </button>

      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 900, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'flex-end' }}>
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: '100%', maxHeight: '75vh', overflowY: 'auto',
              background: 'var(--bg)', borderRadius: '20px 20px 0 0',
              padding: '10px 18px 28px',
            }}>
            <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--border)', margin: '4px auto 14px' }} />

            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-tertiary)', margin: '6px 4px' }}>
              Charts
            </div>
            <div style={{ background: 'var(--bg-card)', borderRadius: 14, padding: '0 12px', boxShadow: 'var(--shadow-sm)' }}>
              {layerOptions.map((opt, i) => (
                <div key={opt.key} style={{ borderTop: i === 0 ? 'none' : '0.5px solid var(--border)' }}>
                  <Row label={opt.label} onClick={() => setLayer(opt.key)} right={<Radio active={layer === opt.key} />} />
                </div>
              ))}
            </div>

            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-tertiary)', margin: '20px 4px 6px' }}>
              Overlays
            </div>
            <div style={{ background: 'var(--bg-card)', borderRadius: 14, padding: '0 12px', boxShadow: 'var(--shadow-sm)' }}>
              {OVERLAY_OPTIONS.map((opt, i) => (
                <div key={opt.key} style={{ borderTop: i === 0 ? 'none' : '0.5px solid var(--border)', opacity: opt.live ? 1 : 0.5 }}>
                  <Row
                    label={opt.label}
                    sub={opt.live ? null : 'Coming soon'}
                    onClick={opt.live ? () => toggleOverlay(opt.key) : undefined}
                    right={<Check active={!!overlays[opt.key]} />}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
