import { useEffect, useRef, useState } from 'react'
import { timeLeft, deleteStory } from '../../lib/stories'

// Full-screen story playback for one author, tap to advance.
//
// Deliberately not auto-advancing on a timer. A timer is right for a feed
// you're idly watching; this app's stories will mostly be somebody's aircraft
// or a view from the flight deck, and being able to look at one for as long
// as you like — without racing a progress bar — is the better default here.
// The segment bars still show position, they just fill on tap rather than on
// a clock.

const SEGMENT_GAP = 3

export default function StoryViewer({ group, myId, onClose, onChanged }) {
  const [i, setI] = useState(0)
  const [deleting, setDeleting] = useState(false)
  const startX = useRef(null)

  const stories = group?.stories ?? []
  const story = stories[i]
  const mine = group?.authorId === myId

  // Bail out when the last one is dismissed rather than sitting on an empty
  // screen — also covers a story being deleted from under the viewer.
  useEffect(() => {
    if (!stories.length) onClose()
    else if (i >= stories.length) setI(stories.length - 1)
  }, [stories.length, i, onClose])

  useEffect(() => {
    const onKey = e => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight') next()
      if (e.key === 'ArrowLeft') prev()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  function next() {
    if (i < stories.length - 1) setI(i + 1)
    else onClose()
  }
  function prev() {
    if (i > 0) setI(i - 1)
  }

  async function remove() {
    if (deleting) return
    setDeleting(true)
    await deleteStory(story)
    setDeleting(false)
    onChanged?.()
    onClose()
  }

  if (!story) return null

  const author = group.author
  const handle = author?.username ? `@${author.username}` : 'Pilot'

  return (
    <div
      onClick={e => {
        // Left third goes back, the rest advances — the gesture every story
        // UI uses, so it needs no explaining.
        const x = e.clientX - e.currentTarget.getBoundingClientRect().left
        x < e.currentTarget.clientWidth / 3 ? prev() : next()
      }}
      onTouchStart={e => { startX.current = e.touches[0].clientX }}
      onTouchEnd={e => {
        const dx = e.changedTouches[0].clientX - (startX.current ?? 0)
        if (Math.abs(dx) > 60) { dx > 0 ? prev() : next() }
      }}
      style={{
        position: 'fixed', inset: 0, zIndex: 700, background: '#000',
        display: 'flex', flexDirection: 'column', cursor: 'pointer',
        paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)',
      }}>

      <div style={{ display: 'flex', gap: SEGMENT_GAP, padding: '10px 10px 0' }}>
        {stories.map((s, n) => (
          <div key={s.id} style={{
            flex: 1, height: 2.5, borderRadius: 2,
            background: n <= i ? '#fff' : 'rgba(255,255,255,0.32)',
            transition: 'background 0.2s',
          }} />
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px 8px' }}>
        <div style={{
          width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
          background: 'rgba(255,255,255,0.2)', overflow: 'hidden',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13, fontWeight: 700, color: '#fff',
        }}>
          {author?.avatar_url
            ? <img src={author.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : (author?.username?.[0]?.toUpperCase() ?? '?')}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{handle}</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)' }}>{timeLeft(story)}</div>
        </div>
        {mine && (
          <button
            onClick={e => { e.stopPropagation(); remove() }}
            style={{
              border: 'none', background: 'rgba(255,255,255,0.16)', color: '#fff',
              fontSize: 12, fontWeight: 700, padding: '6px 12px', borderRadius: 16,
              cursor: 'pointer', fontFamily: 'inherit',
            }}>{deleting ? 'Deleting…' : 'Delete'}</button>
        )}
        <button
          onClick={e => { e.stopPropagation(); onClose() }}
          aria-label="Close"
          style={{
            border: 'none', background: 'transparent', color: '#fff',
            fontSize: 24, lineHeight: 1, cursor: 'pointer', padding: '0 4px', fontFamily: 'inherit',
          }}>×</button>
      </div>

      <div style={{
        flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <img
          src={story.url}
          alt=""
          style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block' }}
        />
      </div>

      {story.caption && (
        <div style={{
          padding: '14px 18px 20px', color: '#fff', fontSize: 14, lineHeight: 1.5,
          textShadow: '0 1px 3px rgba(0,0,0,0.6)',
        }}>{story.caption}</div>
      )}
    </div>
  )
}
