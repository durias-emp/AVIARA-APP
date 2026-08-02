import { BackButton } from '../../components/Shell'
import { useRegion } from '../../context/Region'

const REGIONS = [
  { key: 'us', label: 'United States', sub: 'FAA / FAR-AIM' },
  { key: 'ca', label: 'Canada', sub: 'Transport Canada / CARs' },
  { key: 'intl', label: 'International / Other', sub: 'Generic ICAO references' },
]

const ROW_LABELS = {
  airports: 'Airports',
  map: 'Map',
  hangar: 'Hangar',
  pilot: 'Pilot',
  flight: 'Flight Planning',
  discover: 'Discover',
}

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

export default function Settings({ onBack, order, onMoveRow }) {
  const { region, setRegion } = useRegion()

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
              onClick={() => setRegion(r.key)}
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

        {Array.isArray(order) && order.length > 0 && (
          <>
            <SectionLabel>Home Screen Order</SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {order.map((key, i) => (
                <div key={key} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  background: 'var(--bg-card)', borderRadius: 14, boxShadow: 'var(--shadow-sm)',
                  padding: '12px 16px',
                }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{ROW_LABELS[key] ?? key}</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      onClick={() => onMoveRow(i, -1)}
                      disabled={i === 0}
                      style={{
                        width: 30, height: 30, borderRadius: 9, border: 'none',
                        background: 'var(--bg-card-2)', color: i === 0 ? 'var(--text-tertiary)' : 'var(--text)',
                        fontSize: 15, cursor: i === 0 ? 'default' : 'pointer',
                      }}>↑</button>
                    <button
                      onClick={() => onMoveRow(i, 1)}
                      disabled={i === order.length - 1}
                      style={{
                        width: 30, height: 30, borderRadius: 9, border: 'none',
                        background: 'var(--bg-card-2)', color: i === order.length - 1 ? 'var(--text-tertiary)' : 'var(--text)',
                        fontSize: 15, cursor: i === order.length - 1 ? 'default' : 'pointer',
                      }}>↓</button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

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
