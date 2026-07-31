import { useRef, useState } from 'react'
import { TEMPLATES, CUSTOM_BLANK, AircraftPlaceholder } from './Aircraft'

// A trimmed, purpose-built swipe carousel for picking a starting template in
// the add-aircraft wizard — visually modeled on Aircraft.jsx's own hero
// carousel (swipe/dots/arrows), but without any of that page's
// icon-generation or in-place-profile-mutation logic, since here we're
// picking a *starting point* for a brand-new aircraft, not editing an
// existing one. Deliberately not shared with Onboarding's own carousel
// (AircraftHeroPicker) — that one is tightly coupled to Onboarding's draft
// state; reshaping it to be generic isn't worth the risk to a working
// new-user flow for this phase.
export default function TemplatePickerHero({ selectedId, onSelect }) {
  const touchStartX = useRef(null)
  const [showArrows, setShowArrows] = useState(false)
  const [showCustomModal, setShowCustomModal] = useState(false)
  const [customName, setCustomName] = useState('')

  const allOptions = [...TEMPLATES, { ...CUSTOM_BLANK, id: 'custom' }]
  const activeIdx = allOptions.findIndex(t => t.id === selectedId)
  const active = allOptions[activeIdx] ?? allOptions[0]

  function pick(tpl) {
    if (tpl.id === 'custom') { setCustomName(''); setShowCustomModal(true); return }
    onSelect(tpl)
  }

  function confirmCustom() {
    if (!customName.trim()) return
    onSelect({ ...CUSTOM_BLANK, id: 'custom', fullName: customName.trim(), label: customName.trim() })
    setShowCustomModal(false)
    setCustomName('')
  }

  function swipeToAdjacent(direction) {
    const nextIdx = activeIdx + direction
    if (nextIdx < 0 || nextIdx >= allOptions.length) return
    pick(allOptions[nextIdx])
  }

  return (
    <div style={{ position: 'relative' }}>
      <div
        onMouseEnter={() => setShowArrows(true)}
        onMouseLeave={() => setShowArrows(false)}
        onTouchStart={e => { touchStartX.current = e.touches[0].clientX; setShowArrows(true) }}
        onTouchEnd={e => {
          if (touchStartX.current === null) return
          const dx = e.changedTouches[0].clientX - touchStartX.current
          touchStartX.current = null
          if (Math.abs(dx) < 40) return
          swipeToAdjacent(dx < 0 ? 1 : -1)
        }}
      >
        {/* Dots */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 5, marginBottom: 8 }}>
          {allOptions.map(tpl => (
            <div key={tpl.id} onClick={() => pick(tpl)} style={{
              width: active.id === tpl.id ? 16 : 5,
              height: 5, borderRadius: 3,
              background: active.id === tpl.id ? 'var(--accent)' : 'var(--border)',
              transition: 'width 0.2s, background 0.2s',
              cursor: 'pointer',
            }} />
          ))}
        </div>

        {/* Image */}
        <div style={{ position: 'relative', width: '100%', height: 180, overflow: 'hidden' }}>
          {active.image ? (
            <img src={active.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', objectPosition: 'center bottom', display: 'block' }} />
          ) : (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text)' }}>
              <AircraftPlaceholder />
            </div>
          )}
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '0 6px',
            opacity: showArrows ? 1 : 0,
            transition: 'opacity 0.4s ease',
            pointerEvents: showArrows ? 'auto' : 'none',
          }}>
            {[['M15 18l-6-6 6-6', -1], ['M9 18l6-6-6-6', 1]].map(([d, dir]) => (
              <button key={dir} onClick={() => swipeToAdjacent(dir)} style={{
                width: 32, height: 32, borderRadius: '50%',
                background: 'rgba(120,120,128,0.16)', border: 'none', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                  stroke="var(--text)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d={d} />
                </svg>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ textAlign: 'center', marginTop: 4 }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.3px' }}>
          {active.fullName || active.label}
        </div>
      </div>

      {showCustomModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 500,
          background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 24px',
        }} onClick={() => setShowCustomModal(false)}>
          <div onClick={e => e.stopPropagation()} style={{
            width: '100%', maxWidth: 360, background: 'var(--bg-card)',
            borderRadius: 20, padding: '24px 20px 20px', boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          }}>
            <h3 style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)', marginBottom: 4, textAlign: 'center' }}>
              Custom Aircraft
            </h3>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 18, textAlign: 'center' }}>
              Enter the type or registration to start a blank profile.
            </p>
            <input
              autoFocus type="text" placeholder="e.g. Piper PA-44 Seminole"
              value={customName} onChange={e => setCustomName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && confirmCustom()}
              style={{
                width: '100%', padding: '12px 14px', borderRadius: 'var(--r-md)',
                border: '1px solid var(--accent)', background: 'var(--bg-card-2)',
                color: 'var(--text)', fontSize: 15, outline: 'none', marginBottom: 12, fontFamily: 'inherit',
              }}
            />
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setShowCustomModal(false)} style={{
                flex: 1, padding: '12px', borderRadius: 'var(--r-md)',
                border: '0.5px solid var(--border)', background: 'var(--bg-card-2)',
                color: 'var(--text-secondary)', fontSize: 15, fontWeight: 500, cursor: 'pointer',
              }}>Cancel</button>
              <button onClick={confirmCustom} disabled={!customName.trim()} style={{
                flex: 1, padding: '12px', borderRadius: 'var(--r-md)', border: 'none',
                background: customName.trim() ? 'var(--accent)' : 'var(--bg-card-2)',
                color: customName.trim() ? 'var(--accent-fg)' : 'var(--text-tertiary)',
                fontSize: 15, fontWeight: 700, cursor: customName.trim() ? 'pointer' : 'default',
              }}>Start</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
