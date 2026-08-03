import { useCallback, useEffect, useState } from 'react'
import { listFeed, likeState, setLiked, timeAgo, deletePost } from '../../lib/posts'
import { listActiveStories, purgeMyExpiredStories } from '../../lib/stories'
import StoryViewer from './StoryViewer'

// Real posts from people you follow, plus your own.
//
// Was a skeleton until posting existed. The empty state still gets care,
// because on a young app it is the state most pilots will actually meet —
// so it says what to do rather than apologising for having nothing.

function Avatar({ profile, size = 34 }) {
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
      fill={filled ? '#FF3B30' : 'none'}
      stroke={filled ? '#FF3B30' : 'currentColor'}
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1L12 21l7.7-7.6 1.1-1a5.5 5.5 0 0 0 0-7.8z" />
    </svg>
  )
}

// Several photos on one post scroll sideways, one per screen — the shape
// every feed uses, and the reason post_media carries an explicit position.
function Photos({ media }) {
  if (!media?.length) return null
  if (media.length === 1) {
    return (
      <div style={{ width: '100%', background: 'var(--bg-card-2)' }}>
        <img src={media[0].url} alt="" style={{ width: '100%', display: 'block' }} />
      </div>
    )
  }
  return (
    <div style={{
      display: 'flex', overflowX: 'auto', scrollSnapType: 'x mandatory',
      WebkitOverflowScrolling: 'touch', background: 'var(--bg-card-2)',
    }}>
      {media.map(m => (
        <img key={m.url} src={m.url} alt=""
          style={{ width: '100%', flex: '0 0 100%', scrollSnapAlign: 'center', display: 'block' }} />
      ))}
    </div>
  )
}

function Post({ post, myId, liked, count, onToggleLike, onDeleted }) {
  const [confirming, setConfirming] = useState(false)
  const mine = post.author_id === myId

  async function remove() {
    await deletePost(post)
    onDeleted?.(post.id)
  }

  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 14px 10px' }}>
        <Avatar profile={post.author} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
            @{post.author?.username ?? 'pilot'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{timeAgo(post.created_at)}</div>
        </div>
        {mine && (
          confirming ? (
            <span style={{ display: 'flex', gap: 6 }}>
              <button onClick={remove} style={{
                border: 'none', background: 'var(--danger)', color: '#fff', fontFamily: 'inherit',
                fontSize: 11, fontWeight: 700, padding: '5px 10px', borderRadius: 14, cursor: 'pointer',
              }}>Delete</button>
              <button onClick={() => setConfirming(false)} style={{
                border: 'none', background: 'var(--bg-card-2)', color: 'var(--text-secondary)',
                fontFamily: 'inherit', fontSize: 11, fontWeight: 700, padding: '5px 10px',
                borderRadius: 14, cursor: 'pointer',
              }}>Keep</button>
            </span>
          ) : (
            <button onClick={() => setConfirming(true)} aria-label="Post options" style={{
              border: 'none', background: 'transparent', color: 'var(--text-tertiary)',
              fontSize: 18, cursor: 'pointer', padding: '0 4px', fontFamily: 'inherit', lineHeight: 1,
            }}>···</button>
          )
        )}
      </div>

      <Photos media={post.post_media} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 14px 4px' }}>
        <button
          onClick={() => onToggleLike(post.id, !liked)}
          aria-label={liked ? 'Unlike' : 'Like'}
          style={{
            border: 'none', background: 'transparent', cursor: 'pointer', padding: 0,
            color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 6,
            WebkitTapHighlightColor: 'transparent', fontFamily: 'inherit',
          }}>
          <Heart filled={liked} />
          {count > 0 && (
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>{count}</span>
          )}
        </button>
      </div>

      {post.caption && (
        <div style={{ padding: '4px 14px 0', fontSize: 14, color: 'var(--text)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
          {post.caption}
        </div>
      )}
    </div>
  )
}

function StoriesRow({ groups, myId, onOpen, onAdd }) {
  const mineGroup = groups.find(g => g.authorId === myId)
  return (
    <div style={{
      display: 'flex', gap: 14, overflowX: 'auto', padding: '0 16px 18px',
      scrollbarWidth: 'none',
    }}>
      {/* The pilot's own ring is always first and always tappable — with a
          story it opens theirs, without one it starts a new one. */}
      <button
        onClick={() => (mineGroup ? onOpen(mineGroup) : onAdd())}
        style={{
          border: 'none', background: 'transparent', cursor: 'pointer', padding: 0,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, flexShrink: 0,
          fontFamily: 'inherit', WebkitTapHighlightColor: 'transparent',
        }}>
        <span style={{
          position: 'relative', width: 62, height: 62, borderRadius: '50%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: mineGroup
            ? 'linear-gradient(135deg, #3B6FF5, #8B3BF5, #F53BA0)'
            : 'var(--bg-card-2)',
        }}>
          <span style={{
            width: mineGroup ? 56 : 62, height: mineGroup ? 56 : 62, borderRadius: '50%',
            background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            overflow: 'hidden',
          }}>
            <Avatar profile={mineGroup?.author} size={mineGroup ? 52 : 58} />
          </span>
          <span style={{
            position: 'absolute', right: -1, bottom: -1, width: 21, height: 21, borderRadius: '50%',
            background: 'var(--accent)', color: 'var(--accent-fg)', border: '2px solid var(--bg)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 15, fontWeight: 700, lineHeight: 1,
          }}>+</span>
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Your story</span>
      </button>

      {groups.filter(g => g.authorId !== myId).map(g => (
        <button
          key={g.authorId}
          onClick={() => onOpen(g)}
          style={{
            border: 'none', background: 'transparent', cursor: 'pointer', padding: 0,
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, flexShrink: 0,
            fontFamily: 'inherit', WebkitTapHighlightColor: 'transparent', maxWidth: 68,
          }}>
          <span style={{
            width: 62, height: 62, borderRadius: '50%',
            background: 'linear-gradient(135deg, #3B6FF5, #8B3BF5, #F53BA0)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{
              width: 56, height: 56, borderRadius: '50%', background: 'var(--bg)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
            }}>
              <Avatar profile={g.author} size={52} />
            </span>
          </span>
          <span style={{
            fontSize: 11, color: 'var(--text-secondary)', maxWidth: 66,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{g.author?.username ?? 'pilot'}</span>
        </button>
      ))}
    </div>
  )
}

export default function FeedTab({ myId, onCompose, reloadKey }) {
  const [posts, setPosts] = useState(null)
  const [stories, setStories] = useState([])
  const [likes, setLikes] = useState({ counts: {}, mine: new Set() })
  const [viewing, setViewing] = useState(null)

  const load = useCallback(async () => {
    const [{ data: feed }, { data: groups }] = await Promise.all([
      listFeed(myId),
      listActiveStories(myId),
    ])
    setPosts(feed)
    setStories(groups)
    if (feed.length) setLikes(await likeState(feed.map(p => p.id), myId))
  }, [myId])

  useEffect(() => { load() }, [load, reloadKey])

  // Housekeeping, not display: clears this pilot's own lapsed stories and the
  // photos behind them. Fire-and-forget so it never delays the feed.
  useEffect(() => { purgeMyExpiredStories() }, [])

  async function toggleLike(postId, liked) {
    // Optimistic — a heart that waits on a round trip feels broken.
    setLikes(prev => {
      const mine = new Set(prev.mine)
      liked ? mine.add(postId) : mine.delete(postId)
      return { counts: { ...prev.counts, [postId]: (prev.counts[postId] ?? 0) + (liked ? 1 : -1) }, mine }
    })
    const { error } = await setLiked(postId, myId, liked)
    if (error) load()
  }

  return (
    <div style={{ paddingTop: 8 }}>
      <StoriesRow
        groups={stories}
        myId={myId}
        onOpen={setViewing}
        onAdd={() => onCompose('Story')}
      />

      {posts === null && (
        <div style={{ padding: '30px 20px', textAlign: 'center', fontSize: 13, color: 'var(--text-tertiary)' }}>
          Loading…
        </div>
      )}

      {posts?.length === 0 && (
        <div style={{ padding: '30px 32px 10px', textAlign: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>
            Nothing here yet
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 16 }}>
            Posts from pilots you follow show up here. Follow someone from Explore,
            or put up the first post yourself.
          </div>
          <button
            onClick={() => onCompose('Post')}
            style={{
              border: 'none', background: 'var(--text)', color: 'var(--bg)', fontFamily: 'inherit',
              fontSize: 14, fontWeight: 700, padding: '11px 22px', borderRadius: 22, cursor: 'pointer',
            }}>Create a post</button>
        </div>
      )}

      {posts?.map(p => (
        <Post
          key={p.id}
          post={p}
          myId={myId}
          liked={likes.mine.has(p.id)}
          count={likes.counts[p.id] ?? 0}
          onToggleLike={toggleLike}
          onDeleted={id => setPosts(list => list.filter(x => x.id !== id))}
        />
      ))}

      {viewing && (
        <StoryViewer
          group={viewing}
          myId={myId}
          onClose={() => setViewing(null)}
          onChanged={load}
        />
      )}
    </div>
  )
}
