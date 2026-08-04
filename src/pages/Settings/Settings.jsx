import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { HomeButton } from '../../components/Shell'
import { IconChevronRight } from '../../components/Icons'
import { useRegion } from '../../context/Region'
import { get, put } from '../../lib/db'
import { DEFAULT_AUTO_DETECT_CONFIG, autoDetectEnabledFrom } from '../../hooks/useFlightDetector'
import { SegControl } from '../../components/SegControl'

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
  discover: 'Friends',
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

function ToggleSwitch({ checked, onChange }) {
  return (
    <div onClick={() => onChange(!checked)} style={{
      width: 44, height: 26, borderRadius: 13, flexShrink: 0, position: 'relative', cursor: 'pointer',
      background: checked ? 'var(--ok)' : 'var(--bg-card-2)', transition: 'background 0.15s',
    }}>
      <div style={{
        position: 'absolute', top: 2, left: checked ? 20 : 2, width: 22, height: 22, borderRadius: '50%',
        background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.3)', transition: 'left 0.15s',
      }} />
    </div>
  )
}

const AUTO_DETECT_MODES = [
  { key: 'speed', label: 'Speed only' },
  { key: 'altitude', label: 'Altitude only' },
  { key: 'both', label: 'Both' },
]

export default function Settings({ onBack, order, onMoveRow }) {
  const { region, setRegion } = useRegion()
  const [autoDetectEnabled, setAutoDetectEnabled] = useState(true)
  const [autoDetectConfig, setAutoDetectConfig] = useState(DEFAULT_AUTO_DETECT_CONFIG)

  useEffect(() => {
    get('settings', 'autoDetectEnabled').then(row => setAutoDetectEnabled(autoDetectEnabledFrom(row)))
    get('settings', 'autoDetectConfig').then(row => setAutoDetectConfig({ ...DEFAULT_AUTO_DETECT_CONFIG, ...(row?.value ?? {}) }))
  }, [])

  function toggleAutoDetect(next) {
    setAutoDetectEnabled(next)
    put('settings', { key: 'autoDetectEnabled', value: next })
  }

  function updateAutoDetectConfig(patch) {
    const next = { ...autoDetectConfig, ...patch }
    setAutoDetectConfig(next)
    put('settings', { key: 'autoDetectConfig', value: next })
  }

  return (
    <div style={{ paddingBottom: 40 }}>
      <div style={{ padding: '20px 20px 0', display: 'flex', alignItems: 'center', gap: 12 }}>
        <HomeButton onBack={onBack} />
        <h2 style={{
          fontSize: 28, fontWeight: 700, letterSpacing: '-0.4px', color: 'var(--text)',
          fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
        }}>Settings</h2>
      </div>

      <div style={{ padding: '0 18px' }}>
        <SectionLabel>Profile</SectionLabel>
        <Link to="/profile" style={{ textDecoration: 'none' }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            background: 'var(--bg-card)', borderRadius: 16, boxShadow: 'var(--shadow-sm)',
            padding: '13px 16px', cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
          }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>Profile Setup</span>
            <span style={{ color: 'var(--text-tertiary)', display: 'flex' }}>
              <IconChevronRight size={16} />
            </span>
          </div>
        </Link>

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

        <SectionLabel>Flight Detection</SectionLabel>
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: '0 2px 10px', lineHeight: 1.5 }}>
          Automatically detects a flight from GPS speed/altitude and drafts a Logbook entry for you to review in the Hangar. Only works while the app is open on screen — it can't track in the background or with the phone locked. True background tracking needs the app wrapped as a native app, which is a bigger, separate project.
        </div>
        <div style={{ background: 'var(--bg-card)', borderRadius: 16, boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 16px' }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>Auto-detect flights</span>
            <ToggleSwitch checked={autoDetectEnabled} onChange={toggleAutoDetect} />
          </div>
          {autoDetectEnabled && (
            <div style={{ padding: '4px 16px 16px', borderTop: '0.5px solid var(--border)' }}>
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 600, margin: '12px 0 6px' }}>Trigger on</div>
              <SegControl
                options={AUTO_DETECT_MODES.map(m => m.label)}
                value={AUTO_DETECT_MODES.find(m => m.key === autoDetectConfig.mode)?.label ?? 'Both'}
                onChange={label => updateAutoDetectConfig({ mode: AUTO_DETECT_MODES.find(m => m.label === label).key })}
              />
              {autoDetectConfig.mode !== 'altitude' && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 600, marginBottom: 6 }}>Speed threshold (kt)</div>
                  <input
                    type="number" inputMode="numeric" value={autoDetectConfig.speedKt}
                    onChange={e => updateAutoDetectConfig({ speedKt: Number(e.target.value) || 0 })}
                    style={{
                      width: '100%', boxSizing: 'border-box', padding: '11px 13px', borderRadius: 10,
                      border: 'none', background: 'var(--bg-card-2)', color: 'var(--text)',
                      fontSize: 15, outline: 'none', fontFamily: 'inherit',
                    }}
                  />
                </div>
              )}
              {autoDetectConfig.mode !== 'speed' && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 600, marginBottom: 6 }}>Altitude threshold (ft AGL)</div>
                  <input
                    type="number" inputMode="numeric" value={autoDetectConfig.altAglFt}
                    onChange={e => updateAutoDetectConfig({ altAglFt: Number(e.target.value) || 0 })}
                    style={{
                      width: '100%', boxSizing: 'border-box', padding: '11px 13px', borderRadius: 10,
                      border: 'none', background: 'var(--bg-card-2)', color: 'var(--text)',
                      fontSize: 15, outline: 'none', fontFamily: 'inherit',
                    }}
                  />
                </div>
              )}
            </div>
          )}
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
