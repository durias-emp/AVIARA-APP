import { OverflightItem, OxygenItem, RecapItem, IMSafeExpand, IMCurrentExpand, IMValidExpand, IMAirworthyExpand } from './Pilot'
import { AircraftItem } from './AircraftSection'
import { WBExpand, DensityAltItem, PerfDistItem, CruiseItem } from './Performance'
import { AirportItem, NotamItem } from './Airport'
import { AlternatesItem, MetarItem } from './Weather'
import { AltitudeItem, ChartsItem } from './RouteAltitude'
import { CardLayoutContext, useCardLayout } from '../shared/CardLayout'

const EXPAND_MAP = {
  wb:          WBExpand,
  imsafe:      IMSafeExpand,
  imcurrent:   IMCurrentExpand,
  imvalid:     IMValidExpand,
  imairworthy: IMAirworthyExpand,
  metar:      MetarItem,
  altitude:   AltitudeItem,
  densityalt: DensityAltItem,
  perfdist:   PerfDistItem,
  cruise:     CruiseItem,
  charts:     ChartsItem,
  alternates: AlternatesItem,
  notam:      NotamItem,
  overflight: OverflightItem,
  airport:    AirportItem,
  aircraft:   AircraftItem,
  oxygen:     OxygenItem,
  recap:      RecapItem,
}

function SubPills({ sub, isChecked }) {
  if (!sub || isChecked) return null
  return (
    <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 3 }}>
      {sub}
    </div>
  )
}

/* ── Item rows — expandable items via EXPAND_MAP, plain checkable rows otherwise ── */
function StepItems({ items, checked, onToggle, total, top = false }) {
  const { stretch } = useCardLayout()
  // Each item sits in a wrapper that is the flex child of the pane, so the
  // wrapper is what has to take a share of the height — styling the card
  // inside it achieves nothing while its parent is still content-sized.
  // Only the top-level list divides the pane; a nested list belongs to its
  // parent card's share.
  const share = top && stretch
    ? { flex: '1 1 0', minHeight: 46, display: 'flex', flexDirection: 'column' }
    : null

  return (
    <>
      {items.map(item => {
        const isChecked = checked.has(item.id)

        if (item.expand && EXPAND_MAP[item.expand]) {
          const ExpandComp = EXPAND_MAP[item.expand]
          return (
            <div key={item.id} style={share}>
              <ExpandComp item={item} isChecked={isChecked} onToggle={onToggle} checked={checked} total={total} />
              {item.items && (
                <StepItems items={item.items} checked={checked} onToggle={onToggle} total={total} />
              )}
            </div>
          )
        }

        return (
          <div key={item.id} style={share}>
            <button
              onClick={() => onToggle(item.id)}
              style={{
                width: '100%', textAlign: 'left', background: 'none', border: 'none',
                cursor: 'pointer', display: 'flex', alignItems: 'flex-start', gap: 10,
                padding: '5px 0', minHeight: 36,
              }}>
              <div style={{
                width: 7, height: 7, marginTop: 5,
                borderRadius: '50%', flexShrink: 0,
                background: isChecked ? 'var(--text)' : 'transparent',
                border: `1.5px solid ${isChecked ? 'var(--text)' : 'var(--border-strong)'}`,
                transition: 'all 0.2s',
              }} />
              <div style={{ flex: 1 }}>
                <div style={{
                  fontSize: 14, fontWeight: 500, lineHeight: 1.35,
                  color: isChecked ? 'var(--text-tertiary)' : 'var(--text)',
                  textDecoration: isChecked ? 'line-through' : 'none',
                  transition: 'color 0.2s',
                }}>
                  {item.label}
                </div>
                <SubPills sub={item.sub} isChecked={isChecked} />
              </div>
            </button>
            {item.items && (
              <StepItems items={item.items} checked={checked} onToggle={onToggle} total={total} />
            )}
          </div>
        )
      })}
    </>
  )
}

/* ── One section's full content — built-in items + pilot-added custom items ── */
export default function StepPane({ section, checked, onToggle, total, customItems, onDeleteCustomItem, onUpdateCustomItemValue, stretch = false }) {
  const custom = customItems[section.title] ?? []

  // Cards divide the pane between them only while they are all closed, and
  // only when there is more than one. A single card is opened by
  // ExpandableCard itself rather than stretched to fill the screen as a
  // button that does nothing but wait to be pressed.
  const cardCount = section.items.length
  const solo = cardCount === 1
  const layout = { stretch: stretch && !solo && cardCount > 1, solo }

  return (
    <CardLayoutContext.Provider value={layout}>
    <div style={{
      padding: '20px 16px 24px',
      ...(layout.stretch ? { minHeight: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' } : null),
    }}>
      <StepItems items={section.items} checked={checked} onToggle={onToggle} total={total} top />

      {custom.length > 0 && custom.map(ci => (
        <div key={ci.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0', minHeight: 36 }}>
          <button
            onClick={() => onToggle(ci.id)}
            style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0, minWidth: 0 }}
          >
            <div style={{
              width: 7, height: 7, marginTop: 1, borderRadius: '50%', flexShrink: 0,
              background: checked.has(ci.id) ? 'var(--text)' : 'transparent',
              border: `1.5px solid ${checked.has(ci.id) ? 'var(--text)' : 'var(--border-strong)'}`,
              transition: 'all 0.2s',
            }} />
            <span style={{
              fontSize: 14, fontWeight: 500, lineHeight: 1.35,
              color: checked.has(ci.id) ? 'var(--text-tertiary)' : 'var(--text)',
              textDecoration: checked.has(ci.id) ? 'line-through' : 'none',
              transition: 'color 0.2s',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{ci.label}</span>
          </button>
          {(ci.type === 'text' || ci.type === 'number') && (
            <input
              type={ci.type === 'number' ? 'number' : 'text'}
              inputMode={ci.type === 'number' ? 'decimal' : undefined}
              value={ci.value ?? ''}
              onChange={e => onUpdateCustomItemValue(section.title, ci.id, e.target.value)}
              placeholder="—"
              style={{
                width: 84, flexShrink: 0, fontSize: 16, textAlign: 'right',
                background: 'var(--bg-card-2)', borderRadius: 8, padding: '5px 8px', color: 'var(--text)',
                outline: 'none', fontFamily: 'inherit',
              }}
            />
          )}
          <button
            onClick={() => onDeleteCustomItem(section.title, ci.id)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', padding: '2px 4px', flexShrink: 0, display: 'flex', alignItems: 'center' }}
          >
            <svg width={11} height={11} viewBox="0 0 24 24" fill="none">
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
      ))}
    </div>
    </CardLayoutContext.Provider>
  )
}
