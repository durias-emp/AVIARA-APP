import { useCallback, useEffect, useRef, useState } from 'react'
import { SegControl } from './SegControl'
import { renderFlightImage, SHARE_SIZES } from '../lib/flightImage'
import { useLogbook } from '../context/Logbook'
import { computeTotalHours } from '../lib/logbookFields'

const MODES = [
  { key: 'bare',  label: 'Trail only' },
  { key: 'map',   label: 'Over map' },
  { key: 'photo', label: 'My photo' },
]

// Turning a flight into something postable.
//
// The preview is the real render, not an approximation of it — the same
// function produces the pixels shown here and the file that leaves the app, so
// what the pilot approves is what their followers see.
export default function FlightShareSheet({ entry, onClose }) {
  const [mode, setMode] = useState('bare')
  const [size, setSize] = useState('square')
  // The pilot's own background, held as a data URL so it survives being handed
  // to an Image and drawn on a canvas that then has to be exported. A blob URL
  // from a local file would work too, but a data URL cannot be revoked out from
  // under a render that is still in flight.
  const [photo, setPhoto] = useState(null)
  const fileInput = useRef(null)

  // The pilot's running total, which is the one figure on the card that is not
  // about this flight. Read here rather than in the renderer so the renderer
  // stays a pure function of what it is given.
  const { entries } = useLogbook()
  const totalPilotHours = computeTotalHours(entries)
  // One piece of state carrying the finished render and what it was rendered
  // for. "Still working" is then derived — it is true exactly while the result
  // in hand does not match the options on screen — rather than being flipped
  // on at the top of the effect, which would set state during render.
  const [result, setResult] = useState(null)

  const busy = !result || result.mode !== mode || result.size !== size || result.photo !== photo
  const preview = busy ? null : result.url
  const blob = busy ? null : result.blob
  const error = busy ? null : result.error

  useEffect(() => {
    let cancelled = false
    let url = null
    renderFlightImage(entry, { mode, size, photo, totalPilotHours })
      .then(rendered => {
        if (cancelled) return
        url = URL.createObjectURL(rendered.blob)
        setResult({
          mode, size, photo, url, blob: rendered.blob,
          // The renderer falls back to the plain trail if the tiles cannot be
          // exported. Saying so beats silently returning something other than
          // what was asked for.
          error: rendered.mode !== mode
            ? (mode === 'photo'
              ? 'That picture could not be read, so this is the plain trail.'
              : 'The map background could not be loaded, so this is the plain trail.')
            : null,
        })
      })
      .catch(err => {
        if (!cancelled) setResult({ mode, size, photo, url: null, blob: null, error: err.message })
      })
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [entry, mode, size, photo, totalPilotHours])

  const fileName = `aviara-${entry?.date ?? 'flight'}.png`

  // The OS share sheet, where the pilot picks the destination. The app never
  // posts anywhere itself — it hands over a file and the pilot decides.
  const share = useCallback(async () => {
    if (!blob) return
    const file = new File([blob], fileName, { type: 'image/png' })
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file] }) } catch { /* dismissed */ }
      return
    }
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    a.click()
    URL.revokeObjectURL(url)
  }, [blob, fileName])

  const canShareFiles = typeof navigator !== 'undefined' && !!navigator.canShare

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 520, background: 'var(--bg)',
          borderTopLeftRadius: 22, borderTopRightRadius: 22,
          padding: `18px 18px calc(var(--safe-bottom) + 18px)`,
          maxHeight: '92dvh', overflowY: 'auto', boxSizing: 'border-box',
        }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <span style={{ fontSize: 17, fontWeight: 800, color: 'var(--text)' }}>Share flight</span>
          <button onClick={onClose} aria-label="Close" style={{
            width: 30, height: 30, borderRadius: '50%', border: 'none',
            background: 'var(--bg-card-2)', color: 'var(--text)', cursor: 'pointer', fontSize: 16,
          }}>×</button>
        </div>

        <div style={{ display: 'grid', gap: 10, marginBottom: 14 }}>
          <SegControl
            options={MODES.map(m => m.label)}
            value={MODES.find(m => m.key === mode).label}
            onChange={label => setMode(MODES.find(m => m.label === label).key)}
          />

          {/* Only once the pilot has asked for their own background. Offering a
              file picker under the map mode would be a control with nothing to
              control. */}
          {mode === 'photo' && (
            <>
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={e => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  const reader = new FileReader()
                  reader.onload = () => setPhoto(reader.result)
                  // A picture that cannot be read is not worth a dialog: the
                  // card falls back to the plain trail and says so.
                  reader.onerror = () => setPhoto(null)
                  reader.readAsDataURL(file)
                }} />
              <button
                onClick={() => fileInput.current?.click()}
                style={{
                  padding: '12px 14px', borderRadius: 14, border: '1px solid var(--border)',
                  background: 'var(--bg-card)', color: 'var(--text)',
                  fontSize: 13, fontWeight: 700, cursor: 'pointer',
                }}>
                {photo ? 'Choose a different picture' : 'Choose a picture'}
              </button>
            </>
          )}
          <SegControl
            options={Object.values(SHARE_SIZES).map(s => s.label)}
            value={SHARE_SIZES[size].label}
            onChange={label => setSize(Object.keys(SHARE_SIZES).find(k => SHARE_SIZES[k].label === label))}
          />
        </div>

        {/* A checkerboard behind the preview, so "no background" is visibly
            transparency rather than an accidental white rectangle. */}
        <div style={{
          borderRadius: 16, overflow: 'hidden', marginBottom: 14,
          minHeight: 200, display: 'flex', alignItems: 'center', justifyContent: 'center',
          backgroundColor: '#e9ecf2',
          backgroundImage: 'linear-gradient(45deg, #d4d9e3 25%, transparent 25%), linear-gradient(-45deg, #d4d9e3 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #d4d9e3 75%), linear-gradient(-45deg, transparent 75%, #d4d9e3 75%)',
          backgroundSize: '18px 18px',
          backgroundPosition: '0 0, 0 9px, 9px -9px, -9px 0',
        }}>
          {busy
            ? <span style={{ fontSize: 13, color: 'var(--text-secondary)', padding: 40 }}>Rendering…</span>
            : preview
              ? <img src={preview} alt="Flight" style={{ width: '100%', display: 'block' }} />
              : <span style={{ fontSize: 13, color: 'var(--text-secondary)', padding: 40, textAlign: 'center' }}>{error}</span>}
        </div>

        {error && preview && (
          <div style={{ fontSize: 12, color: 'var(--warn)', marginBottom: 12 }}>{error}</div>
        )}

        <button
          onClick={share}
          disabled={!blob}
          style={{
            width: '100%', padding: '13px', borderRadius: 'var(--r-sm)', border: 'none',
            background: 'var(--accent)', color: 'var(--accent-fg)',
            fontSize: 15, fontWeight: 700, cursor: blob ? 'pointer' : 'default',
            opacity: blob ? 1 : 0.5,
          }}>
          {canShareFiles ? 'Share' : 'Download image'}
        </button>
      </div>
    </div>
  )
}
