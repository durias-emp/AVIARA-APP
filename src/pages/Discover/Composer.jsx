import { useEffect, useRef, useState } from 'react'
import { IconChevronLeft } from '../../components/Icons'
import { createPost } from '../../lib/posts'
import { createStory, STORY_HOURS } from '../../lib/stories'

// Making a post or a story.
//
// One screen for both, because the choice is genuinely one decision made at
// the end — the same photo, the same caption, and only the lifetime differs.
// Two separate composers would mean picking a photo, then discovering you
// wanted the other kind, then picking it again.
//
// Photos are never uploaded until Share is pressed. Previews are local object
// URLs, so backing out costs nothing and leaves nothing behind in storage —
// which matters when the alternative is orphaned objects nobody can see or
// delete.

const MAX_PHOTOS = 6

function Segmented({ value, onChange, disabled }) {
  return (
    <div style={{
      display: 'flex', background: 'rgba(120,120,128,0.16)', borderRadius: 10,
      padding: 3, gap: 3, opacity: disabled ? 0.5 : 1,
    }}>
      {['Post', 'Story'].map(k => (
        <button
          key={k}
          onClick={() => !disabled && onChange(k)}
          style={{
            flex: 1, padding: '8px 0', borderRadius: 8, border: 'none',
            cursor: disabled ? 'default' : 'pointer', fontFamily: 'inherit',
            fontSize: 13, fontWeight: 700,
            background: value === k ? 'var(--bg-card)' : 'transparent',
            color: value === k ? 'var(--text)' : 'var(--text-secondary)',
            boxShadow: value === k ? '0 1px 4px rgba(0,0,0,0.12)' : 'none',
            WebkitTapHighlightColor: 'transparent',
          }}>{k}</button>
      ))}
    </div>
  )
}

export default function Composer({ myId, initialKind = 'Post', onClose, onPosted }) {
  // Opens on whichever the pilot asked for — the story ring starts a story,
  // the plus button starts a post — while leaving the toggle free either way.
  const [kind, setKind] = useState(initialKind === 'Story' ? 'Story' : 'Post')
  const [files, setFiles] = useState([])
  const [previews, setPreviews] = useState([])
  const [caption, setCaption] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(null)
  const [error, setError] = useState(null)
  const inputRef = useRef(null)

  // Object URLs are a manual allocation — revoked together when the set
  // changes or the composer closes, or a long session leaks every photo the
  // pilot ever previewed.
  useEffect(() => {
    const urls = files.map(f => URL.createObjectURL(f))
    setPreviews(urls)
    return () => urls.forEach(URL.revokeObjectURL)
  }, [files])

  // A story is one photo by definition, so switching to it trims the
  // selection rather than silently posting only the first.
  useEffect(() => {
    if (kind === 'Story' && files.length > 1) setFiles(f => f.slice(0, 1))
  }, [kind, files.length])

  function addFiles(list) {
    const picked = [...list].filter(f => f.type.startsWith('image/'))
    if (!picked.length) return
    setError(null)
    setFiles(prev => [...prev, ...picked].slice(0, kind === 'Story' ? 1 : MAX_PHOTOS))
  }

  function removeAt(i) {
    setFiles(prev => prev.filter((_, n) => n !== i))
  }

  const canShare = kind === 'Story' ? files.length === 1 : (files.length > 0 || caption.trim().length > 0)

  async function share() {
    if (!canShare || busy) return
    setBusy(true)
    setError(null)
    setProgress(files.length > 1 ? { done: 0, total: files.length } : null)

    const result = kind === 'Story'
      ? await createStory({ authorId: myId, file: files[0], caption })
      : await createPost({
          authorId: myId, caption, files,
          onProgress: (done, total) => setProgress({ done, total }),
        })

    setBusy(false)
    setProgress(null)
    if (result.error) {
      setError(result.error.message || 'Could not share that — try again.')
      return
    }
    onPosted?.(kind)
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
        <button
          onClick={onClose}
          aria-label="Back"
          style={{
            width: 34, height: 34, borderRadius: '50%', border: 'none', background: 'var(--bg-card-2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', color: 'var(--text)', WebkitTapHighlightColor: 'transparent',
          }}>
          <IconChevronLeft size={18} />
        </button>
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', flex: 1 }}>
          New {kind.toLowerCase()}
        </div>
        <button
          onClick={share}
          disabled={!canShare || busy}
          style={{
            padding: '9px 18px', borderRadius: 20, border: 'none', fontFamily: 'inherit',
            fontSize: 14, fontWeight: 700, cursor: (!canShare || busy) ? 'default' : 'pointer',
            background: (!canShare || busy) ? 'var(--bg-card-2)' : 'var(--text)',
            color: (!canShare || busy) ? 'var(--text-tertiary)' : 'var(--bg)',
            WebkitTapHighlightColor: 'transparent',
          }}>
          {busy ? (progress ? `${progress.done}/${progress.total}` : 'Sharing…') : 'Share'}
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px 24px' }}>
        <Segmented value={kind} onChange={setKind} disabled={busy} />
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', margin: '8px 2px 16px', lineHeight: 1.5 }}>
          {kind === 'Story'
            ? `One photo, visible for ${STORY_HOURS} hours, then it disappears.`
            : 'Stays on your profile until you delete it.'}
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple={kind === 'Post'}
          onChange={e => { addFiles(e.target.files); e.target.value = '' }}
          style={{ display: 'none' }}
        />

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 16 }}>
          {previews.map((src, i) => (
            <div key={src} style={{
              position: 'relative', aspectRatio: '1 / 1', borderRadius: 10, overflow: 'hidden',
              background: 'var(--bg-card-2)',
            }}>
              <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              {!busy && (
                <button
                  onClick={() => removeAt(i)}
                  aria-label="Remove photo"
                  style={{
                    position: 'absolute', top: 5, right: 5, width: 22, height: 22, borderRadius: '50%',
                    border: 'none', background: 'rgba(0,0,0,0.6)', color: '#fff',
                    fontSize: 14, lineHeight: 1, cursor: 'pointer', display: 'flex',
                    alignItems: 'center', justifyContent: 'center', fontFamily: 'inherit',
                  }}>×</button>
              )}
            </div>
          ))}
          {(kind === 'Post' ? files.length < MAX_PHOTOS : files.length < 1) && !busy && (
            <button
              onClick={() => inputRef.current?.click()}
              style={{
                aspectRatio: '1 / 1', borderRadius: 10, cursor: 'pointer',
                border: '1.5px dashed var(--border)', background: 'transparent',
                color: 'var(--text-tertiary)', fontSize: 26, fontFamily: 'inherit',
                WebkitTapHighlightColor: 'transparent',
              }}>+</button>
          )}
        </div>

        <textarea
          value={caption}
          onChange={e => setCaption(e.target.value)}
          placeholder={kind === 'Story' ? 'Add a caption (optional)' : 'Write something…'}
          rows={4}
          maxLength={2000}
          disabled={busy}
          style={{
            width: '100%', boxSizing: 'border-box', padding: 14, borderRadius: 12,
            border: 'none', background: 'var(--bg-card-2)', color: 'var(--text)',
            fontSize: 15, fontFamily: 'inherit', resize: 'vertical', outline: 'none',
          }}
        />

        {error && (
          <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 10, lineHeight: 1.5 }}>{error}</div>
        )}
      </div>
    </div>
  )
}
