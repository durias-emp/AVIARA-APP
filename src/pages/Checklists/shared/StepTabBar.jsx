// Small, self-contained duplicate of Checklists.jsx's flattenIds — kept local
// so this file stays presentation-only and doesn't couple to the page module.
function flattenIds(items) {
  const ids = []
  for (const item of items) {
    ids.push(item.id)
    if (item.items) ids.push(...flattenIds(item.items))
  }
  return ids
}

function sectionProgress(section, checked, customItems) {
  const ids = [...flattenIds(section.items), ...(customItems[section.title] ?? []).map(i => i.id)]
  if (ids.length === 0) return 1
  return ids.filter(id => checked.has(id)).length / ids.length
}

function TabIndicator({ section, progress, active }) {
  const size = 24
  if (progress >= 1) {
    return (
      <div style={{
        width: size, height: size, borderRadius: '50%', flexShrink: 0,
        background: 'var(--text)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <svg width={12} height={12} viewBox="0 0 24 24" fill="none" style={{ color: 'var(--bg-card)' }}>
          <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
    )
  }

  const r = (size - 3) / 2
  const c = 2 * Math.PI * r
  const offset = c * (1 - progress)

  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--border)" strokeWidth="2" fill="none" />
        {progress > 0 && (
          <circle
            cx={size / 2} cy={size / 2} r={r} fill="none"
            stroke={active ? 'var(--text)' : 'var(--text-secondary)'}
            strokeWidth="2" strokeLinecap="round"
            strokeDasharray={c} strokeDashoffset={offset}
            style={{ transition: 'stroke-dashoffset 0.3s cubic-bezier(0.4,0,0.2,1)' }}
          />
        )}
      </svg>
      <span style={{
        position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 10, fontWeight: 700,
        color: active ? 'var(--text)' : 'var(--text-tertiary)',
      }}>{section.num}</span>
    </div>
  )
}

/* ── Fixed bottom tab bar — one tab per checklist section ────── */
export default function StepTabBar({ sections, activeIndex, onSelect, checked, customItems }) {
  return (
    <div style={{
      display: 'flex',
      background: 'var(--bg-card)',
      flexShrink: 0,
    }}>
      {sections.map((section, i) => {
        const progress = sectionProgress(section, checked, customItems)
        const active = i === activeIndex
        return (
          <button
            key={section.title}
            onClick={() => onSelect(i)}
            style={{
              flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
              padding: '8px 2px 6px', background: 'none', border: 'none', cursor: 'pointer',
              WebkitTapHighlightColor: 'transparent', minWidth: 0,
            }}
          >
            <TabIndicator section={section} progress={progress} active={active} />
            <span style={{
              fontSize: 9.5, fontWeight: active ? 700 : 600, letterSpacing: '0.2px',
              textTransform: 'uppercase',
              color: active ? 'var(--text)' : 'var(--text-tertiary)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%',
            }}>{section.title}</span>
          </button>
        )
      })}
    </div>
  )
}
