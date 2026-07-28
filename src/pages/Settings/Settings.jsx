import { useEffect, useState } from 'react'
import { BackButton } from '../../components/Shell'
import { get, put } from '../../lib/db'

const REGIONS = [
  { key: 'us', label: 'United States', sub: 'FAA / FAR-AIM' },
  { key: 'ca', label: 'Canada', sub: 'Transport Canada / CARs' },
  { key: 'intl', label: 'International / Other', sub: 'Generic ICAO references' },
]

function SectionLabel({ children }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
      color: 'var(--text-tertiary)', margin: '20px 2px 8px',
    }}>
      {children}
    </div>
  )
}

export default function Settings({ onBack }) {
  const [region, setRegion] = useState('us')

  useEffect(() => {
    get('settings', 'region').then(row => {
      if (row?.value) setRegion(row.value)
    })
  }, [])

  function selectRegion(key) {
    setRegion(key)
    put('settings', { key: 'region', value: key }).catch(() => {})
  }

  return (
    <div style={{ paddingBottom: 40 }}>
      <div style={{ padding: '20px 20px 0', display: 'flex', alignItems: 'center', gap: 12 }}>
        <BackButton onBack={onBack} />
        <h2 style={{
          fontSize: 28, fontWeight: 700, letterSpacing: '-0.4px', color: 'var(--text)',
          fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
        }}>Settings</h2>
      </div>

      <div style={{ padding: '0 18px' }}>
        <SectionLabel>Region</SectionLabel>
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: '0 2px 10px', lineHeight: 1.5 }}>
          Changes which air law and regulatory references show up throughout the app.
        </div>
        <div style={{ background: 'var(--bg-card)', borderRadius: 16, boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
          {REGIONS.map((r, i) => (
            <div
              key={r.key}
              onClick={() => selectRegion(r.key)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '13px 16px', borderTop: i === 0 ? 'none' : '0.5px solid var(--border)',
                cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
              }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{r.label}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 1 }}>{r.sub}</div>
              </div>
              <div style={{
                width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                border: region === r.key ? 'none' : '1.5px solid var(--border)',
                background: region === r.key ? 'var(--accent)' : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {region === r.key && (
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent-fg)' }} />
                )}
              </div>
            </div>
          ))}
        </div>

        <SectionLabel>About</SectionLabel>
        <div style={{ background: 'var(--bg-card)', borderRadius: 16, boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 16px' }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>Version</span>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontFamily: 'monospace' }}>0.0.0</span>
          </div>
        </div>

        <p style={{ fontSize: 11, color: 'var(--text-tertiary)', textAlign: 'center', padding: '20px 12px 0', lineHeight: 1.5 }}>
          More settings — theme, notifications, data export — are on the way.
        </p>
      </div>
    </div>
  )
}
