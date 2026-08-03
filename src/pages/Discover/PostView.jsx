import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { IconChevronLeft, IconSend } from '../../components/Icons'
import { timeAgo, likeState, setLiked, deletePost } from '../../lib/posts'
import { listComments, addComment, deleteComment } from '../../lib/comments'

// One post with its comment thread.
//
// Serves two entrances that would otherwise need two components: tapping the
// comment icon in the feed, and opening a shared /p/<id> link. Both want the
// same thing — the whole post and everything said about it — so this fetches
// by id rather than taking a post object, and the deep link needs no special
// case.

function Avatar({ profile, size = 32 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0, overflow: 'hidden',
      background: 'var(--bg-card-2)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.4, fontWeight: 700, color: 'var(--text-secondary)',
    }}>
      {profile?.avatar_url
        ? <img src={profile.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : (profile?.username?.[0]?.toUpperCase() ?? '?')}
    </div>
  )
}

function Heart({ filled }) {
  return (
    <svg width="23" height="23" viewBox="0 0 24 24"
      fill={filled ? '#FF3B30' : 'none'} stroke={filled ? '#FF3B30' : 'currentColor'}
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1L12 21l7.7-7.6 1.1-1a5.5 5.5 0 0 0 0-7.8z" />
    </svg>
  )
}

async function fetchPost(id) {
  const { data, error } = await supabase
    .from('posts')
    .select('id, author_id, caption, created_at, post_media(url, position)')
    .eq('id', id)
    .maybeSingle()
  if (error || !data) return null
  const { data: profiles } = await supabase
    .from('profiles').select('id, username, display_name, avatar_url').eq('id', data.author_id)
  return {
    ...data,
    post_media: [...(data.post_media ?? [])].sort((a, b) => a.position - b.position),
    author: profiles?.[0] ?? null,
  }
}

function Comment({ comment, myId, postAuthorId, onDeleted }) {
  // Matches the RLS policy exactly: the commenter, or the post's author
  // moderating their own thread. Showing the control to anyone else would be
  // offering a button the database will refuse.
  const canDelete = myId && (comment.author_id === myId || postAuthorId === myId)
  return (
    <div style={{ display: 'flex', gap: 10, padding: '10px 16px' }}>
      <Avatar profile={comment.author} size={28} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.45 }}>
          <span style={{ fontWeight: 700 }}>@{comment.author?.username ?? 'pilot'}</span>{' '}
          <span style={{ whiteSpace: 'pre-wrap' }}>{comment.body}</span>
        </div>
        <div style={{ display: 'flex', gap: 12, marginTop: 3 }}>
          <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{timeAgo(comment.created_at)}</span>
          {canDelete && (
            <button onClick={() => onDeleted(comment.id)} style={{
              border: 'none', background: 'transparent', color: 'var(--text-tertiary)',
              fontSize: 11, fontWeight: 700, cursor: 'pointer', padding: 0, fontFamily: 'inherit',
            }}>Delete</button>
          )}
        </div>
      </div>
    </div>
  )
}

export default function PostView({ postId, myId, onBack, onShare, onPostDeleted }) {
  const [post, setPost] = useState(undefined)
  const [comments, setComments] = useState([])
  const [likes, setLikes] = useState({ count: 0, mine: false })
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)
  const endRef = useRef(null)

  const load = useCallback(async () => {
    const p = await fetchPost(postId)
    setPost(p)
    if (!p) return
    const [{ data: cs }, l] = await Promise.all([
      listComments(postId),
      myId ? likeState([postId], myId) : Promise.resolve({ counts: {}, mine: new Set() }),
    ])
    setComments(cs)
    setLikes({ count: l.counts[postId] ?? 0, mine: l.mine.has(postId) })
  }, [postId, myId])

  useEffect(() => { load() }, [load])

  async function submit(e) {
    e?.preventDefault()
    const text = draft.trim()
    if (!text || sending || !myId) return
    setSending(true)
    setError(null)
    const { data, error: err } = await addComment(postId, myId, text)
    setSending(false)
    if (err) { setError(err.message || 'Could not post that comment'); return }
    setDraft('')
    setComments(list => [...list, data])
    // New comment goes to the bottom of a chronological thread, so follow it.
    requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }))
  }

  async function removeComment(id) {
    const before = comments
    setComments(list => list.filter(c => c.id !== id))
    const { error: err } = await deleteComment(id)
    if (err) setComments(before)
  }

  async function toggleLike() {
    if (!myId) return
    const next = !likes.mine
    setLikes(l => ({ count: l.count + (next ? 1 : -1), mine: next }))
    const { error: err } = await setLiked(postId, myId, next)
    if (err) load()
  }

  if (post === undefined) {
    return <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>Loading…</div>
  }
  if (!post) {
    return (
      <div style={{ padding: '40px 24px', textAlign: 'center' }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>Post unavailable</div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 16 }}>
          It may have been deleted, or belong to an account you don't follow.
        </div>
        {onBack && (
          <button onClick={onBack} style={{
            border: 'none', background: 'var(--bg-card-2)', color: 'var(--text)', fontFamily: 'inherit',
            fontSize: 14, fontWeight: 700, padding: '10px 20px', borderRadius: 20, cursor: 'pointer',
          }}>Back</button>
        )}
      </div>
    )
  }

  const mine = post.author_id === myId

  return (
    <div style={{ paddingBottom: 90 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 14px 12px' }}>
        {onBack && (
          <button onClick={onBack} aria-label="Back" style={{
            width: 34, height: 34, borderRadius: '50%', border: 'none', background: 'var(--bg-card-2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', color: 'var(--text)', WebkitTapHighlightColor: 'transparent',
          }}>
            <IconChevronLeft size={18} />
          </button>
        )}
        <Avatar profile={post.author} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
            @{post.author?.username ?? 'pilot'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{timeAgo(post.created_at)}</div>
        </div>
        {mine && (
          <button
            onClick={async () => { await deletePost(post); onPostDeleted?.(post.id); onBack?.() }}
            style={{
              border: 'none', background: 'transparent', color: 'var(--danger)',
              fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
            }}>Delete</button>
        )}
      </div>

      {!!post.post_media?.length && (
        <div style={{
          display: 'flex', overflowX: 'auto', scrollSnapType: 'x mandatory',
          background: 'var(--bg-card-2)', WebkitOverflowScrolling: 'touch',
        }}>
          {post.post_media.map(m => (
            <img key={m.url} src={m.url} alt=""
              style={{ width: '100%', flex: '0 0 100%', scrollSnapAlign: 'center', display: 'block' }} />
          ))}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '10px 16px 4px' }}>
        <button onClick={toggleLike} aria-label={likes.mine ? 'Unlike' : 'Like'} disabled={!myId} style={{
          border: 'none', background: 'transparent', cursor: myId ? 'pointer' : 'default', padding: 0,
          color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'inherit',
        }}>
          <Heart filled={likes.mine} />
          {likes.count > 0 && (
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>{likes.count}</span>
          )}
        </button>
        {onShare && (
          <button onClick={() => onShare(post)} aria-label="Share" style={{
            border: 'none', background: 'transparent', cursor: 'pointer', padding: 0,
            color: 'var(--text)', fontSize: 19, fontFamily: 'inherit', lineHeight: 1,
          }}>↗</button>
        )}
      </div>

      {post.caption && (
        <div style={{ padding: '4px 16px 12px', fontSize: 14, color: 'var(--text)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
          {post.caption}
        </div>
      )}

      <div style={{ borderTop: '0.5px solid var(--border)', paddingTop: 6 }}>
        <div style={{
          fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
          color: 'var(--text-tertiary)', padding: '6px 16px 2px',
        }}>
          {comments.length ? `${comments.length} comment${comments.length === 1 ? '' : 's'}` : 'Comments'}
        </div>
        {comments.length === 0 && (
          <div style={{ padding: '12px 16px 18px', fontSize: 13, color: 'var(--text-tertiary)' }}>
            No comments yet.{myId ? ' Be the first.' : ''}
          </div>
        )}
        {comments.map(c => (
          <Comment key={c.id} comment={c} myId={myId} postAuthorId={post.author_id} onDeleted={removeComment} />
        ))}
        <div ref={endRef} />
      </div>

      {myId && (
        <form
          onSubmit={submit}
          style={{
            position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 520,
            display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px',
            background: 'var(--bg-card)', borderTop: '0.5px solid var(--border)',
            paddingBottom: 'calc(10px + env(safe-area-inset-bottom))',
          }}>
          <input
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder="Add a comment…"
            maxLength={1000}
            style={{
              flex: 1, padding: '11px 14px', borderRadius: 20, border: 'none',
              background: 'var(--bg-card-2)', color: 'var(--text)', fontSize: 14,
              fontFamily: 'inherit', outline: 'none',
            }}
          />
          <button type="submit" disabled={!draft.trim() || sending} aria-label="Send" style={{
            width: 38, height: 38, borderRadius: '50%', border: 'none', flexShrink: 0,
            background: draft.trim() ? 'var(--accent)' : 'var(--bg-card-2)',
            color: draft.trim() ? 'var(--accent-fg)' : 'var(--text-tertiary)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: draft.trim() ? 'pointer' : 'default',
          }}>
            <IconSend size={16} />
          </button>
        </form>
      )}

      {error && (
        <div style={{ padding: '10px 16px', fontSize: 12, color: 'var(--danger)' }}>{error}</div>
      )}
    </div>
  )
}
