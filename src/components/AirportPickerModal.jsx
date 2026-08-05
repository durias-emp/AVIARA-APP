import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { findAirport } from '../lib/aerodromes'
import { searchAirports, nearbyAirports, placeLabel } from '../lib/airportSearch'
import { useHomeLocation } from '../context/HomeLocation'

// Examples deliberately mix codes with place names. The input used to accept
// four characters and nothing else, so a placeholder cycling ICAO codes was
// honest about what it wanted. It now searches names, cities and IATA codes
// too, and the placeholder is the only thing that gets to say so before
// someone has typed anything.
const PLACEHOLDERS = ['KJFK', 'Toronto', 'YYZ', 'Barrie', 'CYYZ', 'Muskoka', 'LAX', 'Denver', 'EGLL']

const FLIP_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

// A short run of characters with no spaces is someone typing an identifier.
// Worth knowing twice over: it gets the monospace treatment, and it is the
// only shape worth asking the weather service about when the bundled list
// has nothing.
const looksLikeIdent = s => /^[A-Za-z0-9]{2,5}$/.test((s || '').trim())

function usePlaceholderFlip() {
  const [display, setDisplay] = useState(PLACEHOLDERS[0])
  const indexRef   = useRef(0)
  const frameRef   = useRef(null)

  useEffect(() => {
    let cancelled = false

    function flipTo(target, done) {
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
      flipTo(PLACEHOLDERS[indexRef.current], () => {
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

function ResultRow({ r, first, onPick }) {
  const dist = r.distNm == null ? null
    : `${r.distNm < 10 ? r.distNm.toFixed(1) : Math.round(r.distNm)} nm`
  const sub = [placeLabel(r), dist].filter(Boolean).join(' · ')
  return (
    <div
      onClick={() => onPick(r.ident)}
      role="button" tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(r.ident) } }}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 14px',
        borderTop: first ? 'none' : '0.5px solid var(--border)',
        cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
      }}>
      <span style={{
        fontFamily: 'monospace', fontSize: 14, fontWeight: 700,
        color: 'var(--text)', minWidth: 46, letterSpacing: '0.03em',
      }}>{r.ident}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{
          display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{r.name || r.ident}</span>
        {sub && (
          <span style={{
            display: 'block', fontSize: 11, color: 'var(--text-tertiary)', marginTop: 1,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{sub}</span>
        )}
      </span>
      {r.iata && (
        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.06em' }}>
          {r.iata}
        </span>
      )}
    </div>
  )
}

export default function AirportPickerModal({
  onConfirm, onClose, current,
  label = 'Home Airport', title = 'Change Airport', confirmLabel = 'Set Airport',
}) {
  const [value, setValue]     = useState('')
  const [results, setResults] = useState([])
  const [busy, setBusy]       = useState(false)
  const [note, setNote]       = useState(null)   // 'nearby' | 'none' | null
  const inputRef = useRef(null)
  const timerRef = useRef(null)
  const reqRef   = useRef(0)                     // guards against out-of-order async results
  const placeholder = usePlaceholderFlip()

  // Both optional: the provider may not be mounted, and location may be
  // denied. Either way it costs only the distances and the nearby list.
  const coords = useHomeLocation()?.coords ?? null
  const near = coords ? { lat: coords.lat, lon: coords.lon } : null

  useEffect(() => {
    const id = setTimeout(() => inputRef.current?.focus(), 80)
    return () => clearTimeout(id)
  }, [])

  // An empty box offers what is close by rather than a blank panel. This is
  // also the diversion case: the pilot who cannot name the field they want is
  // usually the one who most needs to find it.
  useEffect(() => {
    if (value.trim() || !near) return
    let cancelled = false
    nearbyAirports(near.lat, near.lon, { limit: 8 }).then(r => {
      if (cancelled) return
      setResults(r)
      setNote(r.length ? 'nearby' : null)
    })
    return () => { cancelled = true }
  }, [value, coords])

  function handleChange(e) {
    // Free text: letters, digits, spaces and the punctuation real airport
    // names carry. The old input stripped everything but A-Z0-9 and cut at
    // four characters, which is precisely what made "Barrie" impossible.
    const v = e.target.value.replace(/[^\p{L}\p{N}\s'\-./]/gu, '').slice(0, 40)
    setValue(v)
    clearTimeout(timerRef.current)
    const q = v.trim()
    if (!q) { setResults([]); setNote(null); setBusy(false); return }
    setBusy(true)
    timerRef.current = setTimeout(() => runSearch(q), 160)
  }

  async function runSearch(q) {
    const req = ++reqRef.current
    const hits = await searchAirports(q, { limit: 20, near })
    if (req !== reqRef.current) return

    if (hits.length) {
      setResults(hits)
      setNote(null)
      setBusy(false)
      return
    }

    // Nothing bundled. A code-shaped query may still name a real reporting
    // station that is not an airport in OurAirports — CYLS's own automated
    // station files as CXBI — so it earns one online lookup before the app
    // calls the field unknown. Longer queries are place names, and the
    // bundled list is already the complete answer for those.
    if (looksLikeIdent(q)) {
      const id = q.toUpperCase()
      try {
        const res = await fetch(`/api/awc?path=metar&ids=${id}&format=json&hours=3`, { signal: AbortSignal.timeout(8000) })
        const data = await res.json()
        if (req !== reqRef.current) return
        if (Array.isArray(data) && data.length && data[0]?.icaoId) {
          const m = data[0]
          setResults([{
            ident: m.icaoId, name: m.name ?? m.icaoId, city: '', iata: '',
            country: '', countryName: '', cls: 0,
            lat: m.lat, lon: m.lon, distNm: null,
          }])
          setNote(null); setBusy(false)
          return
        }
      } catch { /* offline, or the proxy is unreachable — fall through */ }

      const known = await findAirport(id)
      if (req !== reqRef.current) return
      if (known) {
        setResults([{
          ident: known.icaoId, name: known.name, city: '', iata: '',
          country: '', countryName: '', cls: 0,
          lat: known.lat, lon: known.lon, distNm: null,
        }])
        setNote(null); setBusy(false)
        return
      }
    }

    if (req !== reqRef.current) return
    setResults([])
    setNote('none')
    setBusy(false)
  }

  function pick(ident) {
    if (ident) onConfirm(ident)
  }

  // Enter and the confirm button both take the top result, so typing
  // "Toronto" and pressing go does the obvious thing.
  const top = results[0] ?? null
  const identish = looksLikeIdent(value)

  return createPortal(
    <>
      <style>{`
        @keyframes apt-spin { to { transform: rotate(360deg); } }
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
            width: '100%', maxWidth: 380,
            background: 'var(--bg-card)',
            border: '0.5px solid var(--border)',
            borderRadius: 22,
            padding: '20px 18px 16px',
            boxShadow: 'var(--shadow-md)',
          }}
        >
          <div style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
            textTransform: 'uppercase', color: 'var(--text-tertiary)',
            marginBottom: 4,
          }}>
            {label}
          </div>
          <div style={{
            fontSize: 19, fontWeight: 700, color: 'var(--text)',
            letterSpacing: '-0.3px', marginBottom: 4,
          }}>
            {title}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 14 }}>
            Search by code, airport name, city or IATA
          </div>

          <div style={{ position: 'relative' }}>
            {busy && (
              <span style={{
                position: 'absolute', right: 14, top: '50%', marginTop: -6,
                width: 12, height: 12, borderRadius: '50%', boxSizing: 'border-box',
                border: '2px solid var(--border)', borderTopColor: 'var(--accent)',
                animation: 'apt-spin 0.9s linear infinite', zIndex: 2,
              }} />
            )}
            <input
              ref={inputRef}
              value={value}
              onChange={handleChange}
              onKeyDown={e => { if (e.key === 'Enter' && top) { e.preventDefault(); pick(top.ident) } }}
              placeholder={placeholder}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              style={{
                width: '100%', boxSizing: 'border-box',
                padding: '13px 34px 13px 14px',
                // Codes keep the monospace treatment the old picker had. A
                // place name gets normal text — "Barrie-Lake Simcoe" in
                // wide-tracked monospace neither fits nor reads.
                fontSize: identish ? 24 : 17,
                fontWeight: 700,
                letterSpacing: identish ? '0.1em' : '0',
                textTransform: identish ? 'uppercase' : 'none',
                fontFamily: identish
                  ? 'monospace'
                  : '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
                background: 'var(--bg-card-2)',
                border: '0.5px solid var(--border)',
                borderRadius: 12,
                color: 'var(--text)',
                outline: 'none',
                caretColor: 'var(--text)',
              }}
            />
          </div>

          {note === 'nearby' && (
            <div style={{
              fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
              textTransform: 'uppercase', color: 'var(--text-tertiary)',
              margin: '14px 2px 6px',
            }}>
              Nearest to you
            </div>
          )}

          {results.length > 0 && (
            <div style={{
              marginTop: note === 'nearby' ? 0 : 12,
              background: 'var(--bg-card-2)',
              border: '0.5px solid var(--border)',
              borderRadius: 12,
              overflow: 'hidden',
              maxHeight: 264, overflowY: 'auto',
              WebkitOverflowScrolling: 'touch',
            }}>
              {results.map((r, i) => (
                <ResultRow key={r.ident + i} r={r} first={i === 0} onPick={pick} />
              ))}
            </div>
          )}

          {note === 'none' && !busy && (
            <div style={{ fontSize: 12, color: 'var(--danger)', fontWeight: 600, margin: '12px 2px 0' }}>
              No airport matches “{value.trim()}”
            </div>
          )}

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
              onClick={() => top && pick(top.ident)}
              disabled={!top}
              style={{
                flex: 1, padding: '12px 0', borderRadius: 12,
                background: top ? 'var(--accent)' : 'var(--accent-light)',
                border: 'none',
                color: top ? 'var(--accent-fg)' : 'var(--text-tertiary)',
                fontSize: 14, fontWeight: 700,
                cursor: top ? 'pointer' : 'default',
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
