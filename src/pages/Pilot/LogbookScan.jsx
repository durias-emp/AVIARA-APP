import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { BackButton } from '../../components/Shell'
import { useLogbook } from '../../context/Logbook'
import { useActiveAircraft } from '../../context/ActiveAircraft'
import { extractLogbookPage } from '../../lib/extractLogbookPage'

function EditableField({ value, onChange, placeholder, width }) {
  return (
    <input
      value={value ?? ''} placeholder={placeholder} onChange={e => onChange(e.target.value)}
      style={{
        width, boxSizing: 'border-box', padding: '7px 8px', borderRadius: 8,
        border: 'none', background: 'var(--bg-card)', color: 'var(--text)',
        fontSize: 12, outline: 'none', fontFamily: 'inherit',
      }}
    />
  )
}

// Photo → AI extraction → editable draft review, same template as
// Aircraft.jsx's PerformanceChartsSection photo-extraction flow (see
// api/extract-logbook-page.js's header comment). Handwritten logbooks are
// the single most error-prone source this app extracts from, so unlike the
// GPS auto-detect flow (which defers review via a pendingReview flag) this
// screen puts every field in an editable input right in the review list —
// the pilot fixes obvious misreads before anything is ever saved, not after.
export default function LogbookScan() {
  const navigate = useNavigate()
  const { addEntries } = useLogbook()
  const { aircraftList } = useActiveAircraft()
  const [status, setStatus] = useState('idle') // 'idle' | 'extracting' | 'reviewing' | 'saving' | 'done'
  const [drafts, setDrafts] = useState([])
  const [error, setError] = useState(null)
  const [savedCount, setSavedCount] = useState(0)
  const fileRef = useRef(null)

  async function handlePhoto(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setStatus('extracting')
    setError(null)
    try {
      const entries = await extractLogbookPage(file)
      setDrafts(entries.map((entry, i) => ({ ...entry, _key: i })))
      setStatus('reviewing')
    } catch (err) {
      setError(err.message)
      setStatus('idle')
    }
  }

  function updateDraft(key, field, value) {
    setDrafts(ds => ds.map(d => d._key === key ? { ...d, [field]: value } : d))
  }

  function removeDraft(key) {
    setDrafts(ds => ds.filter(d => d._key !== key))
  }

  async function handleSaveAll() {
    setStatus('saving')
    const aircraftByReg = Object.fromEntries(
      (aircraftList ?? []).filter(a => a.registration).map(a => [a.registration.toUpperCase(), a])
    )
    // One bulk write (see Logbook context's addEntries), not a per-entry
    // loop — same reasoning as LogbookImport.jsx's fix, just a smaller batch
    // here since a scanned page is usually one aircraft's worth of rows.
    const rows = drafts.map(draft => {
      const rest = { ...draft }
      delete rest._key
      const match = draft.aircraftReg ? aircraftByReg[String(draft.aircraftReg).toUpperCase()] : null
      return { ...rest, aircraftId: match?.id ?? null, source: 'scan' }
    })
    await addEntries(rows)
    setSavedCount(drafts.length)
    setStatus('done')
  }

  return (
    <div style={{ paddingBottom: 40 }}>
      <div style={{ padding: '20px 20px 0', display: 'flex', alignItems: 'center', gap: 12 }}>
        <BackButton onBack={() => navigate(-1)} />
        <h2 style={{
          fontSize: 24, fontWeight: 700, letterSpacing: '-0.4px', color: 'var(--text)',
          fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
        }}>Scan Logbook</h2>
      </div>

      <div style={{ padding: '16px 18px 0' }}>
        {status === 'done' ? (
          <div style={{
            background: 'var(--bg-card)', borderRadius: 16, boxShadow: 'var(--shadow-sm)',
            padding: '24px 16px', textAlign: 'center',
          }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>Saved</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
              {savedCount} {savedCount === 1 ? 'flight' : 'flights'} added to your Logbook.
            </div>
            <button onClick={() => navigate('/logbook')} style={{
              padding: '11px 20px', borderRadius: 'var(--r-sm)', border: 'none',
              background: 'var(--accent)', color: 'var(--accent-fg)', fontSize: 14, fontWeight: 700, cursor: 'pointer',
            }}>Go to Logbook</button>
          </div>
        ) : status === 'idle' ? (
          <div style={{
            background: 'var(--bg-card)', borderRadius: 16, boxShadow: 'var(--shadow-sm)',
            padding: '24px 16px', textAlign: 'center',
          }}>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16, lineHeight: 1.5 }}>
              Take a photo of a logbook page, or choose one from your library. Extracted flights will be shown here for you to review and correct before saving — nothing is saved automatically.
            </div>
            {error && <div style={{ fontSize: 12, color: 'var(--danger)', marginBottom: 12 }}>{error}</div>}
            <button onClick={() => fileRef.current?.click()} style={{
              padding: '11px 20px', borderRadius: 'var(--r-sm)', border: 'none',
              background: 'var(--accent)', color: 'var(--accent-fg)', fontSize: 14, fontWeight: 700, cursor: 'pointer',
            }}>Take / Choose Photo</button>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={handlePhoto} style={{ display: 'none' }} />
          </div>
        ) : status === 'extracting' ? (
          <div style={{
            background: 'var(--bg-card)', borderRadius: 16, boxShadow: 'var(--shadow-sm)',
            padding: '24px 16px', textAlign: 'center', fontSize: 13, color: 'var(--text-secondary)',
          }}>
            Reading the page…
          </div>
        ) : (
          <>
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 12, lineHeight: 1.5 }}>
              {drafts.length} {drafts.length === 1 ? 'flight' : 'flights'} found. Check and correct each row — misread handwriting is normal — then save.
            </div>

            {drafts.length === 0 ? (
              <div style={{
                background: 'var(--bg-card)', borderRadius: 16, boxShadow: 'var(--shadow-sm)',
                padding: '20px 16px', textAlign: 'center', fontSize: 13, color: 'var(--text-tertiary)', marginBottom: 16,
              }}>
                No flights were readable on that page.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
                {drafts.map(d => (
                  <div key={d._key} style={{
                    background: 'var(--bg-card)', borderRadius: 14, boxShadow: 'var(--shadow-sm)', padding: 12,
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
                      <button onClick={() => removeDraft(d._key)} style={{
                        background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', fontSize: 12,
                      }}>Remove</button>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                      <EditableField value={d.date} onChange={v => updateDraft(d._key, 'date', v)} placeholder="Date" width="100%" />
                      <EditableField value={d.aircraftReg} onChange={v => updateDraft(d._key, 'aircraftReg', v)} placeholder="Aircraft" width="100%" />
                      <EditableField value={d.from} onChange={v => updateDraft(d._key, 'from', v)} placeholder="From" width="100%" />
                      <EditableField value={d.to} onChange={v => updateDraft(d._key, 'to', v)} placeholder="To" width="100%" />
                    </div>
                    <EditableField value={d.totalTime} onChange={v => updateDraft(d._key, 'totalTime', v)} placeholder="Total Time" width="100%" />
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={handleSaveAll}
              disabled={status === 'saving' || drafts.length === 0}
              style={{
                width: '100%', padding: '13px', borderRadius: 'var(--r-sm)', border: 'none',
                background: 'var(--accent)', color: 'var(--accent-fg)',
                fontSize: 15, fontWeight: 700, cursor: drafts.length === 0 ? 'default' : 'pointer',
                opacity: status === 'saving' || drafts.length === 0 ? 0.6 : 1, marginBottom: 10,
              }}
            >{status === 'saving' ? 'Saving…' : `Save ${drafts.length} ${drafts.length === 1 ? 'Flight' : 'Flights'}`}</button>
            <button
              onClick={() => { setDrafts([]); setStatus('idle') }}
              style={{
                width: '100%', padding: '11px', borderRadius: 'var(--r-sm)', border: '0.5px solid var(--border)',
                background: 'var(--bg-card-2)', color: 'var(--text)', fontSize: 14, fontWeight: 600, cursor: 'pointer',
              }}
            >Scan a Different Page</button>
          </>
        )}
      </div>
    </div>
  )
}
