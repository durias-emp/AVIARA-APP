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

export function AppTile({ app, size, onOpen, holdProps, dimmed = false, index = 0, animate = false, jiggle = false, dragging = false }) {
  const radius = Math.round(size * RADIUS_RATIO)
  return (
    <button
      onClick={onOpen}
      {...(holdProps ?? {})}
      title={app.label}
      aria-label={app.label}
      data-app-key={app.key}
      style={{
        ...(holdProps?.style ?? {}),
        position: 'relative',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
        background: 'none', border: 'none', padding: 0, cursor: 'pointer',
        flexShrink: 0,
        opacity: dimmed ? 0.45 : 1,
        // The gravity drop. Each tile starts a little above its place and
        // slightly small, then falls into it, a fraction later than the one
        // before. Staggering by index is what makes it read as a handful of
        // objects landing rather than one block sliding.
        // Longhand throughout, never the `animation` shorthand. React warns
        // when a shorthand and one of its own longhands are both set across a
        // rerender, because which one wins depends on the order the properties
        // happen to be applied in.
        ...(animate && !jiggle ? {
          animationName: 'aviara-drop',
          animationDuration: '420ms',
          animationTimingFunction: 'cubic-bezier(0.2, 1.35, 0.4, 1)',
          animationFillMode: 'both',
          animationDelay: `${Math.min(index, 11) * 32}ms`,
        } : null),
        // While the page is in edit mode every tile wobbles, which is the only
        // signal a phone gives that icons can be moved and is understood
        // without being taught. The one under the finger stops and lifts.
        ...(jiggle && !dragging ? {
          animationName: 'aviara-jiggle',
          animationDuration: '260ms',
          animationTimingFunction: 'ease-in-out',
          animationIterationCount: 'infinite',
          animationDirection: 'alternate',
          animationDelay: `${(index % 5) * 40}ms`,
        } : null),
        ...(dragging ? { transform: 'scale(1.12)', zIndex: 2, opacity: 0.9 } : null),
        transition: dragging ? 'none' : 'transform 160ms ease',
      }}>
      <span style={{
        width: size, height: size, borderRadius: radius, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        // The stain, when one is chosen, falls back to the theme's own fill.
        // An app carrying its own tint (the accent one) keeps it: that colour
        // is saying "this is the emphasised slot", not "this is the material".
        background: app.tint ?? 'var(--app-tile-bg, var(--map-fill))',
        color: app.ink ?? 'var(--map-ink)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.16)',
        // Every tile animates its own size, so growing the dock between stops
        // is one transition rather than a re-layout.
        transition: 'width 320ms cubic-bezier(0.32,0.72,0,1), height 320ms cubic-bezier(0.32,0.72,0,1), border-radius 320ms cubic-bezier(0.32,0.72,0,1), background 200ms',
        overflow: 'hidden',
      }}>
        {app.icon}
      </span>
      {/* What the app reports without being opened. A count, a category, a
          pair of dots: the same things the rows carried before the tiles
          replaced them. */}
      {app.badge != null && (
        <span style={{
          position: 'absolute', top: -4, right: -4,
          minWidth: 20, height: 20, padding: '0 5px', borderRadius: 10,
          background: app.badgeTint ?? 'var(--danger)', color: '#fff',
          fontSize: 10, fontWeight: 800, lineHeight: 1,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: '2px solid var(--map-panel)', fontVariantNumeric: 'tabular-nums',
        }}>{app.badge}</span>
      )}
      {/* The label always shows. An unlabelled grid of glyphs is a memory
          test, and the dock's whole claim is that a pilot does not have to
          hunt: taking the names away at the small size took exactly the case
          where hunting is most likely. */}
      {(
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
