import { useCallback, useEffect, useState } from 'react'
import { getFollowCounts } from '../../lib/follows'
import { listUserPosts } from '../../lib/posts'
import { postUrl } from '../../lib/share'
import PostView from './PostView'
import ShareSheet from './ShareSheet'

// The pilot's own profile: header counts, and their posts as a grid.
//
// The plus button sits up here beside the handle rather than floating over
// the feed. This is the one surface in Discover that is unambiguously
// *yours*, so "add something of mine" belongs next to your own name — and it
// stays put instead of covering the last row of whatever you're reading.

export default function ProfileTab({ profile, onCompose, reloadKey }) {
  const [counts, setCounts] = useState(null)
  const [posts, setPosts] = useState(null)
  const [thread, setThread] = useState(null)
  const [sharing, setSharing] = useState(null)

  const load = useCallback(async () => {
    const [c, { data }] = await Promise.all([
      getFollowCounts(profile.id),
      listUserPosts(profile.id),
    ])
    setCounts(c)
    setPosts(data)
  }, [profile.id])

  useEffect(() => { load() }, [load, reloadKey])

  // Tapping a tile opens the same thread view the feed's comment button
  // opens. It replaces the old preview modal outright — that modal could
  // show a post but not its comments, which is now half of what a post is.
  if (thread) {
    return (
      <>
        <PostView
          postId={thread}
          myId={profile.id}
          onBack={() => { setThread(null); load() }}
          onShare={p => setSharing(p)}
          onPostDeleted={id => setPosts(list => list.filter(p => p.id !== id))}
        />
        {sharing && (
          <ShareSheet
            url={postUrl(sharing.id)}
            title={`@${profile.username} on AVIARA`}
            text={sharing.caption ?? ''}
            myId={profile.id}
            onClose={() => setSharing(null)}
          />
        )}
      </>
    )
  }

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
                onClick={() => setThread(p.id)}
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

    </div>
  )
}
