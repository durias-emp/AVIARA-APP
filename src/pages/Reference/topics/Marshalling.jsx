import { TopicHeader, Card, Disclaimer } from '../shared/ui'

// Simple line-glyph icons standing in for each marshalling signal's arm/hand
// position — abstractions for a study aid, not the literal ICAO figures.
function MIcon({ d, size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d={d} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

const ICONS = {
  allClear:   <MIcon d="M9 12l2 2 4-5M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z" />,
  start:      <MIcon d="M12 3a9 9 0 1 0 8.94 10M21 3v6h-6" />,
  straight:   <MIcon d="M12 20V4M6 10l6-6 6 6" />,
  left:       <MIcon d="M4 12h16M4 12l6-6M4 12l6 6" />,
  right:      <MIcon d="M20 12H4M20 12l-6-6M20 12l-6 6" />,
  slow:       <MIcon d="M12 4v14M6 12l6 6 6-6" />,
  stop:       <MIcon d="M5 5l14 14M19 5L5 19" />,
  chocksIn:   <MIcon d="M2 12h6M22 12h-6M8 8l-4 4 4 4M16 8l4 4-4 4" />,
  chocksOut:  <MIcon d="M2 12h6M22 12h-6M4 8l4 4-4 4M20 8l-4 4 4 4" />,
  cutEngines: <MIcon d="M4 8h16M8 8v8a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V8" />,
}

const SIGNALS = [
  { icon: 'allClear',   label: 'All Clear / OK',        desc: 'Arm raised overhead, thumb up.' },
  { icon: 'start',      label: 'Start Engine(s)',       desc: 'Circular motion of the hand at head height, pointing to the engine to be started.' },
  { icon: 'straight',   label: 'Proceed Straight Ahead', desc: 'Both arms bent upward, waved toward the body in a "come ahead" motion.' },
  { icon: 'left',       label: 'Turn Left',             desc: 'Right arm extended, left arm makes a "come ahead" beckoning motion in the turn direction.' },
  { icon: 'right',      label: 'Turn Right',            desc: 'Left arm extended, right arm makes a "come ahead" beckoning motion in the turn direction.' },
  { icon: 'slow',       label: 'Slow Down',             desc: 'Both arms extended, palms down, moved up and down slowly.' },
  { icon: 'stop',       label: 'Stop',                  desc: 'Arms crossed above the head.' },
  { icon: 'chocksIn',   label: 'Insert Chocks',         desc: 'Arms extended, hands closed, then swung inward together.' },
  { icon: 'chocksOut',  label: 'Remove Chocks',         desc: 'Arms extended, hands closed, then swung outward and apart.' },
  { icon: 'cutEngines', label: 'Cut Engine(s)',         desc: 'Hand drawn across the throat, at neck height.' },
]

export default function Marshalling({ onBack }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <TopicHeader title="Marshalling Signals" onBack={onBack} />

      <Card sub="Standard ramp/marshalling hand signals. Always follow the actual marshaller in person — airport-specific procedures can vary.">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {SIGNALS.map(s => (
            <div key={s.label} style={{
              display: 'flex', flexDirection: 'column', gap: 8,
              background: 'var(--bg-card-2)', borderRadius: 12, padding: '12px 12px',
            }}>
              <div style={{
                width: 34, height: 34, borderRadius: 10, background: 'var(--bg-card)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--text)', border: '0.5px solid var(--border)',
              }}>
                {ICONS[s.icon]}
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', marginBottom: 3 }}>
                  {s.label}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                  {s.desc}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Disclaimer>
        Simplified icons for a study aid — not official ICAO artwork. Consult AC 00-6 / your airport's ramp procedures for exact signals.
      </Disclaimer>
    </div>
  )
}
