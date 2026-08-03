import { useCallback, useState } from 'react'
import { HomeButton } from './Shell'
import { useBackOverride } from '../context/BackOverride'
import Calculators from '../pages/Calculators/Calculators'
import Reference from '../pages/Reference/Reference'
import UAPReport from '../pages/UAP/UAPReport'
import { IconBook, IconUap } from './Icons'

const TOOLS = [
  { key: 'calc', label: 'Calculators', sub: 'Conversions, performance', icon: '/E6B CALC.svg' },
  { key: 'reference', label: 'Quick Reference', sub: 'Lost comms, light gun, air law', Icon: IconBook },
  { key: 'uap', label: 'UAP Report', sub: 'Log a sighting', Icon: IconUap },
]

export default function ToolsMenu() {
  const [active, setActive] = useState(null)

  // Claims the swipe-back gesture while a tool is open, so it returns to
  // the Tools menu instead of falling through to Shell's navigate('/') —
  // same pattern Reference.jsx uses for its own internal topic navigation.
  const closeTool = useCallback(() => setActive(null), [])
  useBackOverride(active ? closeTool : null)

  if (active === 'calc') return <Calculators onBack={closeTool} />
  if (active === 'reference') return <Reference onBack={closeTool} />
  if (active === 'uap') return <UAPReport onBack={closeTool} />

  return (
    <div>
      <div style={{ padding: '20px 20px 0', display: 'flex', alignItems: 'center', gap: 12 }}>
        <HomeButton />
        <h2 style={{
          fontSize: 28, fontWeight: 700, letterSpacing: '-0.4px', color: 'var(--text)',
          fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
        }}>Tools</h2>
      </div>

      <div style={{ padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {TOOLS.map(t => (
          <div
            key={t.key}
            onClick={() => setActive(t.key)}
            style={{
              display: 'flex', alignItems: 'center', gap: 14,
              background: 'var(--bg-card)', borderRadius: 16, boxShadow: 'var(--shadow-sm)',
              padding: '14px 16px', cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
            }}>
            <div style={{
              width: 40, height: 40, borderRadius: 12, flexShrink: 0,
              background: 'var(--accent-light)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {t.Icon
                ? <t.Icon size={20} />
                : <img src={t.icon} width={20} height={20} style={{ objectFit: 'contain', filter: 'var(--icon-filter)' }} />}
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{t.label}</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 1 }}>{t.sub}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
