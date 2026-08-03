import { useEffect, useRef, useState } from 'react'
import { IconChevronLeft } from '../../components/Icons'
import { createListing, ENGINE_TYPES, CURRENCIES } from '../../lib/listings'
import { SPEC_SECTIONS } from '../../lib/listingSpecs'

// Posting an aircraft for sale.
//
// Long by nature — this is the form where being thorough is the point, since
// every field a seller skips is a message a buyer has to send. So it's
// organised the way an aircraft ad is read rather than the way the table is
// shaped: the headline facts first, then photos, then the spec sheet in
// collapsible sections so the length is browsable instead of daunting.
//
// Only make-or-model is required. A seller who knows their tail number and
// nothing else can still list, and fill the rest in later.

const MAX_PHOTOS = 12

function Field({ label, unit, children }) {
  return (
    <label style={{ display: 'block', marginBottom: 12 }}>
      <span style={{
        display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '0.04em',
        textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 5,
      }}>
        {label}{unit ? ` (${unit})` : ''}
      </span>
      {children}
    </label>
  )
}

const inputStyle = {
  width: '100%', boxSizing: 'border-box', padding: '11px 12px',
  borderRadius: 10, border: 'none', background: 'var(--bg-card-2)',
  color: 'var(--text)', fontSize: 15, fontFamily: 'inherit', outline: 'none',
}

function Text({ value, onChange, ...rest }) {
  return <input value={value ?? ''} onChange={e => onChange(e.target.value)} style={inputStyle} {...rest} />
}

function Select({ value, onChange, options, placeholder = '—' }) {
  return (
    <select value={value ?? ''} onChange={e => onChange(e.target.value)} style={{ ...inputStyle, appearance: 'none' }}>
      <option value="">{placeholder}</option>
      {options.map(o => (
        <option key={typeof o === 'string' ? o : o.key} value={typeof o === 'string' ? o : o.key}>
          {typeof o === 'string' ? o : o.label}
        </option>
      ))}
    </select>
  )
}

function Section({ title, open, onToggle, children, filled }) {
  return (
    <div style={{ borderTop: '0.5px solid var(--border)' }}>
      <button
        onClick={onToggle}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 8,
          padding: '14px 0', border: 'none', background: 'transparent',
          cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
          WebkitTapHighlightColor: 'transparent',
        }}>
        <span style={{ flex: 1, fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{title}</span>
        {filled > 0 && (
          <span style={{
            fontSize: 10, fontWeight: 700, color: 'var(--accent)',
            background: 'var(--accent-light)', padding: '2px 7px', borderRadius: 9,
          }}>{filled}</span>
        )}
        <span style={{
          color: 'var(--text-tertiary)', fontSize: 13,
          transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.18s',
        }}>›</span>
      </button>
      {open && <div style={{ paddingBottom: 8 }}>{children}</div>}
    </div>
  )
}

export default function ListingForm({ sellerId, onClose, onCreated }) {
  const [fields, setFields] = useState({
    make: '', model: '', year: '', registration: '', price_usd: '', currency: 'USD',
    location: '', total_time_hours: '', engine_time_hours: '', engine_type: '', description: '',
  })
  const [specs, setSpecs] = useState({})
  const [files, setFiles] = useState([])
  const [previews, setPreviews] = useState([])
  const [openSection, setOpenSection] = useState(SPEC_SECTIONS[0].title)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(null)
  const [error, setError] = useState(null)
  const inputRef = useRef(null)

  useEffect(() => {
    const urls = files.map(f => URL.createObjectURL(f))
    setPreviews(urls)
    return () => urls.forEach(URL.revokeObjectURL)
  }, [files])

  const set = (k, v) => setFields(f => ({ ...f, [k]: v }))
  const setSpec = (k, v) => setSpecs(s => ({ ...s, [k]: v }))

  const canPost = fields.make.trim() || fields.model.trim()

  async function submit() {
    if (!canPost || busy) return
    setBusy(true)
    setError(null)
    const { error: err } = await createListing({
      sellerId, fields, specs, files,
      onProgress: (done, total) => setProgress({ done, total }),
    })
    setBusy(false)
    setProgress(null)
    if (err) { setError(err.message || 'Could not post that listing.'); return }
    onCreated?.()
    onClose()
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 600, background: 'var(--bg)',
      display: 'flex', flexDirection: 'column',
      paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '14px 14px 10px',
        borderBottom: '0.5px solid var(--border)',
      }}>
        <button onClick={onClose} aria-label="Back" style={{
          width: 34, height: 34, borderRadius: '50%', border: 'none', background: 'var(--bg-card-2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', color: 'var(--text)', WebkitTapHighlightColor: 'transparent',
        }}>
          <IconChevronLeft size={18} />
        </button>
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', flex: 1 }}>List an aircraft</div>
        <button
          onClick={submit}
          disabled={!canPost || busy}
          style={{
            padding: '9px 18px', borderRadius: 20, border: 'none', fontFamily: 'inherit',
            fontSize: 14, fontWeight: 700, cursor: (!canPost || busy) ? 'default' : 'pointer',
            background: (!canPost || busy) ? 'var(--bg-card-2)' : 'var(--text)',
            color: (!canPost || busy) ? 'var(--text-tertiary)' : 'var(--bg)',
          }}>
          {busy ? (progress ? `${progress.done}/${progress.total}` : 'Posting…') : 'Post'}
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 32px' }}>
        {/* Photos first: it's the first thing a buyer looks at, so it should
            be the first thing a seller is prompted for. */}
        <div style={{
          fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
          color: 'var(--text-tertiary)', marginBottom: 8,
        }}>Photos</div>
        <input
          ref={inputRef} type="file" accept="image/*" multiple
          onChange={e => {
            const picked = [...e.target.files].filter(f => f.type.startsWith('image/'))
            setFiles(prev => [...prev, ...picked].slice(0, MAX_PHOTOS))
            e.target.value = ''
          }}
          style={{ display: 'none' }}
        />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 20 }}>
          {previews.map((src, i) => (
            <div key={src} style={{
              position: 'relative', aspectRatio: '4 / 3', borderRadius: 10,
              overflow: 'hidden', background: 'var(--bg-card-2)',
            }}>
              <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              {i === 0 && (
                <span style={{
                  position: 'absolute', left: 5, bottom: 5, background: 'rgba(0,0,0,0.6)',
                  color: '#fff', fontSize: 9, fontWeight: 700, padding: '2px 5px', borderRadius: 4,
                }}>COVER</span>
              )}
              {!busy && (
                <button onClick={() => setFiles(p => p.filter((_, n) => n !== i))} aria-label="Remove" style={{
                  position: 'absolute', top: 5, right: 5, width: 22, height: 22, borderRadius: '50%',
                  border: 'none', background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 14,
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: 'inherit', lineHeight: 1,
                }}>×</button>
              )}
            </div>
          ))}
          {files.length < MAX_PHOTOS && !busy && (
            <button onClick={() => inputRef.current?.click()} style={{
              aspectRatio: '4 / 3', borderRadius: 10, cursor: 'pointer',
              border: '1.5px dashed var(--border)', background: 'transparent',
              color: 'var(--text-tertiary)', fontSize: 24, fontFamily: 'inherit',
            }}>+</button>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 10px' }}>
          <Field label="Make"><Text value={fields.make} onChange={v => set('make', v)} placeholder="Cessna" /></Field>
          <Field label="Model"><Text value={fields.model} onChange={v => set('model', v)} placeholder="172S" /></Field>
          <Field label="Year"><Text value={fields.year} onChange={v => set('year', v)} inputMode="numeric" placeholder="2004" /></Field>
          <Field label="Registration"><Text value={fields.registration} onChange={v => set('registration', v)} placeholder="C-GXYZ" /></Field>
          <Field label="Price"><Text value={fields.price_usd} onChange={v => set('price_usd', v)} inputMode="numeric" placeholder="185000" /></Field>
          <Field label="Currency"><Select value={fields.currency} onChange={v => set('currency', v)} options={CURRENCIES} placeholder="USD" /></Field>
          <Field label="Total time" unit="hrs"><Text value={fields.total_time_hours} onChange={v => set('total_time_hours', v)} inputMode="numeric" /></Field>
          <Field label="Engine time" unit="hrs"><Text value={fields.engine_time_hours} onChange={v => set('engine_time_hours', v)} inputMode="numeric" /></Field>
        </div>

        <Field label="Engine type">
          <Select value={fields.engine_type} onChange={v => set('engine_type', v)} options={ENGINE_TYPES} />
        </Field>
        <Field label="Location">
          <Text value={fields.location} onChange={v => set('location', v)} placeholder="Barrie, ON" />
        </Field>
        <Field label="Description">
          <textarea
            value={fields.description}
            onChange={e => set('description', e.target.value)}
            rows={4}
            placeholder="How it's been flown, why you're selling, anything a buyer should know."
            style={{ ...inputStyle, resize: 'vertical' }}
          />
        </Field>

        <div style={{
          fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
          color: 'var(--text-tertiary)', margin: '20px 0 2px',
        }}>Specifications</div>
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 6, lineHeight: 1.5 }}>
          All optional — but every blank is a question a buyer has to message you about.
        </div>

        {SPEC_SECTIONS.map(section => {
          const filled = section.fields.filter(f => (specs[f.key] ?? '') !== '').length
          return (
            <Section
              key={section.title}
              title={section.title}
              filled={filled}
              open={openSection === section.title}
              onToggle={() => setOpenSection(t => (t === section.title ? null : section.title))}
            >
              {section.fields.map(f => (
                <Field key={f.key} label={f.label} unit={f.unit}>
                  {f.type === 'select' ? (
                    <Select value={specs[f.key]} onChange={v => setSpec(f.key, v)} options={f.options} />
                  ) : f.type === 'textarea' ? (
                    <textarea
                      value={specs[f.key] ?? ''}
                      onChange={e => setSpec(f.key, e.target.value)}
                      rows={3}
                      placeholder={f.placeholder}
                      style={{ ...inputStyle, resize: 'vertical' }}
                    />
                  ) : (
                    <Text
                      value={specs[f.key]}
                      onChange={v => setSpec(f.key, v)}
                      placeholder={f.placeholder}
                      inputMode={f.type === 'number' ? 'numeric' : undefined}
                    />
                  )}
                </Field>
              ))}
            </Section>
          )
        })}

        {error && (
          <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 14, lineHeight: 1.5 }}>{error}</div>
        )}
      </div>
    </div>
  )
}
