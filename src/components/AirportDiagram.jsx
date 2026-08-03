import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchAirportGeometry, isFBO } from '../lib/airportDiagram'
import { runwayEnds } from '../lib/faaAirportGeometry'
import { useLiveLocation } from '../hooks/useLiveLocation'
import { useBackOverride } from '../context/BackOverride'

const W = 300, H = 170

/* ── Fallback: abstract diagram from the bundled runway heading list, used
   whenever OpenStreetMap has nothing usable for this field (small strips,
   gaps in OSM coverage) — this is the original heading-only diagram. ── */
function groupRunwaysByHeading(runways) {
  const groups = []
  for (const rwy of runways) {
    const hdg = rwy[4] ?? 90
    const norm = ((hdg % 180) + 180) % 180
    let g = groups.find(g => Math.abs(g.norm - norm) < 5 || Math.abs(g.norm - norm) > 175)
    if (!g) { g = { norm, items: [] }; groups.push(g) }
    g.items.push(rwy)
  }
  return groups.slice(0, 3)
}

function AbstractRunways({ runways, w = W, h = H }) {
  const cx = w / 2, cy = h / 2
  const halfLen = Math.min(w, h) * 0.36
  const groups = groupRunwaysByHeading(runways || [])
  if (groups.length === 0) {
    return (
      <g opacity="0.3">
        <rect x={cx - halfLen} y={cy - 8} width={halfLen * 2} height="16" rx="2" fill="var(--text-tertiary)" />
      </g>
    )
  }
  return groups.flatMap((g, gi) => {
    const rad = g.norm * Math.PI / 180
    const dir = { x: Math.sin(rad), y: -Math.cos(rad) }
    const perp = { x: -dir.y, y: dir.x }
    const n = g.items.length
    const marginX = w * 0.09, marginY = h * 0.09
    return g.items.map((rwy, i) => {
      const [id1, id2] = rwy
      const offset = (i - (n - 1) / 2) * 16
      const ccx = cx + perp.x * offset, ccy = cy + perp.y * offset
      const tX = dir.x !== 0 ? Math.min(w - marginX - ccx, ccx - marginX) / Math.abs(dir.x) : Infinity
      const tY = dir.y !== 0 ? Math.min(h - marginY - ccy, ccy - marginY) / Math.abs(dir.y) : Infinity
      const labelDist = Math.min(halfLen + 16, tX, tY)
      const lineLen = Math.max(labelDist - 14, 10)
      const x1 = ccx - dir.x * lineLen, y1 = ccy - dir.y * lineLen
      const x2 = ccx + dir.x * lineLen, y2 = ccy + dir.y * lineLen
      const lx1 = ccx - dir.x * labelDist, ly1 = ccy - dir.y * labelDist
      const lx2 = ccx + dir.x * labelDist, ly2 = ccy + dir.y * labelDist
      return (
        <g key={`${gi}-${i}`}>
          <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--text-tertiary)" strokeWidth="9" strokeLinecap="round" opacity="0.55" />
          <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#ffffff" strokeWidth="1" strokeDasharray="5 5" opacity="0.7" />
          {id2 && <text x={lx1} y={ly1} fontSize="10" fontWeight="700" fill="var(--text-secondary)" textAnchor="middle" dominantBaseline="middle">{id2}</text>}
          {id1 && <text x={lx2} y={ly2} fontSize="10" fontWeight="700" fill="var(--text-secondary)" textAnchor="middle" dominantBaseline="middle">{id1}</text>}
        </g>
      )
    })
  })
}

/* ── Real diagram, projected from OpenStreetMap geometry ── */
function bearingDeg(a, b) {
  const φ1 = a.lat * Math.PI / 180, φ2 = b.lat * Math.PI / 180
  const Δλ = (b.lon - a.lon) * Math.PI / 180
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360
}
function angleDiff(a, b) {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}
function normalizeIdent(id) {
  return (id ?? '').toString().trim().toUpperCase()
}

// Taxiway/apron names are sometimes just a placeholder ("UNK", empty) —
// worth showing a real designator, not worth cluttering the diagram with
// a meaningless one.
function cleanLabel(name) {
  const s = (name ?? '').toString().trim()
  if (!s || /^unk(nown)?$/i.test(s) || /^none$/i.test(s)) return null
  return s
}

function centroid(points, project) {
  const pts = points.map(project)
  const x = pts.reduce((s, p) => s + p.x, 0) / pts.length
  const y = pts.reduce((s, p) => s + p.y, 0) / pts.length
  return { x, y }
}

// A real taxiway (or apron) is often split into many small pavement
// segments that all share the same name — labeling every segment
// individually turns a busy field like JFK into a wall of overlapping
// text. Group by exact name and anchor the label on the single LARGEST
// piece sharing that name — not the centroid across every piece, which can
// land at a shared junction with a neighboring taxiway's own centroid and
// overlap it illegibly (a short connector stub's few points average out to
// right where it meets the taxiway it branches off, and that taxiway's own
// full-length average can land in the same spot).
//
// A complex hub can have 50+ genuinely distinct names — more than can ever
// read legibly at once, so the result is capped to the most significant
// ones. Critically, "most significant" is judged only among names that
// actually fall within `viewport` (the currently panned/zoomed-in region,
// in viewBox coordinates) when one is given — capping by a GLOBAL top-N
// regardless of what's in view meant panning to a specific gate area of a
// sprawling airport could show zero labels there, because the global
// top-N all happened to be elsewhere on the field. Passing no viewport
// (the fitted, zoomed-out view) falls back to considering everything, same
// as before this existed.
function labelPositions(features, project, maxLabels, viewport) {
  const groups = new Map()
  for (const f of features) {
    const name = cleanLabel(f.tags?.name ?? f.tags?.ref)
    if (!name) continue
    if (!groups.has(name)) groups.set(name, [])
    groups.get(name).push(f)
  }
  const entries = Array.from(groups, ([name, feats]) => {
    let best = feats[0], bestSpread = -1
    for (const f of feats) {
      const lats = f.points.map(p => p.lat), lons = f.points.map(p => p.lon)
      const spread = Math.hypot(Math.max(...lats) - Math.min(...lats), Math.max(...lons) - Math.min(...lons))
      if (spread > bestSpread) { bestSpread = spread; best = f }
    }
    return { name, points: best.points, spread: bestSpread }
  })
  const withPoints = entries.map(e => ({ ...e, point: centroid(e.points, project) }))
  const inView = viewport
    ? withPoints.filter(e => e.point.x >= viewport.xMin && e.point.x <= viewport.xMax && e.point.y >= viewport.yMin && e.point.y <= viewport.yMax)
    : withPoints
  inView.sort((a, b) => b.spread - a.spread)
  return inView.slice(0, maxLabels).map(e => ({ name: e.name, point: e.point }))
}

// Even anchored on each name's largest piece, two different taxiways (or a
// taxiway and an apron — JFK genuinely has one named "FA" a few pixels from
// one named "F") can still land close enough to overlap. Nudge any pair
// closer than minDist apart along the line between them, a few passes so a
// three-way pileup settles instead of just swapping which two collide. A
// cluster dense enough (JFK's central complex has a dozen-plus names in a
// small area) can't always be fully separated by nudging alone — for
// anything still too close afterward, drop whichever came later in the
// list (callers pass items pre-sorted by significance) rather than ship
// two labels overlapping into illegible mush.
function resolveLabelCollisions(items, minDist = 22) {
  const pts = items.map(l => ({ ...l, point: { ...l.point } }))
  for (let pass = 0; pass < 5; pass++) {
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const dx = pts[j].point.x - pts[i].point.x
        const dy = pts[j].point.y - pts[i].point.y
        const d = Math.hypot(dx, dy) || 0.001
        if (d < minDist) {
          const push = (minDist - d) / 2
          const ux = dx / d, uy = dy / d
          pts[i].point.x -= ux * push; pts[i].point.y -= uy * push
          pts[j].point.x += ux * push; pts[j].point.y += uy * push
        }
      }
    }
  }
  const kept = []
  for (const p of pts) {
    if (kept.every(k => Math.hypot(k.point.x - p.point.x, k.point.y - p.point.y) >= minDist * 0.7)) {
      kept.push(p)
    }
  }
  return kept
}

// OpenStreetMap has no concept of "which airport this runway officially
// belongs to" — a bounding-box query around one field can sweep in a
// completely unrelated strip nearby (this is exactly how CYQA's diagram
// once showed a phantom "09/27": a real OSM way, but a separate grass strip
// near Muskoka, not one of its actual runways). The app's own bundled
// runway list (`runways` prop — FAA/eAIP/community, already trusted
// elsewhere in this file's caller) is the ground truth; any OSM "runway"
// whose ref doesn't match one of its idents gets dropped rather than drawn.
// When there's no bundled list to check against, OSM's data is kept as-is —
// better than nothing, same as before this fix existed.
function validateRunways(osmRunways, officialRunways) {
  if (!officialRunways?.length) return osmRunways
  const official = new Set()
  for (const r of officialRunways) {
    if (r[0]) official.add(normalizeIdent(r[0]))
    if (r[1]) official.add(normalizeIdent(r[1]))
  }
  return osmRunways.filter(rwy => {
    const [a, b] = (rwy.tags?.ref || '').split('/').map(normalizeIdent)
    return official.has(a) || official.has(b)
  })
}

// Fits every fetched point into a W×H viewBox, centered within whatever
// drawable area remains after (possibly asymmetric) padding — the mini card
// uses a bigger top-left pad to reserve room for the weather text so the
// diagram itself is pushed clear of it, rather than the two overlapping.
function computeProjection(geo, w, h, pad = {}) {
  if (!geo) return null
  const { top = 34, left = 34, right = 34, bottom = 34 } = pad
  const all = [...geo.runways, ...geo.taxiways, ...geo.aprons, ...geo.buildings, ...geo.helipads].flatMap(f => f.points)
  if (!all.length) return null
  const latRef = all.reduce((s, p) => s + p.lat, 0) / all.length
  const cos = Math.cos(latRef * Math.PI / 180)
  const proj = all.map(p => ({ px: p.lon * cos, py: -p.lat }))
  const minX = Math.min(...proj.map(p => p.px)), maxX = Math.max(...proj.map(p => p.px))
  const minY = Math.min(...proj.map(p => p.py)), maxY = Math.max(...proj.map(p => p.py))
  const midX = (minX + maxX) / 2, midY = (minY + maxY) / 2
  const availW = Math.max(w - left - right, 1), availH = Math.max(h - top - bottom, 1)
  const spanX = Math.max(maxX - minX, 0.0002), spanY = Math.max(maxY - minY, 0.0002)
  const scale = Math.min(availW / spanX, availH / spanY)
  const cx = left + availW / 2, cy = top + availH / 2
  return (p) => ({ x: cx + (p.lon * cos - midX) * scale, y: cy + (-p.lat - midY) * scale })
}

function runwayKey(ref) {
  const [a, b] = (ref || '').split('/').map(normalizeIdent)
  return [a, b].sort().join('|')
}

// Pure shapes only — no labels. OSM sometimes splits one physical runway
// into multiple ways sharing the same ref (e.g. a displaced-threshold
// segment digitized separately from the full-length way); every one of
// them still gets its own line/pavement drawn here.
function RealRunways({ geo, project, strokeWidth = 7 }) {
  return geo.runways.map((rwy, i) => {
    const pts = rwy.points.map(project)
    const a = pts[0], b = pts[pts.length - 1]
    return (
      <g key={i}>
        {/* Real pavement outline (FAA-sourced runways only) — actual width,
            drawn under the centerline below so the diagram reads as a real
            runway shape instead of a single abstracted line. */}
        {rwy.pavement && (
          <polygon points={rwy.pavement.map(project).map(p => `${p.x},${p.y}`).join(' ')}
            fill="var(--text-tertiary)" opacity="0.35" />
        )}
        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--text-tertiary)" strokeWidth={strokeWidth} strokeLinecap="round" opacity="0.6" />
        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#ffffff" strokeWidth="1" strokeDasharray="4 4" opacity="0.7" />
      </g>
    )
  })
}

// Runway end-number labels, computed separately from the shapes above. A
// runway split into several ways (main + a displaced-threshold stub, say)
// needs its label placed clear of the OUTERMOST point across every one of
// those segments — offsetting from just one segment's own endpoint (even
// the longest one) can still land the label on top of a shorter, further-
// reaching segment sharing the same ref. So every way sharing a ref is
// grouped and reduced to its true combined extremes first (same technique
// used for a single FAA pavement polygon's ends, generalized to a group).
function RunwayLabels({ geo, project, fontSize = 9, strokeWidth = 7 }) {
  const groups = new Map()
  for (const rwy of geo.runways) {
    const key = runwayKey(rwy.tags?.ref)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(rwy)
  }

  return Array.from(groups.values()).map((group, gi) => {
    const ref = group.find(r => r.tags?.ref)?.tags?.ref
    const [id1, id2] = (ref || '').split('/')
    if (!id1 && !id2) return null

    const allPoints = group.flatMap(r => r.points)
    const [end1, end2] = runwayEnds(allPoints, ref)
    const p1 = project(end1), p2 = project(end2)

    let label1 = id1, label2 = id2
    if (id1 && id2) {
      // Which extreme is "first" isn't a reliable guide to which physical
      // end that number belongs to — check the true bearing against each
      // number's own heading (e.g. "13" -> 130°) and swap if needed.
      const trueBrg = bearingDeg(end1, end2)
      const hdg1 = (parseInt(id1) || 0) * 10
      if (angleDiff(trueBrg, hdg1) > 90) { label1 = id2; label2 = id1 }
    }

    const dx = p2.x - p1.x, dy = p2.y - p1.y
    const len = Math.hypot(dx, dy) || 1
    const ux = dx / len, uy = dy / len
    // The label needs to clear the actual rendered width of the runway
    // line (and the real pavement outline, wider still, when there is
    // one) — a fixed small offset was tuned for a thin centerline and left
    // the number sitting on top of it once runways started rendering
    // thicker (real pavement fill, or just a bolder stroke in full screen).
    const hasPavement = group.some(r => r.pavement)
    const padded = strokeWidth * 2.2 + fontSize + 6 + (hasPavement ? strokeWidth : 0)

    // A thin extended-centerline stub from each physical end out to its
    // label — with several runways close together or crossing, a number
    // floating in open space with nothing connecting it back is genuinely
    // ambiguous about which pavement it belongs to. Real airport diagrams
    // draw exactly this (the extended centerline past the threshold).
    const lx1 = p1.x - ux * padded, ly1 = p1.y - uy * padded
    const lx2 = p2.x + ux * padded, ly2 = p2.y + uy * padded

    return (
      <g key={gi}>
        {label1 && <line x1={p1.x} y1={p1.y} x2={lx1} y2={ly1} stroke="var(--text-tertiary)" strokeWidth="1.25" strokeDasharray="2 3" opacity="0.7" />}
        {label2 && <line x1={p2.x} y1={p2.y} x2={lx2} y2={ly2} stroke="var(--text-tertiary)" strokeWidth="1.25" strokeDasharray="2 3" opacity="0.7" />}
        {label1 && <text x={lx1} y={ly1} fontSize={fontSize} fontWeight="700" fill="var(--text-secondary)" textAnchor="middle" dominantBaseline="middle">{label1}</text>}
        {label2 && <text x={lx2} y={ly2} fontSize={fontSize} fontWeight="700" fill="var(--text-secondary)" textAnchor="middle" dominantBaseline="middle">{label2}</text>}
      </g>
    )
  })
}

// Real airport diagrams — including the FAA's own official chart — draw
// taxiways as thin, understated lines, not bold filled shapes; a solid fill
// reads as far busier than the real pavement is, especially at a hub
// reporting hundreds of small adjacent pieces. Outline-only rendering
// (stroke, no fill) gets much closer to that chart-like feel, and its low
// visual weight also means it stays unobtrusive at the fitted, zoomed-out
// view — exactly the "don't show it unless it can be small" balance a busy
// field needs — while still reading clearly once actually zoomed in.
const LABEL_ZOOM_THRESHOLD = 1.6

// Shared SVG content for both the mini card and the full-screen view —
// aprons → taxiways → runways → buildings/FBOs → helipads, back to front.
// Taxiway/apron name labels only render when `labels` is on (there's only
// room for them in the full-screen view, not the small card) AND the
// current zoom is past LABEL_ZOOM_THRESHOLD — at the fitted view a busy hub
// has 15+ names in a small area, more than can ever read cleanly; they
// appear once you've zoomed in enough for there to be real room.
function DiagramBody({ geo, project, fontSize = 9, runwayStroke = 7, taxiwayStroke = 1.3, labels = false, zoom = 1, viewport = null }) {
  const showLabels = labels && zoom >= LABEL_ZOOM_THRESHOLD
  return (
    <>
      <g opacity="0.18">
        {geo.aprons.map((a, i) => (
          <polygon key={`ap-${i}`} points={a.points.map(project).map(p => `${p.x},${p.y}`).join(' ')} fill="var(--text-tertiary)" />
        ))}
      </g>
      <g opacity="0.6">
        {geo.taxiways.filter(t => t.shape === 'polygon').map((t, i) => (
          // FAA-sourced taxiways carry their real pavement outline — traced
          // as an outline rather than filled, so real width still comes
          // through without reading as a solid block.
          <polygon key={`tw-${i}`} points={t.points.map(project).map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#c9a227" strokeWidth={taxiwayStroke} />
        ))}
      </g>
      {/* A taxilane is a service path across a ramp, not a movement-area
          taxiway. Drawn lighter so a GA apron reads as an apron rather than
          as a taxiway complex. */}
      {geo.taxiways.filter(t => t.shape !== 'polygon').map((t, i) => (
        <polyline key={`tw-line-${i}`} points={t.points.map(project).map(p => `${p.x},${p.y}`).join(' ')}
          fill="none" stroke="#c9a227"
          strokeWidth={t.kind === 'taxilane' ? taxiwayStroke * 0.7 : taxiwayStroke}
          strokeLinecap="round" strokeLinejoin="round"
          opacity={t.kind === 'taxilane' ? 0.4 : 0.6} />
      ))}
      <RealRunways geo={geo} project={project} strokeWidth={runwayStroke} />
      <RunwayLabels geo={geo} project={project} fontSize={fontSize} strokeWidth={runwayStroke} />
      {showLabels && resolveLabelCollisions([
        ...labelPositions(geo.aprons, project, 6, viewport).map(l => ({ ...l, kind: 'apron' })),
        // Taxilanes are excluded: they are usually unnamed, and the few that
        // aren't would spend the 14-label budget on ramp paths instead of
        // the taxiways a pilot is actually given by ground.
        ...labelPositions(geo.taxiways.filter(t => t.kind !== 'taxilane'), project, 14, viewport).map(l => ({ ...l, kind: 'taxiway' })),
      ]).map((l, i) => l.kind === 'apron' ? (
        <text key={`apl-${i}`} x={l.point.x} y={l.point.y} fontSize={fontSize * 0.85} fontWeight="600"
          fill="var(--text-secondary)" textAnchor="middle" dominantBaseline="middle" opacity="0.85"
          stroke="var(--bg)" strokeWidth="3" paintOrder="stroke">{l.name}</text>
      ) : (
        <text key={`twl-${i}`} x={l.point.x} y={l.point.y} fontSize={fontSize * 0.85} fontWeight="700"
          fill="#8a6d1a" textAnchor="middle" dominantBaseline="middle"
          stroke="var(--bg)" strokeWidth="3" paintOrder="stroke">{l.name}</text>
      ))}
      {geo.buildings.map((b, i) => {
        const pts = b.points.map(project)
        const fbo = isFBO(b.tags)
        return (
          <polygon key={`bd-${i}`} points={pts.map(p => `${p.x},${p.y}`).join(' ')}
            fill={fbo ? '#ff9f0a' : 'var(--text-tertiary)'} opacity={fbo ? 0.75 : 0.4} />
        )
      })}
      {geo.helipads.map((h, i) => {
        const p = project(h.points[0])
        return (
          <g key={`hp-${i}`}>
            <circle cx={p.x} cy={p.y} r={fontSize * 0.7} fill="none" stroke="var(--text-secondary)" strokeWidth="1.5" opacity="0.7" />
            <text x={p.x} y={p.y} fontSize={fontSize * 0.8} fontWeight="700" fill="var(--text-secondary)" textAnchor="middle" dominantBaseline="middle">H</text>
          </g>
        )
      })}
    </>
  )
}

// A pilot's live position + heading, projected onto the same diagram — the
// point of pairing this view with location services: taxiing at an
// unfamiliar field, knowing exactly where you are on the pavement.
function OwnShipMarker({ x, y, headingDeg }) {
  return (
    <g transform={`translate(${x},${y})`}>
      <circle r="16" fill="#0a84ff" opacity="0.16" />
      <g transform={`rotate(${headingDeg ?? 0})`}>
        <path d="M0,-13 L8,10 L0,5 L-8,10 Z" fill="#0a84ff" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" />
      </g>
    </g>
  )
}

function IconExpand({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 3H3v6M15 3h6v6M9 21H3v-6M15 21h6v-6" />
    </svg>
  )
}

function IconClose({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

const MIN_ZOOM = 1, MAX_ZOOM = 5

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)) }

// Full-screen airport diagram — same validated geometry as the mini card,
// drawn much larger, with an optional live "you are here" marker, and
// pinch/wheel/drag zoom for a closer look at taxiways and aprons. The
// diagram itself is SVG (vector), so zooming is a CSS transform on already-
// vector content — the browser re-renders it crisp at whatever scale,
// never a blown-up bitmap. Only mounted while the user has the view open,
// so location isn't polled otherwise.
function AirportDiagramFullscreen({ icao, geo, runways, cat, onClose }) {
  useBackOverride(onClose)
  const { coords, status } = useLiveLocation()
  const containerRef = useRef(null)
  const [view, setView] = useState({ scale: 1, tx: 0, ty: 0 })
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 })

  // Tracks the container's actual pixel size so the currently-visible
  // portion of the viewBox can be computed below — needed to know which
  // taxiways/aprons are actually in view for label selection (see
  // labelPositions' viewport param).
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setContainerSize({ width, height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const zoomAt = useCallback((anchorX, anchorY, factor) => {
    setView(prev => {
      const nextScale = clamp(prev.scale * factor, MIN_ZOOM, MAX_ZOOM)
      const ratio = nextScale / prev.scale
      return {
        scale: nextScale,
        // Keep the anchor point (cursor, pinch midpoint, tap point) visually
        // fixed while the scale changes, instead of always zooming from the
        // center — the standard "zoom to point" transform.
        tx: anchorX - (anchorX - prev.tx) * ratio,
        ty: anchorY - (anchorY - prev.ty) * ratio,
      }
    })
  }, [])

  const resetZoom = useCallback(() => setView({ scale: 1, tx: 0, ty: 0 }), [])

  // Wheel (desktop/trackpad) zoom, centered on the cursor — attached as a
  // native listener rather than React's onWheel so preventDefault reliably
  // stops the page from scrolling instead of zooming the diagram.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    function onWheel(e) {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, factor)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomAt])

  // Touch: one finger pans, two fingers pinch-zoom. Native listeners for
  // the same preventDefault reason as wheel above — otherwise the browser
  // treats this as a page-scroll/pull-to-refresh gesture instead.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    let pinch = null // { lastDist }
    let pan = null   // { lastX, lastY }
    let lastTap = { time: 0, x: 0, y: 0 }

    const dist = (t1, t2) => Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY)
    const midpoint = (t1, t2, rect) => ({ x: (t1.clientX + t2.clientX) / 2 - rect.left, y: (t1.clientY + t2.clientY) / 2 - rect.top })

    function onTouchStart(e) {
      if (e.touches.length === 2) {
        pinch = { lastDist: dist(e.touches[0], e.touches[1]) }
        pan = null
      } else if (e.touches.length === 1) {
        pan = { lastX: e.touches[0].clientX, lastY: e.touches[0].clientY }
        pinch = null
      }
    }
    function onTouchMove(e) {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      if (e.touches.length === 2 && pinch) {
        const d = dist(e.touches[0], e.touches[1])
        const m = midpoint(e.touches[0], e.touches[1], rect)
        zoomAt(m.x, m.y, d / pinch.lastDist)
        pinch.lastDist = d
      } else if (e.touches.length === 1 && pan) {
        const t = e.touches[0]
        const dx = t.clientX - pan.lastX, dy = t.clientY - pan.lastY
        setView(prev => ({ ...prev, tx: prev.tx + dx, ty: prev.ty + dy }))
        pan = { lastX: t.clientX, lastY: t.clientY }
      }
    }
    function onTouchEnd(e) {
      if (e.touches.length < 2) pinch = null
      if (e.touches.length === 0) pan = null
      // Double-tap to zoom in (or back out), anchored at the tap point.
      if (e.changedTouches.length !== 1) return
      const t = e.changedTouches[0]
      const rect = el.getBoundingClientRect()
      const x = t.clientX - rect.left, y = t.clientY - rect.top
      const now = Date.now()
      if (now - lastTap.time < 300 && Math.hypot(x - lastTap.x, y - lastTap.y) < 40) {
        setView(prev => prev.scale > 1.2 ? { scale: 1, tx: 0, ty: 0 } : {
          scale: 2.5, tx: x - (x - prev.tx) * (2.5 / prev.scale), ty: y - (y - prev.ty) * (2.5 / prev.scale),
        })
        lastTap = { time: 0, x: 0, y: 0 }
      } else {
        lastTap = { time: now, x, y }
      }
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd, { passive: true })
    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
    }
  }, [zoomAt])

  // Mouse drag-to-pan + double-click to zoom, for desktop/trackpad use.
  const dragRef = useRef(null)
  function onMouseDown(e) { dragRef.current = { lastX: e.clientX, lastY: e.clientY } }
  function onMouseMove(e) {
    if (!dragRef.current) return
    const dx = e.clientX - dragRef.current.lastX, dy = e.clientY - dragRef.current.lastY
    setView(prev => ({ ...prev, tx: prev.tx + dx, ty: prev.ty + dy }))
    dragRef.current = { lastX: e.clientX, lastY: e.clientY }
  }
  function onMouseUp() { dragRef.current = null }
  function onDoubleClick(e) {
    const rect = containerRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left, y = e.clientY - rect.top
    setView(prev => prev.scale > 1.2 ? { scale: 1, tx: 0, ty: 0 } : {
      scale: 2.5, tx: x - (x - prev.tx) * (2.5 / prev.scale), ty: y - (y - prev.ty) * (2.5 / prev.scale),
    })
  }

  const FW = 380, FH = 680
  const project = useMemo(
    () => computeProjection(geo, FW, FH, { top: 60, left: 40, right: 40, bottom: 40 }),
    [geo]
  )

  // Which part of the viewBox is actually visible right now, in viewBox
  // coordinates — accounts for both the SVG's own letterbox fit into the
  // container (preserveAspectRatio "meet") and the pan/zoom transform on
  // top of it. Used to scope label selection to what's actually in view
  // (see labelPositions) rather than a fixed global top-N.
  const viewport = useMemo(() => {
    if (!containerSize.width || !containerSize.height) return null
    const svgScale = Math.min(containerSize.width / FW, containerSize.height / FH)
    const offsetX = (containerSize.width - FW * svgScale) / 2
    const offsetY = (containerSize.height - FH * svgScale) / 2
    const localXMin = -view.tx / view.scale, localXMax = (containerSize.width - view.tx) / view.scale
    const localYMin = -view.ty / view.scale, localYMax = (containerSize.height - view.ty) / view.scale
    // A margin around the strict visible rect so labels don't pop in/out
    // right at the exact edge while panning.
    const marginX = (localXMax - localXMin) * 0.15, marginY = (localYMax - localYMin) * 0.15
    return {
      xMin: (localXMin - marginX - offsetX) / svgScale,
      xMax: (localXMax + marginX - offsetX) / svgScale,
      yMin: (localYMin - marginY - offsetY) / svgScale,
      yMax: (localYMax + marginY - offsetY) / svgScale,
    }
  }, [containerSize, view])

  const ownShipPt = (project && coords) ? project({ lat: coords.lat, lon: coords.lon }) : null
  const onDiagram = ownShipPt && ownShipPt.x > -30 && ownShipPt.x < FW + 30 && ownShipPt.y > -30 && ownShipPt.y < FH + 30

  const locationNote = onDiagram ? null
    : status === 'unsupported' || status === 'error' ? 'Location unavailable'
    : coords ? "You're not near this airport"
    : 'Locating…'

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 900, background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '20px 18px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, fontFamily: 'monospace', color: 'var(--text)', letterSpacing: '0.02em' }}>{icao}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {cat && (
            <span style={{
              fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', color: '#fff',
              background: cat.color, padding: '4px 10px', borderRadius: 20,
            }}>{cat.label}</span>
          )}
          <button onClick={onClose} style={{
            width: 36, height: 36, borderRadius: '50%', border: '0.5px solid var(--border)',
            background: 'var(--bg-card)', boxShadow: 'var(--shadow-md)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', color: 'var(--text)', flexShrink: 0,
          }}>
            <IconClose />
          </button>
        </div>
      </div>

      <div
        ref={containerRef}
        style={{ flex: 1, position: 'relative', overflow: 'hidden', touchAction: 'none', cursor: view.scale > 1 ? 'grab' : 'default' }}
        onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp}
        onDoubleClick={onDoubleClick}
      >
        <div style={{ width: '100%', height: '100%', transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`, transformOrigin: '0 0' }}>
          <svg viewBox={`0 0 ${FW} ${FH}`} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
            {geo && project ? (
              <DiagramBody geo={geo} project={project} fontSize={13} runwayStroke={10} taxiwayStroke={1.6} labels zoom={view.scale} viewport={viewport} />
            ) : (
              <AbstractRunways runways={runways} w={FW} h={FH} />
            )}
            {onDiagram && <OwnShipMarker x={ownShipPt.x} y={ownShipPt.y} headingDeg={coords?.headingDeg} />}
          </svg>
        </div>

        {view.scale > 1 && (
          <button onClick={resetZoom} style={{
            position: 'absolute', bottom: 18, left: 18,
            padding: '8px 14px', borderRadius: 20, border: '0.5px solid var(--border)',
            background: 'var(--bg-card)', boxShadow: 'var(--shadow-md)',
            color: 'var(--text)', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
          }}>
            Reset zoom
          </button>
        )}

        {locationNote && (
          <div style={{
            position: 'absolute', bottom: 18, left: 0, right: 0, textAlign: 'center',
            fontSize: 12, fontWeight: 600, color: 'var(--text-tertiary)', pointerEvents: 'none',
          }}>
            {locationNote}
          </div>
        )}
      </div>
    </div>
  )
}

export default function AirportDiagram({ icao, lat, lon, runways, cat, temp, windDir, windSpeed, vis, loading }) {
  const [geo, setGeo] = useState(undefined) // undefined = loading, null = nothing usable
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    setGeo(undefined)
    setExpanded(false)
    if (!icao || lat == null || lon == null) { setGeo(null); return }
    let cancelled = false
    fetchAirportGeometry(icao, lat, lon).then(g => { if (!cancelled) setGeo(g) }).catch(() => { if (!cancelled) setGeo(null) })
    return () => { cancelled = true }
  }, [icao, lat, lon])

  // Cross-check OSM's runway ways against the app's own trusted runway
  // list before drawing (or including in the projection's bounding box) —
  // see validateRunways() for why this matters.
  const validatedGeo = useMemo(() => {
    if (!geo) return geo
    return { ...geo, runways: validateRunways(geo.runways, runways) }
  }, [geo, runways])

  // Symmetric padding — keeps the diagram genuinely centered in the card
  // regardless of the airport's shape. The temp/wind/vis text corner is
  // protected separately by its own background scrim below, rather than by
  // skewing the diagram itself off-center to dodge it.
  const project = useMemo(
    () => computeProjection(validatedGeo, W, H, { top: 40, left: 40, right: 40, bottom: 40 }),
    [validatedGeo]
  )

  return (
    <>
      <div
        onClick={() => setExpanded(true)}
        role="button" tabIndex={0}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(true) } }}
        aria-label="Expand airport diagram"
        style={{
          position: 'relative', borderRadius: 20, overflow: 'hidden', height: 180,
          background: 'linear-gradient(160deg, var(--bg-card-2), var(--bg-card))',
          boxShadow: 'var(--shadow-sm)', isolation: 'isolate',
          cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
        }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
          {geo === undefined ? null : validatedGeo && project ? (
            <DiagramBody geo={validatedGeo} project={project} />
          ) : (
            <AbstractRunways runways={runways} />
          )}
        </svg>

        {/* Legibility backstop for the text block below — even with the
            diagram's own geometry pushed clear of this corner, this keeps
            the temp/wind/vis readout legible against any edge case. */}
        <div style={{
          position: 'absolute', top: 0, left: 0, width: 140, height: 108,
          background: 'radial-gradient(ellipse at 16px 16px, var(--bg-card-2) 0%, var(--bg-card-2) 48%, transparent 78%)',
          pointerEvents: 'none',
        }} />

        <div style={{ position: 'absolute', top: 12, left: 14 }}>
          <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--text)', letterSpacing: '-1px', lineHeight: 1 }}>
            {loading ? '…' : temp}
          </div>
          {!loading && (
            <div style={{ marginTop: 4, fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', lineHeight: 1.45 }}>
              {windDir && <div>{windDir}</div>}
              <div>{windSpeed}</div>
              <div>{vis}</div>
            </div>
          )}
        </div>

        {cat && (
          <span style={{
            position: 'absolute', top: 14, right: 14,
            fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', color: '#fff',
            background: cat.color, padding: '4px 10px', borderRadius: 20,
          }}>{cat.label}</span>
        )}

        <span style={{
          position: 'absolute', bottom: 10, right: 12, color: 'var(--text-tertiary)',
          opacity: 0.7, display: 'flex',
        }}>
          <IconExpand />
        </span>
      </div>

      {expanded && (
        <AirportDiagramFullscreen
          icao={icao}
          geo={validatedGeo}
          runways={runways}
          cat={cat}
          onClose={() => setExpanded(false)}
        />
      )}
    </>
  )
}
