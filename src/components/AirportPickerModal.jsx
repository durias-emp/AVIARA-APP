import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

const PLACEHOLDERS = ['KLAX', 'KJFK', 'KORD', 'KATL', 'KDFW', 'KDEN', 'KSFO', 'KMIA', 'KBOS', 'KSEA', 'KLAS', 'KPHX', 'KEWR', 'KIAD', 'KDTW']

const FLIP_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

function usePlaceholderFlip() {
  const [display, setDisplay] = useState(PLACEHOLDERS[0])
  const indexRef   = useRef(0)
  const frameRef   = useRef(null)

  useEffect(() => {
    let cancelled = false

    function flipTo(target, currentDisplay, done) {
      const steps = 10
      let step = 0

      function tick() {
        if (cancelled) return
        step++
        const next = target.split('').map((ch) => {
          if (step >= steps - 1) return ch
          const progress = step / (steps - 1)
          if (Math.random() < progress) return ch
          return FLIP_CHARS[Math.floor(Math.random() * FLIP_CHARS.length)]
        }).join('')
        setDisplay(next)
        if (step < steps) {
          frameRef.current = setTimeout(tick, 55)
        } else {
          done()
        }
      }
      tick()
    }

    function cycle() {
      if (cancelled) return
      indexRef.current = (indexRef.current + 1) % PLACEHOLDERS.length
      const target = PLACEHOLDERS[indexRef.current]
      flipTo(target, display, () => {
        if (!cancelled) frameRef.current = setTimeout(cycle, 2200)
      })
    }

    frameRef.current = setTimeout(cycle, 2200)
    return () => {
      cancelled = true
      clearTimeout(frameRef.current)
    }
  }, [])

  return display
}

export default function AirportPickerModal({ onConfirm, onClose, label = 'Home Airport', title = 'Change Airport', confirmLabel = 'Set Airport' }) {
  const [value, setValue]      = useState('')
  const [status, setStatus]    = useState('idle') // idle | checking | valid | invalid
  const [airportName, setName] = useState(null)
  const inputRef  = useRef(null)
  const timerRef  = useRef(null)
  const placeholder = usePlaceholderFlip()

  useEffect(() => {
    const id = setTimeout(() => inputRef.current?.focus(), 80)
    return () => clearTimeout(id)
  }, [])

  function handleChange(e) {
    const v = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4)
    setValue(v)
    setStatus('idle')
    setName(null)
    clearTimeout(timerRef.current)
    if (v.length >= 3) {
      setStatus('checking')
      timerRef.current = setTimeout(() => validate(v), 650)
    }
  }

  async function validate(icao) {
    try {
      // Use our Vercel proxy. No CORS issues, no third-party rate limits
      const res  = await fetch(`/api/awc?path=airport&ids=${icao}&format=json`, { signal: AbortSignal.timeout(8000) })
      const data = await res.json()
      if (Array.isArray(data) && data.length > 0) {
        const raw  = data[0]
        const name = raw.name ?? raw.site ?? raw.icaoId
        setName(name)
        setStatus('valid')
        return
      }
      // Fall back to METAR check (covers stations without airport record)
      const res2  = await fetch(`/api/awc?path=metar&ids=${icao}&format=json&hours=3`, { signal: AbortSignal.timeout(8000) })
      const data2 = await res2.json()
      if (Array.isArray(data2) && data2.length > 0 && data2[0]?.icaoId) {
        const raw  = data2[0]
        const name = raw.name ?? raw.site ?? raw.stationName ?? raw.icaoId
        setName(name)
        setStatus('valid')
      } else {
        setStatus('invalid')
      }
    } catch {
      setStatus('invalid')
    }
  }

  function confirm() {
    if (status === 'valid') onConfirm(value)
  }

  const dotColor =
    status === 'valid'   ? '#4ade80' :
    status === 'invalid' ? '#f87171' :
    status === 'checking' ? '#facc15' :
    'var(--text-tertiary)'

  return createPortal(
    <>
      <style>{`
        @keyframes apt-ping {
          75%, 100% { transform: scale(2); opacity: 0; }
        }
        @keyframes apt-spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 400,
          background: 'rgba(0,0,0,0.6)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '0 20px',
        }}
      >
        <div
          onClick={e => e.stopPropagation()}
          style={{
            width: '100%', maxWidth: 320,
            background: 'var(--bg-card)',
            border: '0.5px solid var(--border)',
            borderRadius: 22,
            padding: '20px 18px 16px',
            boxShadow: 'var(--shadow-md)',
          }}
        >
          {/* Header */}
          <div style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
            textTransform: 'uppercase', color: 'var(--text-tertiary)',
            marginBottom: 4,
          }}>
            {label}
          </div>
          <div style={{
            fontSize: 19, fontWeight: 700, color: 'var(--text)',
            letterSpacing: '-0.3px', marginBottom: 16,
          }}>
            {title}
          </div>

          {/* Input row with dot indicator */}
          <div style={{ position: 'relative' }}>
            {/* Dot indicator */}
            <div style={{
              position: 'absolute', left: 14, top: '50%',
              transform: 'translateY(-50%)',
              zIndex: 2,
            }}>
              <span style={{ position: 'relative', display: 'flex', width: 7, height: 7 }}>
                {status === 'valid' && (
                  <span style={{
                    position: 'absolute', inset: 0, borderRadius: '50%',
                    background: dotColor, opacity: 0.75,
                    animation: 'apt-ping 1.2s cubic-bezier(0,0,0.2,1) infinite',
                  }} />
                )}
                <span style={{
                  position: 'relative', width: 7, height: 7, borderRadius: '50%',
                  background: dotColor,
                  transition: 'background 0.3s',
                  animation: status === 'checking' ? 'apt-spin 0.9s linear infinite' : 'none',
                  display: 'block',
                }} />
              </span>
            </div>

            <input
              ref={inputRef}
              value={value}
              onChange={handleChange}
              onKeyDown={e => e.key === 'Enter' && confirm()}
              placeholder={placeholder}
              maxLength={4}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              style={{
                width: '100%', boxSizing: 'border-box',
                padding: '13px 14px 13px 30px',
                fontSize: 28, fontWeight: 700, letterSpacing: '0.12em',
                textTransform: 'uppercase',
                fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
                background: 'var(--bg-card-2)',
                border: '0.5px solid var(--border)',
                borderRadius: 12,
                color: 'var(--text)',
                outline: 'none',
                caretColor: 'var(--text)',
              }}
            />
          </div>

          {/* Status line */}
          <div style={{ minHeight: 22, display: 'flex', alignItems: 'center', marginTop: 8, paddingLeft: 2 }}>
            {status === 'checking' && (
              <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                Looking up airport…
              </span>
            )}
            {status === 'valid' && (
              <span style={{ fontSize: 12, color: 'var(--ok)', fontWeight: 600 }}>
                {airportName ?? value}
              </span>
            )}
            {status === 'invalid' && (
              <span style={{ fontSize: 12, color: 'var(--danger)', fontWeight: 600 }}>
                Airport not found. Check the ICAO code
              </span>
            )}
          </div>

          {/* Buttons */}
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button
              onClick={onClose}
              style={{
                flex: 1, padding: '12px 0', borderRadius: 12,
                background: 'var(--bg-card-2)',
                border: '0.5px solid var(--border)',
                color: 'var(--text-secondary)', fontSize: 14, fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              onClick={confirm}
              disabled={status !== 'valid'}
              style={{
                flex: 1, padding: '12px 0', borderRadius: 12,
                background: status === 'valid' ? 'var(--accent)' : 'var(--accent-light)',
                border: 'none',
                color: status === 'valid' ? 'var(--accent-fg)' : 'var(--text-tertiary)',
                fontSize: 14, fontWeight: 700,
                cursor: status === 'valid' ? 'pointer' : 'default',
                transition: 'all 0.25s',
              }}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body
  )
}
