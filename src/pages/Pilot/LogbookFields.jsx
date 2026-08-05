import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { BackButton } from '../../components/Shell'
import { get, put } from '../../lib/db'
import { FIELD_SECTIONS, defaultFieldConfig } from '../../lib/logbookFields'

function SectionLabel({ children }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
      color: 'var(--text-tertiary)', margin: '20px 2px 8px',
    }}>{children}</div>
  )
}

function ToggleRow({ label, sublabel, checked, onChange, first }) {
  return (
    <div onClick={() => onChange(!checked)} style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '13px 16px', borderTop: first ? 'none' : '0.5px solid var(--border)',
      cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
    }}>
      <div style={{ flex: 1, minWidth: 0, paddingRight: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{label}</div>
        {sublabel && <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2, lineHeight: 1.4 }}>{sublabel}</div>}
      </div>
      <div style={{
        width: 44, height: 26, borderRadius: 13, flexShrink: 0, position: 'relative',
        background: checked ? 'var(--ok)' : 'var(--bg-card-2)', transition: 'background 0.15s',
      }}>
        <div style={{
          position: 'absolute', top: 2, left: checked ? 20 : 2, width: 22, height: 22, borderRadius: '50%',
          background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.3)', transition: 'left 0.15s',
        }} />
      </div>
    </div>
  )
}

// Reached from LogbookList's gear icon — a second-level screen, so BackButton
// with navigate(-1) (matches Profile Setup's own pattern) rather than
// HomeButton.
export default function LogbookFields() {
  const navigate = useNavigate()
  const [config, setConfig] = useState(null)

  useEffect(() => {
    get('settings', 'logbookFieldConfig').then(row => {
      setConfig({ ...defaultFieldConfig(), ...(row?.value ?? {}) })
    })
  }, [])

  function toggle(key) {
    const next = { ...config, [key]: !config[key] }
    setConfig(next)
    put('settings', { key: 'logbookFieldConfig', value: next })
  }

  if (!config) return null

  return (
    <div style={{ paddingBottom: 40 }}>
      <div style={{ padding: '20px 20px 0', display: 'flex', alignItems: 'center', gap: 12 }}>
        <BackButton onBack={() => navigate(-1)} />
        <h2 style={{
          fontSize: 28, fontWeight: 700, letterSpacing: '-0.4px', color: 'var(--text)',
          fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
        }}>Configure Fields</h2>
      </div>

      <div style={{ padding: '0 18px' }}>
        {FIELD_SECTIONS.map(({ section, fields }) => (
          <div key={section}>
            <SectionLabel>{section}</SectionLabel>
            <div style={{ background: 'var(--bg-card)', borderRadius: 16, boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
              {fields.map((f, i) => (
                <ToggleRow
                  key={f.key} first={i === 0}
                  label={f.label} sublabel={f.sublabel}
                  checked={!!config[f.key]}
                  onChange={() => toggle(f.key)}
                />
              ))}
            </div>
          </div>
        ))}

        <SectionLabel>Custom Fields</SectionLabel>
        <div style={{ background: 'var(--bg-card)', borderRadius: 16, boxShadow: 'var(--shadow-sm)', overflow: 'hidden', padding: '16px' }}>
          <div style={{ fontSize: 13, color: 'var(--text-tertiary)', textAlign: 'center' }}>
            Custom fields aren't built yet — coming soon
          </div>
        </div>
      </div>
    </div>
  )
}
