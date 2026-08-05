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
