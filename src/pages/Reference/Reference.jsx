import { useState, useCallback } from 'react'
import { BackButton } from '../../components/Shell'
import { useBackOverride } from '../../context/BackOverride'
import { IconRadioOff, IconLightGun, IconMarshaller, IconBook } from '../../components/Icons'
import LostComm from './topics/LostComm'
import LightGun from './topics/LightGun'
import Marshalling from './topics/Marshalling'
import AirLaw from './topics/AirLaw'

// Fixed 4-item grid — houses lost-comm procedures, light gun signals,
// marshalling signals, and air law/regulations. Each opens inline within
// this page (no routing) so the grid itself never grows past these 4.
const TOPICS = [
  { key: 'lostComm',    label: 'Lost-Comm Procedures', Icon: IconRadioOff,  Component: LostComm },
  { key: 'lightGun',    label: 'Light Gun Signals',    Icon: IconLightGun,  Component: LightGun },
  { key: 'marshalling', label: 'Marshalling Signals',  Icon: IconMarshaller, Component: Marshalling },
  { key: 'airLaw',      label: 'Air Law & Regulations', Icon: IconBook,    Component: AirLaw },
]

function TopicButton({ label, Icon, onClick }) {
  return (
    <div onClick={onClick} style={{
      cursor: 'pointer',
      background: 'var(--bg-card)',
      borderRadius: 20,
      border: '0.5px solid var(--border)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      textAlign: 'center',
      gap: 10,
      height: 108,
      padding: '14px 10px',
      minWidth: 0,
      WebkitTapHighlightColor: 'transparent',
    }}>
      <div style={{ color: 'var(--text)' }}>
        <Icon size={26} />
      </div>
      <div style={{
        fontSize: 13, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.1px',
        overflowWrap: 'break-word', lineHeight: 1.25,
      }}>
        {label}
      </div>
    </div>
  )
}

export default function Reference() {
  const [activeKey, setActiveKey] = useState(null)
  const active = TOPICS.find(t => t.key === activeKey)

  // Claims the swipe-back gesture while a topic is open, so it returns to
  // the topic grid instead of falling through to Shell's navigate('/').
  const closeTopic = useCallback(() => setActiveKey(null), [])
  useBackOverride(active ? closeTopic : null)

  return (
    <div>
      <div style={{ padding: '20px 20px 0', display: 'flex', alignItems: 'center', gap: 12 }}>
        <BackButton />
        <h2 style={{
          fontSize: 28, fontWeight: 700, letterSpacing: '-0.4px', color: 'var(--text)',
          fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
        }}>Reference</h2>
      </div>

      <div style={{ padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {active ? (
          <active.Component onBack={() => setActiveKey(null)} />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {TOPICS.map(t => (
              <TopicButton key={t.key} label={t.label} Icon={t.Icon} onClick={() => setActiveKey(t.key)} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
