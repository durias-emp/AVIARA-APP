import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { BackButton } from '../../components/Shell'
import { useLogbook } from '../../context/Logbook'
import { useActiveAircraft } from '../../context/ActiveAircraft'
import { parseForeFlightCsv, matchAircraftId } from '../../lib/logbookImport'
import { pdfPagesToImages } from '../../lib/pdfToImages'
import { extractLogbookPageFromDataUrl } from '../../lib/extractLogbookPage'

function fmtDate(iso) {
  if (!iso) return 'No date'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// Second-level screen (BackButton + navigate(-1), same pattern as the rest
// of the Logbook section) reached from LogbookList's Import entry point.
// Never commits anything until the pilot explicitly confirms — same "review
// before save" principle as the AI photo-extraction flow elsewhere in this
// app (Aircraft.jsx's performance chart scanning): imported data may end up
// on a certificate application, so showing exactly what will be added
// before it happens matters more here than almost anywhere else in the app.
export default function LogbookImport() {
  const navigate = useNavigate()
  const { addEntries } = useLogbook()
  const { aircraftList } = useActiveAircraft()
  const [parsed, setParsed] = useState(null)
  const [reading, setReading] = useState(false)
  const [pdfProgress, setPdfProgress] = useState(null) // { page, total } while OCR'ing a PDF
  const [readError, setReadError] = useState(null)
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState(null)
  const [done, setDone] = useState(false)
  const fileRef = useRef(null)
  // useActiveAircraft's aircraftList starts undefined while it loads — if a
  // file got parsed before it resolved, aircraft matching would silently
  // run against an empty list and mark every flight "not in Hangar" even
  // when the registration is right there. Gate the picker on it instead of
  // letting that race happen.
  const aircraftReady = aircraftList !== undefined

  function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
    if (isPdf) {
      handlePdf(file)
    } else {
      const reader = new FileReader()
      reader.onload = () => {
        setParsed(parseForeFlightCsv(String(reader.result), { aircraftList: aircraftList ?? [] }))
      }
      reader.readAsText(file)
    }
  }

  // A PDF logbook export (ForeFlight's own "Print"/PDF export, or any other
  // app's) is a formatted table, not the "Aircraft Table"/"Flights Table"
  // CSV structure — rather than a separate raw-PDF-text/table parser (far
  // more fragile for spacing-based tables), each page is rendered to an
  // image and run through the same OCR pipeline as a photographed logbook
  // page (see pdfToImages.js's header comment). One page at a time, since
  // each is its own AI request.
  async function handlePdf(file) {
    setReading(true)
    setReadError(null)
    try {
      const images = await pdfPagesToImages(file)
      const flights = []
      for (let i = 0; i < images.length; i++) {
        setPdfProgress({ page: i + 1, total: images.length })
        const pageEntries = await extractLogbookPageFromDataUrl(images[i])
        for (const entry of pageEntries) {
          flights.push(matchAircraftId({ ...entry, source: 'import' }, aircraftList ?? []))
        }
      }
      setParsed({ flights, unrecognizedColumns: [] })
    } catch (err) {
      setReadError(err.message)
    }
    setReading(false)
    setPdfProgress(null)
  }

  async function handleImport() {
    if (!parsed?.flights?.length) return
    setImporting(true)
    setImportError(null)
    try {
      // One bulk write (see Logbook context's addEntries / db.js's
      // putMany), not a per-flight loop — looping addEntry here is what
      // made a several-hundred-row import effectively hang (each write was
      // re-uploading the entire, growing store to the cloud).
      await addEntries(parsed.flights)
      setDone(true)
    } catch (err) {
      // Without this, a thrown error here (a failed IndexedDB transaction,
      // a sync error) left the button stuck on "Importing…" forever with
      // no indication anything had gone wrong — this is exactly that.
      setImportError(err?.message || 'Import failed — try again.')
    } finally {
      setImporting(false)
    }
  }

  const unmatchedCount = parsed?.flights?.filter(f => f.aircraftReg && !f.aircraftId).length ?? 0

  return (
    <div style={{ paddingBottom: 40 }}>
      <div style={{ padding: '20px 20px 0', display: 'flex', alignItems: 'center', gap: 12 }}>
        <BackButton onBack={() => navigate(-1)} />
        <h2 style={{
          fontSize: 24, fontWeight: 700, letterSpacing: '-0.4px', color: 'var(--text)',
          fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
        }}>Import Logbook</h2>
      </div>

      <div style={{ padding: '16px 18px 0' }}>
        {done ? (
          <div style={{
            background: 'var(--bg-card)', borderRadius: 16, boxShadow: 'var(--shadow-sm)',
            padding: '24px 16px', textAlign: 'center',
          }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>Imported</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
              {parsed.flights.length} {parsed.flights.length === 1 ? 'flight' : 'flights'} added to your Logbook.
            </div>
            <button onClick={() => navigate('/logbook')} style={{
              padding: '11px 20px', borderRadius: 'var(--r-sm)', border: 'none',
              background: 'var(--accent)', color: 'var(--accent-fg)', fontSize: 14, fontWeight: 700, cursor: 'pointer',
            }}>Go to Logbook</button>
          </div>
        ) : reading ? (
          <div style={{
            background: 'var(--bg-card)', borderRadius: 16, boxShadow: 'var(--shadow-sm)',
            padding: '24px 16px', textAlign: 'center', fontSize: 13, color: 'var(--text-secondary)',
          }}>
            {pdfProgress ? `Reading page ${pdfProgress.page} of ${pdfProgress.total}…` : 'Reading file…'}
          </div>
        ) : !parsed ? (
          <div style={{
            background: 'var(--bg-card)', borderRadius: 16, boxShadow: 'var(--shadow-sm)',
            padding: '24px 16px', textAlign: 'center',
          }}>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16, lineHeight: 1.5 }}>
              Export your logbook as a CSV from ForeFlight (Logbook → Import/Export → Download), or pick a PDF export from ForeFlight or another logbook app — each page is read individually, so a multi-page PDF works too.
            </div>
            {readError && <div style={{ fontSize: 12, color: 'var(--danger)', marginBottom: 12 }}>{readError}</div>}
            {!aircraftReady && (
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 12 }}>Loading your Hangar aircraft…</div>
            )}
            <button
              onClick={() => fileRef.current?.click()}
              disabled={!aircraftReady}
              style={{
                padding: '11px 20px', borderRadius: 'var(--r-sm)', border: 'none',
                background: 'var(--accent)', color: 'var(--accent-fg)', fontSize: 14, fontWeight: 700,
                cursor: aircraftReady ? 'pointer' : 'default', opacity: aircraftReady ? 1 : 0.6,
              }}
            >Choose CSV or PDF File</button>
            <input ref={fileRef} type="file" accept=".csv,text/csv,.pdf,application/pdf" onChange={handleFile} style={{ display: 'none' }} />
          </div>
        ) : parsed.error ? (
          <div style={{
            background: 'var(--bg-card)', borderRadius: 16, boxShadow: 'var(--shadow-sm)',
            padding: '20px 16px', textAlign: 'center',
          }}>
            <div style={{ fontSize: 13, color: 'var(--danger)', marginBottom: 16 }}>{parsed.error}</div>
            <button onClick={() => setParsed(null)} style={{
              padding: '10px 18px', borderRadius: 'var(--r-sm)', border: '0.5px solid var(--border)',
              background: 'var(--bg-card-2)', color: 'var(--text)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}>Try another file</button>
          </div>
        ) : (
          <>
            <div style={{
              display: 'flex', justifyContent: 'space-around', textAlign: 'center',
              background: 'var(--bg-card)', borderRadius: 16, boxShadow: 'var(--shadow-sm)',
              padding: '16px', marginBottom: 14,
            }}>
              <div>
                <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)' }}>{parsed.flights.length}</div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>Flights Found</div>
              </div>
              <div>
                <div style={{ fontSize: 22, fontWeight: 800, color: unmatchedCount ? 'var(--warn)' : 'var(--text)' }}>{unmatchedCount}</div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>Unmatched Aircraft</div>
              </div>
            </div>

            {parsed.unrecognizedColumns.length > 0 && (
              <div style={{
                background: 'var(--warn-light)', borderRadius: 14, padding: '12px 14px', marginBottom: 14,
                fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5,
              }}>
                <strong style={{ color: 'var(--text)' }}>Not imported (unrecognized columns):</strong> {parsed.unrecognizedColumns.join(', ')}
              </div>
            )}

            <div style={{ background: 'var(--bg-card)', borderRadius: 16, boxShadow: 'var(--shadow-sm)', overflow: 'hidden', marginBottom: 16 }}>
              {parsed.flights.slice(0, 8).map((f, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '11px 14px', borderTop: i === 0 ? 'none' : '0.5px solid var(--border)',
                }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{fmtDate(f.date)}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 1 }}>
                      {[f.from, f.to].filter(Boolean).join(' → ') || 'No route'}{f.aircraftReg ? ` · ${f.aircraftReg}` : ''}
                      {f.aircraftReg && !f.aircraftId && <span style={{ color: 'var(--warn)' }}> (not in Hangar)</span>}
                    </div>
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{f.totalTime ? `${f.totalTime} hr` : '—'}</span>
                </div>
              ))}
              {parsed.flights.length > 8 && (
                <div style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text-tertiary)', textAlign: 'center' }}>
                  + {parsed.flights.length - 8} more
                </div>
              )}
            </div>

            {importError && (
              <div style={{ fontSize: 12, color: 'var(--danger)', marginBottom: 10 }}>{importError}</div>
            )}
            <button
              onClick={handleImport}
              disabled={importing}
              style={{
                width: '100%', padding: '13px', borderRadius: 'var(--r-sm)', border: 'none',
                background: 'var(--accent)', color: 'var(--accent-fg)',
                fontSize: 15, fontWeight: 700, cursor: importing ? 'default' : 'pointer',
                opacity: importing ? 0.7 : 1, marginBottom: 10,
              }}
            >{importing ? 'Importing…' : `Import ${parsed.flights.length} ${parsed.flights.length === 1 ? 'Flight' : 'Flights'}`}</button>
            <button
              onClick={() => setParsed(null)}
              style={{
                width: '100%', padding: '11px', borderRadius: 'var(--r-sm)', border: '0.5px solid var(--border)',
                background: 'var(--bg-card-2)', color: 'var(--text)', fontSize: 14, fontWeight: 600, cursor: 'pointer',
              }}
            >Choose a Different File</button>
          </>
        )}
      </div>
    </div>
  )
}
