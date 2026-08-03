// A flight's ground track, drawn as a shape.
//
// Deliberately an SVG of the track alone rather than a map thumbnail. A map
// image means a tile request per card, which is a network round trip in a
// list a pilot may scroll on a ramp with one bar of signal, and it would put
// chart imagery in a context where nobody is navigating from it. The shape of
// a flight is recognisable on its own: pilots know their own patterns.
//
// Projection is equirectangular with a cosine correction on longitude. Over a
// single flight the error against a proper projection is far below one pixel
// at this size, and it costs nothing.

const PAD = 8

function project(track) {
  const lats = track.map(p => p[0])
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2
  const k = Math.cos((midLat * Math.PI) / 180)
  // y is negated because latitude increases north and SVG y increases down.
  return track.map(([lat, lon]) => [lon * k, -lat])
}

// Fit the track into the box without distorting it: a flight that was a long
// thin leg must not be stretched into a square, or every flight starts to look
// like the same blob.
function fit(pts, w, h) {
  const xs = pts.map(p => p[0])
  const ys = pts.map(p => p[1])
  const minX = Math.min(...xs), maxX = Math.max(...xs)
  const minY = Math.min(...ys), maxY = Math.max(...ys)
  const spanX = Math.max(maxX - minX, 1e-9)
  const spanY = Math.max(maxY - minY, 1e-9)
  const scale = Math.min((w - PAD * 2) / spanX, (h - PAD * 2) / spanY)
  const offX = (w - spanX * scale) / 2
  const offY = (h - spanY * scale) / 2
  return pts.map(([x, y]) => [
    (x - minX) * scale + offX,
    (y - minY) * scale + offY,
  ])
}

export default function FlightTrace({ track, width = 300, height = 118, color = '#FF5A1F' }) {
  const usable = Array.isArray(track) && track.length > 1

  if (!usable) {
    // A flight that was planned rather than flown has no track. Say so with a
    // dashed line instead of an empty box: the absence is the information.
    return (
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height}
        preserveAspectRatio="xMidYMid meet" role="img" aria-label="No recorded track">
        <line x1={PAD * 3} y1={height / 2} x2={width - PAD * 3} y2={height / 2}
          stroke="rgba(60,60,67,0.28)" strokeWidth="2" strokeDasharray="5 6" strokeLinecap="round" />
        <circle cx={PAD * 3} cy={height / 2} r="4" fill="rgba(60,60,67,0.35)" />
        <circle cx={width - PAD * 3} cy={height / 2} r="4" fill="rgba(60,60,67,0.35)" />
      </svg>
    )
  }

  const pts = fit(project(track), width, height)
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
  const start = pts[0]
  const end = pts[pts.length - 1]

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height}
      preserveAspectRatio="xMidYMid meet" role="img" aria-label="Recorded ground track">
      {/* A soft casing under the line, so the track stays legible against any
          card colour without needing a border. */}
      <path d={d} fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="5.5"
        strokeLinejoin="round" strokeLinecap="round" />
      <path d={d} fill="none" stroke={color} strokeWidth="2.6"
        strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={start[0]} cy={start[1]} r="4.5" fill="#fff" stroke={color} strokeWidth="2.2" />
      <circle cx={end[0]} cy={end[1]} r="4.5" fill={color} stroke="#fff" strokeWidth="2" />
    </svg>
  )
}
