// The app's surface tokens, remapped onto the map's.
//
// Two palettes exist in this app and they are not interchangeable. Everything
// routed as a screen is built on --bg / --bg-card / --text, which assume an
// opaque page. The map home's drawer is translucent glass built on --map-panel
// / --map-fill / --map-ink. A screen dropped into the drawer with its own
// tokens paints an opaque near-black slab inside the glass and reads as a
// second window sitting in a hole.
//
// So rather than rewriting every card in Calculators, Pilot, Reference,
// Airports, Tools and Settings, the tokens are remapped on the wrapper and the
// whole subtree follows: same components, drawer palette. The planner has been
// carried into the drawer this way since it moved there, and this is that same
// map, shared rather than copied, because two of them would drift.
//
// --bg is NOT transparent, however much it looks like it should be. It is used
// as a FOREGROUND colour in several places, in the pattern
// `background: var(--text); color: var(--bg)`, which is how the app draws a
// filled button. Transparent turned Calculate Route into a white pill with
// invisible ink on it. --map-ink-invert is by definition the colour that
// contrasts with --map-ink, so it is right for both jobs.
export const DRAWER_PALETTE = {
  background: 'transparent',
  '--bg': 'var(--map-ink-invert)',
  '--bg-grouped': 'transparent',
  '--bg-card': 'var(--map-fill-soft)',
  '--bg-card-2': 'var(--map-fill)',
  '--text': 'var(--map-ink)',
  '--text-secondary': 'var(--map-ink-dim)',
  '--text-tertiary': 'var(--map-ink-faint)',
  '--border': 'var(--map-hairline)',
  '--border-strong': 'var(--map-hairline)',
}
