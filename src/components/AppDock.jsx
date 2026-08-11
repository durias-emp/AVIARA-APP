/* ── The dock, and the apps that live above it ──────────────────────────
   A phone's home screen, borrowed wholesale: a few apps on a dock at the
   bottom that are always within thumb reach, and the rest on a page above
   that you pull up to see.

   The shape is the point. Round buttons read as controls, one per function,
   and a row of them has to be read left to right every time. Rounded squares
   read as apps: the same object repeated, told apart by their faces rather
   than by their position, which is why nobody hunts for an icon on their own
   phone. Uniform size for the same reason, so nothing claims to matter more
   than the thing beside it. ── */

// The squircle. 22.5% of the tile is Apple's own corner ratio and it is
// noticeably rounder than a stock border radius: at 15% these read as buttons
// with soft corners, at 22.5% they read as apps.
const RADIUS_RATIO = 0.225

export function AppTile({ app, size, onOpen, holdProps, dimmed = false, index = 0, animate = false }) {
  const radius = Math.round(size * RADIUS_RATIO)
  return (
    <button
      onClick={onOpen}
      {...(holdProps ?? {})}
      title={app.label}
      aria-label={app.label}
      style={{
        ...(holdProps?.style ?? {}),
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
        background: 'none', border: 'none', padding: 0, cursor: 'pointer',
        flexShrink: 0,
        opacity: dimmed ? 0.45 : 1,
        // The gravity drop. Each tile starts a little above its place and
        // slightly small, then falls into it, a fraction later than the one
        // before. Staggering by index is what makes it read as a handful of
        // objects landing rather than one block sliding.
        ...(animate ? {
          animation: `aviara-drop 420ms cubic-bezier(0.2, 1.35, 0.4, 1) both`,
          animationDelay: `${Math.min(index, 11) * 32}ms`,
        } : null),
      }}>
      <span style={{
        width: size, height: size, borderRadius: radius, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: app.tint ?? 'var(--map-fill)',
        color: app.ink ?? 'var(--map-ink)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.16)',
        // Every tile animates its own size, so growing the dock between stops
        // is one transition rather than a re-layout.
        transition: 'width 320ms cubic-bezier(0.32,0.72,0,1), height 320ms cubic-bezier(0.32,0.72,0,1), border-radius 320ms cubic-bezier(0.32,0.72,0,1), background 200ms',
        overflow: 'hidden',
      }}>
        {app.icon}
      </span>
      {/* The label goes when the tile is small. A caption under a 40px icon is
          unreadable and only makes the dock taller. */}
      {size >= 52 && (
        <span style={{
          fontSize: 11, fontWeight: 600, color: 'var(--map-ink)',
          maxWidth: size + 18, overflow: 'hidden', textOverflow: 'ellipsis',
          whiteSpace: 'nowrap', lineHeight: 1.2,
        }}>{app.label}</span>
      )}
    </button>
  )
}

// The dock itself: the pinned few, evenly spread, always on the bottom.
export function AppDock({ apps, size, onOpen, holdPropsFor }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-end', justifyContent: 'space-around',
      gap: 10, width: '100%',
      transition: 'padding 320ms cubic-bezier(0.32,0.72,0,1)',
    }}>
      {apps.map((app, i) => (
        <AppTile key={app.key} app={app} size={size}
          onOpen={() => onOpen(app)} holdProps={holdPropsFor?.(i)} />
      ))}
    </div>
  )
}
