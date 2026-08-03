import { useState } from 'react'
import { createPortal } from 'react-dom'
import { SegControl } from './SegControl'

// Small "ⓘ" trigger + popover shown next to any regulatory decision in the
// app (cruising altitude, fuel reserve, ...) — the citation for the pilot's
// active jurisdiction, a link to the real official source, and (when a
// second jurisdiction's equivalent citation is passed in) a toggle to
// preview it inline without changing the pilot's actual region setting.
//
// The overlay is portaled straight to document.body rather than rendered
// inline. RuleInfo shows up inside components that themselves contain a
// Leaflet map (RouteAltitude.jsx) — Leaflet's panes use CSS transforms for
// panning, and a transformed ancestor becomes the containing block for any
// `position: fixed` descendant per the CSS spec, which silently breaks
// naive fixed-position overlays instead of covering the viewport (the same
// "sibling ancestor" issue RouteAltitude.jsx already works around for its
// own fullscreen map portal). Portaling to body sidesteps that regardless
// of which component tree RuleInfo ends up used in.
export default function RuleInfo({ citation, alt, size = 16 }) {
  const [open, setOpen] = useState(false)
  const [showing, setShowing] = useState('active') // 'active' | 'alt'

  if (!citation && !alt) return null
  const current = showing === 'alt' && alt ? alt.citation : citation

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Regulatory reference"
        style={{
          width: size, height: size, borderRadius: '50%', flexShrink: 0,
          border: '1px solid var(--text-tertiary)', background: 'none', padding: 0,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', color: 'var(--text-tertiary)',
          fontSize: size * 0.62, fontWeight: 700, fontFamily: 'Georgia, serif', fontStyle: 'italic',
          lineHeight: 1, verticalAlign: 'middle',
        }}>
        i
      </button>

      {open && createPortal((
        <div style={{
          position: 'fixed', inset: 0, zIndex: 700,
          background: 'rgba(0,0,0,0.55)',
          backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 24px',
        }} onClick={() => { setOpen(false); setShowing('active') }}>
          <div onClick={e => e.stopPropagation()} style={{
            width: '100%', maxWidth: 360,
            background: 'var(--bg-card)', borderRadius: 20, padding: '20px 20px 18px',
            boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          }}>
            {alt && (
              <div style={{ marginBottom: 14 }}>
                <SegControl
                  options={[citation ? citation.label ?? 'This region' : 'This region', alt.label]}
                  value={showing === 'alt' ? alt.label : (citation ? citation.label ?? 'This region' : 'This region')}
                  onChange={v => setShowing(v === alt.label ? 'alt' : 'active')}
                />
              </div>
            )}

            {current ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 6 }}>
                  <h3 style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)', margin: 0 }}>{current.label}</h3>
                </div>
                <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  {current.desc}
                </p>
                {current.url && (
                  <a href={current.url} target="_blank" rel="noreferrer" style={{
                    display: 'block', marginTop: 14, textAlign: 'center', padding: '10px 0', borderRadius: 10,
                    background: 'var(--bg-card-2)', textDecoration: 'none', fontSize: 13, fontWeight: 700, color: 'var(--accent)',
                  }}>
                    Open official source ↗
                  </a>
                )}
              </>
            ) : (
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                No jurisdiction-specific citation available for the selected region — verify against the regulator for wherever you're actually flying.
              </p>
            )}

            <button onClick={() => { setOpen(false); setShowing('active') }} style={{
              width: '100%', marginTop: 14, padding: '11px 0', borderRadius: 10, border: 'none',
              background: 'transparent', color: 'var(--text-secondary)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            }}>
              Close
            </button>
          </div>
        </div>
      ), document.body)}
    </>
  )
}
