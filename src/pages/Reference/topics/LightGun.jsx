import { TopicHeader, Card, Disclaimer } from '../shared/ui'

const SIGNALS = [
  { pattern: 'steady',      color: '#34C759', label: 'Steady Green',     ground: 'Cleared for takeoff',                                   flight: 'Cleared to land' },
  { pattern: 'flashing',    color: '#34C759', label: 'Flashing Green',   ground: 'Cleared to taxi',                                        flight: 'Return for landing (steady green to follow at the proper time)' },
  { pattern: 'steady',      color: '#FF3B30', label: 'Steady Red',       ground: 'Stop',                                                   flight: 'Give way to other aircraft and continue circling' },
  { pattern: 'flashing',    color: '#FF3B30', label: 'Flashing Red',     ground: 'Taxi clear of the runway/landing area in use',            flight: 'Airport unsafe. Do not land' },
  { pattern: 'flashing',    color: '#fff',    label: 'Flashing White',   ground: 'Return to starting point on airport',                     flight: ', (not used in flight)' },
  { pattern: 'alternating', color: null,      label: 'Alternating Red/Green', ground: 'Exercise extreme caution',                          flight: 'Exercise extreme caution' },
]

// Small visual for each signal. A colored dot that pulses for "flashing"
// and splits red/green for "alternating", so the pattern reads at a glance
// without needing a photo/animation of an actual light gun.
function SignalDot({ pattern, color }) {
  if (pattern === 'alternating') {
    return (
      <div style={{ width: 22, height: 22, borderRadius: '50%', flexShrink: 0, overflow: 'hidden', display: 'flex' }}>
        <div style={{ width: '50%', background: '#FF3B30' }} />
        <div style={{ width: '50%', background: '#34C759' }} />
      </div>
    )
  }
  return (
    <div style={{
      width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
      background: color,
      border: color === '#fff' ? '1px solid var(--border-strong)' : 'none',
      animation: pattern === 'flashing' ? 'lightgun-blink 1.1s steps(2, start) infinite' : 'none',
    }} />
  )
}

export default function LightGun({ onBack }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <style>{`@keyframes lightgun-blink { 50% { opacity: 0.18; } }`}</style>
      <TopicHeader title="Light Gun Signals" onBack={onBack} />

      <Card sub="ATC light signals used when radio communication is lost. Acknowledge by rocking your wings in daylight, or by moving the ailerons/rudder at night.">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {SIGNALS.map((s, i) => (
            <div key={s.label} style={{
              display: 'flex', gap: 12, padding: '12px 0',
              borderBottom: i === SIGNALS.length - 1 ? 'none' : '0.5px solid var(--border)',
            }}>
              <SignalDot pattern={s.pattern} color={s.color} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>
                  {s.label}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                  <span style={{ fontWeight: 600, color: 'var(--text-tertiary)' }}>On the ground: </span>{s.ground}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.4, marginTop: 2 }}>
                  <span style={{ fontWeight: 600, color: 'var(--text-tertiary)' }}>In flight: </span>{s.flight}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Disclaimer>
        Reference: AIM 4-3-13, Table 4-3-1. Study aid only, always follow the actual signal received from the tower.
      </Disclaimer>
    </div>
  )
}
