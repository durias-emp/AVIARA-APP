import { useEffect, useState } from 'react'
import { getFollowCounts } from '../../lib/follows'

// The header (avatar/handle/counts) is real data — the post grid below it
// is layout-only, an empty state, since posting isn't built yet.
export default function ProfileTab({ profile }) {
  const [counts, setCounts] = useState(null)

  useEffect(() => {
    let cancelled = false
    getFollowCounts(profile.id).then(c => { if (!cancelled) setCounts(c) })
    return () => { cancelled = true }
  }, [profile.id])

  return (
    <div style={{ paddingTop: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '0 20px 18px' }}>
        <div style={{
          width: 72, height: 72, borderRadius: '50%', background: 'var(--bg-card-2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 26, fontWeight: 700, color: 'var(--text-secondary)', flexShrink: 0,
        }}>
          {profile.username[0].toUpperCase()}
        </div>
        <div style={{ display: 'flex', gap: 22 }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)' }}>0</div>
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

      <div style={{ padding: '0 20px 18px' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>@{profile.username}</div>
        {profile.bio && <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>{profile.bio}</div>}
      </div>

      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        padding: '40px 32px', textAlign: 'center', color: 'var(--text-tertiary)',
      }}>
        <div style={{ fontSize: 13, lineHeight: 1.6 }}>
          No posts yet — posting isn't built yet either.
        </div>
      </div>
    </div>
  )
}
