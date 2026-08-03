// Layout only — no post data exists yet (no `posts` table content, no
// following-based feed query). Skeleton cards in the real shape of a post
// (avatar/handle, image, action row, caption line) so the layout can be
// judged now; wiring real posts in is a separate, later step.
function SkeletonPost() {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 14px 10px' }}>
        <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--bg-card-2)', flexShrink: 0 }} />
        <div style={{ width: 100, height: 11, borderRadius: 6, background: 'var(--bg-card-2)' }} />
      </div>
      <div style={{ width: '100%', aspectRatio: '1 / 1', background: 'var(--bg-card-2)' }} />
      <div style={{ display: 'flex', gap: 16, padding: '10px 14px 6px' }}>
        <div style={{ width: 22, height: 22, borderRadius: 6, background: 'var(--bg-card-2)' }} />
        <div style={{ width: 22, height: 22, borderRadius: 6, background: 'var(--bg-card-2)' }} />
        <div style={{ width: 22, height: 22, borderRadius: 6, background: 'var(--bg-card-2)' }} />
      </div>
      <div style={{ padding: '0 14px' }}>
        <div style={{ width: '70%', height: 10, borderRadius: 6, background: 'var(--bg-card-2)' }} />
      </div>
    </div>
  )
}

export default function FeedTab() {
  return (
    <div style={{ paddingTop: 8 }}>
      <div style={{
        padding: '4px 20px 18px', fontSize: 12, color: 'var(--text-tertiary)', textAlign: 'center',
      }}>
        Posts from pilots you follow will show up here — feed not built yet.
      </div>
      <SkeletonPost />
      <SkeletonPost />
    </div>
  )
}
