import { useCallback, useEffect, useState } from 'react'
import { getFollowCounts } from '../../lib/follows'
import { listUserPosts, deletePost, timeAgo } from '../../lib/posts'

// The pilot's own profile: header counts, and their posts as a grid.
//
// The plus button sits up here beside the handle rather than floating over
// the feed. This is the one surface in Discover that is unambiguously
// *yours*, so "add something of mine" belongs next to your own name — and it
// stays put instead of covering the last row of whatever you're reading.

function PostDetail({ post, onClose, onDeleted }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  async function remove() {
    setBusy(true)
    await deletePost(post)
    setBusy(false)
    onDeleted(post.id)
    onClose()
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 650, background: 'rgba(0,0,0,0.75)',
        backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 420, maxHeight: '86vh', overflowY: 'auto',
          background: 'var(--bg-card)', borderRadius: 18,
        }}>
        {post.post_media?.map(m => (
          <img key={m.url} src={m.url} alt="" style={{ width: '100%', display: 'block' }} />
        ))}
        <div style={{ padding: 16 }}>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 6 }}>
            {timeAgo(post.created_at)}
          </div>
          {post.caption && (
            <div style={{ fontSize: 14, color: 'var(--text)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
              {post.caption}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            {confirming ? (
              <>
                <button onClick={remove} disabled={busy} style={{
                  flex: 1, padding: '11px 0', borderRadius: 12, border: 'none',
                  background: 'var(--danger)', color: '#fff', fontFamily: 'inherit',
                  fontSize: 14, fontWeight: 700, cursor: 'pointer',
                }}>{busy ? 'Deleting…' : 'Delete post'}</button>
                <button onClick={() => setConfirming(false)} style={{
                  flex: 1, padding: '11px 0', borderRadius: 12, border: 'none',
                  background: 'var(--bg-card-2)', color: 'var(--text-secondary)',
                  fontFamily: 'inherit', fontSize: 14, fontWeight: 700, cursor: 'pointer',
                }}>Keep</button>
              </>
            ) : (
              <>
                <button onClick={onClose} style={{
                  flex: 1, padding: '11px 0', borderRadius: 12, border: 'none',
                  background: 'var(--bg-card-2)', color: 'var(--text)', fontFamily: 'inherit',
                  fontSize: 14, fontWeight: 700, cursor: 'pointer',
                }}>Close</button>
                <button onClick={() => setConfirming(true)} style={{
                  padding: '11px 18px', borderRadius: 12, border: 'none',
                  background: 'transparent', color: 'var(--danger)', fontFamily: 'inherit',
                  fontSize: 14, fontWeight: 700, cursor: 'pointer',
                }}>Delete</button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function ProfileTab({ profile, onCompose, reloadKey }) {
  const [counts, setCounts] = useState(null)
  const [posts, setPosts] = useState(null)
  const [open, setOpen] = useState(null)

  const load = useCallback(async () => {
    const [c, { data }] = await Promise.all([
      getFollowCounts(profile.id),
      listUserPosts(profile.id),
    ])
    setCounts(c)
    setPosts(data)
  }, [profile.id])

  useEffect(() => { load() }, [load, reloadKey])

  return (
    <div style={{ paddingTop: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '0 20px 18px' }}>
        <div style={{
          width: 72, height: 72, borderRadius: '50%', background: 'var(--bg-card-2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
          fontSize: 26, fontWeight: 700, color: 'var(--text-secondary)', flexShrink: 0,
        }}>
          {profile.avatar_url
            ? <img src={profile.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : profile.username[0].toUpperCase()}
        </div>
        <div style={{ display: 'flex', gap: 22 }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)' }}>{posts?.length ?? '—'}</div>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Posts</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)' }}>{counts?.followers ?? '—'}</div>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Followers</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)' }}>{counts?.following ?? '—'}</div>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Following</div>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '0 20px 18px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>@{profile.username}</div>
          {profile.bio && <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>{profile.bio}</div>}
        </div>
        <button
          onClick={() => onCompose('Post')}
          aria-label="New post"
          style={{
            width: 38, height: 38, borderRadius: '50%', border: 'none', flexShrink: 0,
            background: 'var(--accent)', color: 'var(--accent-fg)',
            fontSize: 22, fontWeight: 700, lineHeight: 1, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'inherit', WebkitTapHighlightColor: 'transparent',
            boxShadow: 'var(--shadow-sm)',
          }}>+</button>
      </div>

      {posts === null && (
        <div style={{ padding: '30px 20px', textAlign: 'center', fontSize: 13, color: 'var(--text-tertiary)' }}>
          Loading…
        </div>
      )}

      {posts?.length === 0 && (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          padding: '34px 32px', textAlign: 'center',
        }}>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 16 }}>
            Nothing posted yet. Share a photo of your aircraft, a view from the
            flight deck, or a field worth knowing about.
          </div>
          <button
            onClick={() => onCompose('Post')}
            style={{
              border: 'none', background: 'var(--text)', color: 'var(--bg)', fontFamily: 'inherit',
              fontSize: 14, fontWeight: 700, padding: '11px 22px', borderRadius: 22, cursor: 'pointer',
            }}>Create your first post</button>
        </div>
      )}

      {!!posts?.length && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 2, padding: '0 2px' }}>
          {posts.map(p => {
            const cover = p.post_media?.[0]?.url
            return (
              <button
                key={p.id}
                onClick={() => setOpen(p)}
                style={{
                  aspectRatio: '1 / 1', border: 'none', padding: 0, cursor: 'pointer',
                  background: 'var(--bg-card-2)', position: 'relative', overflow: 'hidden',
                  WebkitTapHighlightColor: 'transparent', fontFamily: 'inherit',
                }}>
                {cover ? (
                  <img src={cover} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                ) : (
                  // A text-only post still gets a tile, or the grid silently
                  // loses every post made without a photo.
                  <span style={{
                    position: 'absolute', inset: 0, padding: 10, display: 'flex',
                    alignItems: 'center', justifyContent: 'center', textAlign: 'center',
                    fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.4,
                    overflow: 'hidden',
                  }}>{p.caption?.slice(0, 90)}</span>
                )}
                {p.post_media?.length > 1 && (
                  <span style={{
                    position: 'absolute', top: 6, right: 6, background: 'rgba(0,0,0,0.55)',
                    color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 5px', borderRadius: 5,
                  }}>{p.post_media.length}</span>
                )}
              </button>
            )
          })}
        </div>
      )}

      {open && (
        <PostDetail
          post={open}
          onClose={() => setOpen(null)}
          onDeleted={id => setPosts(list => list.filter(p => p.id !== id))}
        />
      )}
    </div>
  )
}
