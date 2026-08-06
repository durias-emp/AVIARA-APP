// Shared map styling, so the same thing looks the same on every map.
//
// This exists because the route line did not. Three maps drew it (the map
// home, the route planner, and the planner's preview) and each carried its own
// hex, so changing it meant finding all three and getting them to agree. They
// had already drifted in opacity.

// The course line.
//
// Magenta because that is what a course line is. Garmin's GNS and GTN, the
// G1000, and every EFB that grew up alongside them draw the active leg in
// magenta, and a pilot reads it without being told what it means. The app had
// a violet, which is close enough to look like a decision and far enough to
// look like a different thing.
export const ROUTE_COLOR = '#FF00FF'

// Opaque enough to still read as magenta.
//
// Not a separate cosmetic choice: the line sits over green terrain and over a
// sectional's browns, and at the 0.65 the planner used, pure magenta comes out
// a washed lilac against both. Colour and opacity decide the colour you
// actually see, so they belong together.
export const ROUTE_OPACITY = 0.85
export const ROUTE_WEIGHT = 4

// The one saturated colour on the screen, so an action is never ambiguous.
// Shared rather than redeclared: the map home, the sheet and the map popups
// all reach for it, and three copies of a hex is how they drift apart.
export const ACCENT = '#8B008B'

// The same colour at an opacity, for the glow under the record button. Derived
// rather than written out again: it was a second hardcoded rgba of the orange
// and stayed orange when the accent changed, leaving a magenta button with an
// orange halo.
export const accentAlpha = (a) => {
  const n = parseInt(ACCENT.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}
