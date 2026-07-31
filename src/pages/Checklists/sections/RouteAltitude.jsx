import 'leaflet/dist/leaflet.css'
import { useState, useEffect, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { MapContainer, TileLayer, Marker, Polyline, Polygon, CircleMarker, Popup, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import FAA_CHARTS_DATA from '../../../data/faa_charts.json'
import { get, put } from '../../../lib/db'
import { ExpandableCard, DoneButton, Bone } from '../shared/ui'
import { FAA_CHART_CYCLE } from '../shared/faaData'
import { awcUrl, proxyFetch, fetchAWC, lookupAirport, parseMetar, bearingDeg, haversineNm } from '../shared/awc'
import { resolveWaypoint, saveUserWaypoint, looksLikeAirway, lookupAirway, expandAirway, getAirwayGeometry, getWorldRef } from '../../../lib/waypoints'
import { sampleRoute } from '../../../lib/corridor'
import { analyzeTerrain, MOUNTAIN_FT } from '../../../lib/terrain'
import { analyzeWater } from '../../../lib/water'
import { analyzeAerodromes } from '../../../lib/aerodromes'
import { analyzeAirspace } from '../../../lib/airspace'
import { recommendCruise, fmtAlt } from '../../../lib/cruiseAdvisor'
import { parseAircraftPerf } from '../../../lib/climbPerf'
import CrossSection from './CrossSection'
import DropPicker from './DropPicker'
import AerodromePopup from './AerodromePopup'
import { fetchBriefing } from '../../../lib/altitudeBrief'
import { lookupRoutes, classifyRoute } from '../../../lib/preferredRoutes'
import { expandProcedure } from '../../../lib/procedures'

delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

// The three ways a published routing can relate to the pair being flown, in
// descending order of how directly it answers the question. The two fallbacks
// only appear when nothing is published for the pair itself, and each carries
// the reason it might not apply — a routing that isn't for your route is
// useful as a starting point and dangerous as an answer.
const PUB_GROUPS = [
  { key: 'exact' },
  { key: 'reverse', heading: 'Published the other way',
    note: 'Only the opposite direction is published. Often flyable read backwards — but routings are frequently one-way by design, so check it against your clearance.' },
  { key: 'nearby', heading: 'Published for a nearby field',
    note: 'Same terminal airspace, same facility, different field at one end. The middle of the routing usually holds; the departure or arrival end may not.' },
]

function RouteFitter({ positions, once = true }) {
  const map = useMap()
  const fitted = useRef(false)
  useEffect(() => {
    // once=true (fullscreen): fit when the map opens, then never again —
    // snapping the view away right after the user adds/drags a waypoint is
    // exactly the "random zoom" ForeFlight never does. The user owns the
    // camera. once=false (inline preview): the map isn't user-pannable, so
    // keep re-framing the whole route as it changes.
    if (once && fitted.current) return
    if (positions.length >= 2) {
      fitted.current = true
      // The fullscreen map mounts before its container has its final size —
      // fitting immediately frames the route against the wrong dimensions
      // (the "opens in the middle of nowhere" bug). Invalidate then fit.
      const doFit = () => {
        map.invalidateSize()
        map.fitBounds(L.latLngBounds(positions), { padding: [36, 36], animate: false })
      }
      const t1 = setTimeout(doFit, 80)
      // On phones the modal can still be mid-layout at 80ms — re-assert once
      // more after layout is guaranteed settled (before any user interaction).
      const t2 = setTimeout(doFit, 450)
      return () => { clearTimeout(t1); clearTimeout(t2) }
    }
  }, [JSON.stringify(positions)])
  return null
}

function AirspaceZoomer({ active }) {
  const map = useMap()
  useEffect(() => {
    if (active && map.getZoom() < 8) {
      map.setZoom(9)
    }
  }, [active])
  return null
}

// Nudge into a chart's readable range once when it's toggled on (below its
// minZoom the chart doesn't render at all). No continuous clamp: the user may
// zoom out freely and the chart simply hands off to the basemap instead of
// fighting the gesture.
// Bring a chart layer into the range where it actually draws.
//
// `min` must match the TileLayer's own minZoom. The sectional's was one level
// below it, so turning SECT on zoomed to 7, the service serves nothing below
// 8, and the chart appeared to do nothing at all until the user zoomed again
// by hand.
//
// Zooming also moves to the route rather than staying wherever the camera
// happened to be: a chart is turned on to see the flight on it, and at z8 a
// view centred somewhere else shows chart with no route on it, which is the
// same "nothing happened" from the other direction.
function ChartZoomer({ active, min, positions }) {
  const map = useMap()
  const prev = useRef(active)
  useEffect(() => {
    // Only when the user TOGGLES the layer on — not when a map mounts with the
    // layer already active, which would override the fit-whole-route framing
    // on fullscreen open.
    if (active && !prev.current && map.getZoom() < min) {
      // Keep the part of the route they were already looking at: the nearest
      // route point to the current centre, rather than always the midpoint.
      const c = map.getCenter()
      let target = null, best = Infinity
      for (const p of positions ?? []) {
        const d = haversineNm(c.lat, c.lng, p[0], p[1])
        if (d < best) { best = d; target = p }
      }
      if (target) map.setView(target, min)
      else map.setZoom(min)
    }
    prev.current = active
  }, [active])
  return null
}

function MapInvalidator() {
  const map = useMap()
  useEffect(() => {
    setTimeout(() => map.invalidateSize(), 50)
  }, [])
  return null
}

function MapFlyTo({ target, instant = false }) {
  const map = useMap()
  useEffect(() => {
    if (!target) return
    if (!Number.isFinite(target.lat) || !Number.isFinite(target.lon)) return
    const zoom = target.zoom ?? 10

    const go = () => {
      // Leaflet's camera maths divide by the container size. On a map that
      // has not been laid out yet that is a division by zero, and the NaN
      // reaches L.latLng, which throws and takes the whole card down with it.
      // A move can absolutely arrive that early — tapping the Mountains chip
      // opens fullscreen and asks for the peak in the same breath.
      const size = map.getSize()
      if (!size.x || !size.y) return false

      let center = L.latLng(target.lat, target.lon)
      // offsetFrac pushes the subject up out from under a sheet. Centring is
      // the obvious thing and the wrong one when two thirds of the map is
      // covered by a popup: the airport you just asked to see ends up behind
      // the panel describing it. Shifting the map's centre south by a fraction
      // of the viewport lifts the point into the strip that is actually
      // visible.
      if (target.offsetFrac) {
        const pt = map.project(center, zoom).add([0, size.y * target.offsetFrac])
        center = map.unproject(pt, zoom)
      }
      // setView, not flyTo. Leaflet's flyTo does not interpolate between two
      // views — it flies a parabolic arc, zooming out far enough to span the
      // distance before zooming back in on the target. Tapping a field then
      // reads as the map retreating to the route overview and only then
      // approaching, which is the opposite of what the tap asked for. An
      // animated setView moves from where the map already is, and the zoom
      // only ever goes one way.
      //
      // animate: true is load-bearing twice over. It opts out of Leaflet's
      // "is the target still on screen" test, which would otherwise refuse to
      // animate to anything off the current view — i.e. exactly the taps this
      // is for. The map's zoomAnimationThreshold is raised alongside it, since
      // the default of 4 refuses a route overview at zoom 7 going to a subject
      // at 13. Duration is not passed: the zoom animation runs on a fixed
      // 250 ms CSS transition and ignores it.
      if (instant) map.setView(center, zoom, { animate: false })
      else map.setView(center, zoom, { animate: true })
      return true
    }

    if (go()) return
    // Not laid out yet. Leaflet fires resize once the container has a size,
    // which is the earliest moment this can succeed.
    const onResize = () => { if (go()) map.off('resize', onResize) }
    map.on('resize', onResize)
    return () => map.off('resize', onResize)
  }, [target])
  return null
}

// Ink for the markers this app draws on top of a chart — the control tower
// for a field, the peak for the highest terrain.
//
// Colour follows whichever chart is underneath, because each one has its
// own palette and a marker that reads as part of the chart is easier to
// separate from it than one fighting it. What guarantees the contrast is not
// the colour choice though — it is the white halo the whole glyph is drawn
// on. Sectionals go from pale green to tan to dark magenta airspace within an
// inch, so any single ink colour will land on something close to itself
// somewhere; the halo means that never matters.
function chartInk(layers) {
  if (layers.ifrhi) return '#0d2f52'        // high charts: pale blue-grey
  if (layers.ifrlo) return '#0f3a2a'        // low charts: white with blue/green ink
  if (layers.sectional) return '#4a1042'    // sectional: tan and green, magenta ink
  return '#12233b'                          // plain basemap: cream and pale blue
}

// How big the tower is drawn, by zoom.
//
// One fixed size cannot serve both ends: at route zoom a dozen 26px towers
// crowd the line they are meant to annotate, and zoomed in on a field the same
// glyph is a speck against a chart. So it grows with the view — small enough
// to read as an annotation when the whole route is on screen, large enough to
// be the subject when you are looking at one field.
function aerodromeGlyphPx(zoom) {
  const t = Math.max(0, Math.min(1, (zoom - 7) / 6))     // z7 and below → min, z13+ → max
  return Math.round(13 + t * 17)                          // 13px … 30px
}

const AERO_ICON_CACHE = new Map()
function aerodromeIcon(ink, px) {
  const key = `${ink}@${px}`
  const hit = AERO_ICON_CACHE.get(key)
  if (hit) return hit
  // The touch target stays comfortably bigger than the glyph, but does not
  // hold at 44px when the glyph is 13: at route zoom the fields sit close
  // together and full-size boxes would overlap into each other's taps.
  const box = Math.max(30, px + 12)
  const icon = L.divIcon({
    className: '', iconSize: [box, box], iconAnchor: [box / 2, box / 2],
    html: `<div style="width:${box}px;height:${box}px;display:flex;align-items:center;justify-content:center;cursor:pointer;">
      <svg width="${px}" height="${px}" viewBox="0 0 24 24"
           style="filter:drop-shadow(0 0 1.5px #fff) drop-shadow(0 0 1.5px #fff) drop-shadow(0 1px 2px rgba(0,0,0,0.4));">
        <g fill="${ink}">
          <circle cx="12" cy="3.1" r="2.15"/>
          <rect x="11.15" y="4.7" width="1.7" height="2.5"/>
          <rect x="4.8" y="7.1" width="14.4" height="2.3" rx="0.2"/>
          <path d="M6.3 9.4h11.4v5.3l-2.7 3.1H9l-2.7-3.1z"/>
          <rect x="9.1" y="18.1" width="5.8" height="4.5"/>
          <path d="M3.5 1.6a6.6 6.6 0 0 0 0 8.2" fill="none" stroke="${ink}" stroke-width="1.9" stroke-linecap="round"/>
          <path d="M20.5 1.6a6.6 6.6 0 0 1 0 8.2" fill="none" stroke="${ink}" stroke-width="1.9" stroke-linecap="round"/>
        </g>
        <g fill="#fff">
          <rect x="7.5" y="10.4" width="2.2" height="3.2"/>
          <rect x="10.9" y="10.4" width="2.2" height="3.2"/>
          <rect x="14.3" y="10.4" width="2.2" height="3.2"/>
        </g>
      </svg>
    </div>`,
  })
  AERO_ICON_CACHE.set(key, icon)
  return icon
}

// The highest ground within the corridor, drawn where it actually is.
//
// The Mountains card gives a height and a coordinate, which is the right
// answer to "how high" and no answer at all to "where" — 235 NM along a route
// is not a place you can picture. One marker turns it into one.
const PEAK_ICON_CACHE = new Map()
function peakIcon(ink, px) {
  const key = `${ink}@${px}`
  const hit = PEAK_ICON_CACHE.get(key)
  if (hit) return hit
  const box = Math.max(30, px + 12)
  const icon = L.divIcon({
    className: '', iconSize: [box, box], iconAnchor: [box / 2, box / 2],
    html: `<div style="width:${box}px;height:${box}px;display:flex;align-items:center;justify-content:center;cursor:pointer;">
      <svg width="${px}" height="${px}" viewBox="0 0 24 24"
           style="filter:drop-shadow(0 0 1.5px #fff) drop-shadow(0 0 1.5px #fff) drop-shadow(0 1px 2px rgba(0,0,0,0.4));">
        <path d="M1.4 20.2 L8.6 4.2 L12.7 11.6 L15.6 7.4 L22.6 20.2 Z" fill="${ink}"/>
        <path d="M8.6 4.2 L6.6 8.6 L8.0 8.0 L9.2 9.2 L10.6 8.2 Z" fill="#fff"/>
        <path d="M15.6 7.4 L14.2 10.0 L15.3 9.7 L16.2 10.6 L17.1 9.8 Z" fill="#fff"/>
      </svg>
    </div>`,
  })
  PEAK_ICON_CACHE.set(key, icon)
  return icon
}

function PeakMarker({ peak, layers, onOpen, focused }) {
  const map = useMap()
  const [zoom, setZoom] = useState(() => map.getZoom())
  useEffect(() => {
    const sync = () => setZoom(map.getZoom())
    map.on('zoomend', sync)
    return () => { map.off('zoomend', sync) }
  }, [map])
  if (!peak || peak.lat == null || peak.lon == null) return null
  const px = aerodromeGlyphPx(zoom)
  const icon = focused
    ? peakIcon('#FF9500', Math.round(px * 1.35))
    : peakIcon(chartInk(layers), px)
  return (
    <Marker position={[peak.lat, peak.lon]} icon={icon} zIndexOffset={focused ? 1000 : 0}
      eventHandlers={{ click: e => { L.DomEvent.stopPropagation(e); onOpen?.() } }} />
  )
}

// The fields themselves. Split out so tracking the zoom re-renders these
// markers and nothing else on the map.
function AerodromeMarkers({ fields, layers, onAerodrome, highlightIdent }) {
  const map = useMap()
  const [zoom, setZoom] = useState(() => map.getZoom())
  useEffect(() => {
    const sync = () => setZoom(map.getZoom())
    map.on('zoomend', sync)
    return () => { map.off('zoomend', sync) }
  }, [map])

  const px = aerodromeGlyphPx(zoom)
  const icon = aerodromeIcon(chartInk(layers), px)
  // The field whose popup is open is the subject of the view, so it is drawn
  // larger and in the accent colour — otherwise it is indistinguishable from
  // its neighbours at exactly the moment it matters which one you tapped.
  const openIcon = aerodromeIcon('#FF9500', Math.round(px * 1.35))
  return (fields ?? []).map(f => (
    <Marker key={`aero-${f.ident}`} position={[f.lat, f.lon]}
      icon={f.ident === highlightIdent ? openIcon : icon}
      zIndexOffset={f.ident === highlightIdent ? 1000 : 0} interactive={true}
      eventHandlers={{ click: e => { L.DomEvent.stopPropagation(e); onAerodrome?.(f) } }} />
  ))
}

// Re-frame the whole route on demand.
//
// This exists because "back to route" first tried to compute a zoom from the
// route's length, and a zoom level is the wrong thing to guess: what fits
// depends on the viewport's width, the latitude and the route's shape, not
// just its distance. An 83 NM route came back at zoom 10, which shows about
// 26 NM. fitBounds already accounts for all of it, so the nonce just asks
// Leaflet to do what RouteFitter does on open.
function RouteRefit({ nonce, positions }) {
  const map = useMap()
  useEffect(() => {
    if (!nonce || positions.length < 2) return
    map.fitBounds(L.latLngBounds(positions), { padding: [40, 40] })
  }, [nonce])
  return null
}

// Line-segment intersection (2D, lat/lon space)
function segmentsIntersect(p1, p2, p3, p4) {
  const d = (p2[0]-p1[0])*(p4[1]-p3[1]) - (p2[1]-p1[1])*(p4[0]-p3[0])
  if (Math.abs(d) < 1e-10) return false
  const t = ((p3[0]-p1[0])*(p4[1]-p3[1]) - (p3[1]-p1[1])*(p4[0]-p3[0])) / d
  const u = ((p3[0]-p1[0])*(p2[1]-p1[1]) - (p3[1]-p1[1])*(p2[0]-p1[0])) / d
  return t >= 0 && t <= 1 && u >= 0 && u <= 1
}

// Point-in-polygon (ray casting)
function pointInPoly(pt, poly) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j]
    if (((yi > pt[1]) !== (yj > pt[1])) && pt[0] < ((xj-xi)*(pt[1]-yi)/(yj-yi)+xi))
      inside = !inside
  }
  return inside
}

// Does the route (array of {lat,lon} waypoints) cross or enter a polygon [lat,lon][]?
function routeIntersectsPoly(waypoints, poly) {
  for (let s = 0; s < waypoints.length - 1; s++) {
    const ra = [waypoints[s].lat, waypoints[s].lon]
    const rb = [waypoints[s+1].lat, waypoints[s+1].lon]
    if (pointInPoly(ra, poly) || pointInPoly(rb, poly)) return true
    for (let i = 0, j = poly.length-1; i < poly.length; j = i++) {
      if (segmentsIntersect(ra, rb, poly[j], poly[i])) return true
    }
  }
  return false
}

// The phone's clock as a datetime-local value: local time, whole minutes.
// datetime-local has no timezone, so the offset is applied before slicing
// rather than taking the UTC string and hoping.
function nowLocalISO() {
  const d = new Date()
  d.setSeconds(0, 0)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

// Format decimal lat/lon → aviation DMS notation: N25°47'42" W080°17'24"
function fmtAvCoord(lat, lon) {
  const fmt = (val, padDeg) => {
    const d = Math.floor(Math.abs(val))
    const mFull = (Math.abs(val) - d) * 60
    const m = Math.floor(mFull)
    const s = Math.round((mFull - m) * 60)
    return `${String(d).padStart(padDeg, '0')}°${String(m).padStart(2,'0')}'${String(s).padStart(2,'0')}"`
  }
  const ns = lat >= 0 ? 'N' : 'S', ew = lon >= 0 ? 'E' : 'W'
  return `${ns}${fmt(lat, 2)} ${ew}${fmt(lon, 3)}`
}

// Cross-track distance from point (la,lo) to great-circle segment (a→b), in NM
function crossTrackNM(la, lo, a, b) {
  const R = 3440.065 // NM
  const toRad = d => d * Math.PI / 180
  const [lat1,lon1] = a.map(toRad), [lat2,lon2] = b.map(toRad)
  const [lat3,lon3] = [toRad(la), toRad(lo)]
  const d13 = Math.acos(Math.sin(lat1)*Math.sin(lat3)+Math.cos(lat1)*Math.cos(lat3)*Math.cos(lon3-lon1))
  const θ13 = Math.atan2(Math.sin(lon3-lon1)*Math.cos(lat3), Math.cos(lat1)*Math.sin(lat3)-Math.sin(lat1)*Math.cos(lat3)*Math.cos(lon3-lon1))
  const θ12 = Math.atan2(Math.sin(lon2-lon1)*Math.cos(lat2), Math.cos(lat1)*Math.sin(lat2)-Math.sin(lat1)*Math.cos(lat2)*Math.cos(lon2-lon1))
  return Math.abs(Math.asin(Math.sin(d13)*Math.sin(θ13-θ12))) * R
}

// DraggableWaypoint — draggable intermediate marker (touch-safe)
// Which waypoint labels there is actually room for.
//
// An airway expands into every fix along it — V23 and V8 between KSAN and KLAX
// bring eight — and on a 240 px inline map their labels land on top of each
// other in an unreadable stack. The dots all stay, because they are the shape
// of the route; the text is what gets thinned.
//
// Priority order, so what survives is what a pilot actually needs: the two
// endpoints always, then the points they entered themselves (the turning
// points that define the routing), then the fixes an airway expanded into. A
// label is kept only if its box clears every label already placed, measured in
// screen space so the answer changes as you zoom — zoom in and the fixes
// reappear one by one as the room opens up.
function useLabelRoom(waypoints) {
  const map = useMap()
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const bump = () => setTick(t => t + 1)
    map.on('zoomend', bump); map.on('moveend', bump); map.on('resize', bump)
    return () => { map.off('zoomend', bump); map.off('moveend', bump); map.off('resize', bump) }
  }, [map])

  return useMemo(() => {
    const keep = new Set()
    const placed = []
    const last = waypoints.length - 1
    // 10px monospace, ~6px per character, plus the pill's padding.
    const halfWidth = w => ((w.name?.length ?? 3) * 6 + 14) / 2
    const mid = waypoints.map((_, i) => i).slice(1, -1)
    const order = [
      0, last,
      ...mid.filter(i => !waypoints[i].via),
      ...mid.filter(i => waypoints[i].via),
    ]
    for (const i of order) {
      const w = waypoints[i]
      if (!w || keep.has(i) || !Number.isFinite(w.lat)) continue
      let pt
      try { pt = map.latLngToContainerPoint([w.lat, w.lon]) } catch { continue }
      const half = halfWidth(w)
      const clear = placed.every(p => Math.abs(p.x - pt.x) > (p.half + half + 4) || Math.abs(p.y - pt.y) > 20)
      // The endpoints are never dropped — a route with no idea where it starts
      // or ends is worse than a crowded one.
      if (i !== 0 && i !== last && !clear) continue
      placed.push({ x: pt.x, y: pt.y, half })
      keep.add(i)
    }
    return keep
    // `tick` looks unused to the linter and is the whole point: the projected
    // positions come from the map, which is not a reactive value, so the view
    // counter is what says "recompute, the screen moved".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, tick, waypoints])
}

function DraggableWaypoint({ position, index, onMove, onRemove, name, showLabel = true, removable = true }) {
  const markerRef = useRef(null)
  // touch-action:none is critical — prevents browser scroll from hijacking the drag
  // Waypoints look identical to the dep/dest airport dots (white, dark ring);
  // named ones show their identifier on a label underneath. The 28px box is an
  // invisible touch target around the 12px visual dot.
  // The icon MUST be referentially stable across renders: a fresh divIcon
  // object every render makes react-leaflet reset the marker's icon, which
  // rebuilds its DOM element and kills any in-progress drag after a few
  // pixels ("can only move it little by little"). Memoize on the label.
  const icon = useMemo(() => {
    const label = name && showLabel
      ? `<div style="position:absolute;top:34px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.72);color:#fff;font:700 10px monospace;letter-spacing:0.5px;border-radius:5px;padding:1px 6px;white-space:nowrap;">${name}</div>`
      : ''
    // 44×44 touch target (Apple HIG minimum) around a 14px visual dot —
    // smaller boxes are genuinely hard to grab with a finger on iOS.
    return L.divIcon({
      className: '', iconSize: [44, 44], iconAnchor: [22, 22],
      html: `<div style="position:relative;width:44px;height:44px;cursor:grab;touch-action:none;display:flex;align-items:center;justify-content:center;">
        <div style="width:14px;height:14px;border-radius:50%;background:#fff;border:3px solid #333;box-shadow:0 1px 6px rgba(0,0,0,0.4);box-sizing:border-box;"></div>${label}
      </div>`
    })
  }, [name, showLabel])
  useEffect(() => {
    const marker = markerRef.current
    if (!marker) return
    // Ensure dragging is enabled and works on touch
    const m = marker.getLeafletElement ? marker.getLeafletElement() : marker
    if (m?.dragging) m.dragging.enable()
  }, [])
  return (
    <Marker
      ref={markerRef}
      position={position}
      icon={icon}
      draggable={true}
      eventHandlers={{
        // Commit position only on release — updating state on every `drag`
        // frame re-renders the marker mid-gesture and interrupts the drag.
        // Leaflet moves the marker itself while the finger is down.
        dragend: (e) => onMove(index, e.target.getLatLng()),
        click:   (e) => { L.DomEvent.stopPropagation(e) },
        ...(removable ? { contextmenu: () => onRemove(index) } : {}),
      }}
    />
  )
}

// PolylineEditor — the route line, and the rubber-band drag that bends it.
//
// Grab the magenta line anywhere and pull: the two legs either side follow the
// finger live, and letting go puts a waypoint there. This is the gesture from
// ForeFlight, and the thing that makes it feel right is that nothing waits for
// React — the temporary line and dot are Leaflet layers moved directly on each
// pointer frame. Routing every move through state re-renders the map mid-drag,
// which is what made earlier attempts stutter and drop the gesture.
//
// A tap with no movement still opens the picker; a drag commits the point where
// it was released and then offers to snap it to whatever is charted there.
function PolylineEditor({ waypoints, onDragInsert }) {
  const map = useMap()
  const positions = waypoints.map(w => [w.lat, w.lon])
  const drag = useRef(null)
  const hitRef = useRef(null)
  const visRef = useRef(null)
  // Every temporary layer this editor has put on the map. drag.current only
  // ever holds the newest pair; this holds all of them, so cleanup can sweep
  // up anything an interrupted gesture left behind.
  const tempLayers = useRef([])

  // Which leg is nearest — the one the bend belongs to.
  const segmentAt = (lat, lon) => {
    let bestSeg = 1, bestDist = Infinity
    for (let i = 0; i < waypoints.length - 1; i++) {
      const d = crossTrackNM(lat, lon, [waypoints[i].lat, waypoints[i].lon], [waypoints[i + 1].lat, waypoints[i + 1].lon])
      if (d < bestDist) { bestDist = d; bestSeg = i + 1 }
    }
    return bestSeg
  }

  // The route as it would look with the bend at `seg`.
  const withBend = (seg, ll) => {
    const next = positions.map(p => [...p])
    next.splice(seg, 0, [ll.lat, ll.lng])
    return next
  }

  useEffect(() => {
    const pointFrom = (ev) => {
      const t = ev.touches?.[0] ?? ev.changedTouches?.[0] ?? ev
      if (t.clientX == null) return null
      return map.containerPointToLatLng(
        map.mouseEventToContainerPoint({ clientX: t.clientX, clientY: t.clientY }))
    }

    const onMove = (ev) => {
      const d = drag.current
      if (!d) return
      const ll = pointFrom(ev)
      if (!ll) return
      // Past this distance it is a drag, not a tap that wobbled. 6px was
      // inside the noise of a finger resting on a line — routes picked up
      // bends nobody asked for. A deliberate pull moves much further than
      // this before the user expects anything to happen.
      if (!d.moved && map.latLngToContainerPoint(ll).distanceTo(d.startPx) > 18) d.moved = true
      if (!d.moved) return
      ev.preventDefault()
      d.latlng = ll
      d.line.setLatLngs(withBend(d.seg, ll))
      d.dot.setLatLng(ll)
    }

    const onUp = () => {
      const d = drag.current
      if (!d) return
      drag.current = null
      map.removeLayer(d.line); map.removeLayer(d.dot)
      tempLayers.current = tempLayers.current.filter(l => l !== d.line && l !== d.dot)
      visRef.current?.setStyle({ opacity: 0.65 })
      map.dragging.enable()
      const { lat, lng } = d.latlng
      // Only a pull does anything. Tapping the line used to open the "add to
      // route" picker, which made the single easiest thing to hit by accident
      // — a magenta line across the whole map — into a waypoint prompt. The
      // deliberate ways to add a point are still both there: pull the line, or
      // press and hold anywhere.
      if (d.moved) onDragInsert({ lat, lon: lng, seg: d.seg })
    }

    // Window-level, so a finger that leaves the map mid-drag still finishes the
    // gesture rather than stranding a half-drawn line.
    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    window.addEventListener('touchmove', onMove, { passive: false })
    window.addEventListener('touchend', onUp)
    // The gesture has to start on a real pointer event. Leaflet's own
    // `mousedown` on a path is a compatibility event on touch — it arrives
    // after the finger lifts, far too late to drag anything.
    const path = hitRef.current?._path
    const onDown = (ev) => {
      // One finger fires BOTH pointerdown and touchstart. Without this guard
      // startDrag ran twice and the second call overwrote drag.current — so
      // the first temporary line and dot lost their only reference and stayed
      // on the map forever, a stray purple course line and vertex that no
      // amount of deleting waypoints would clear, because nothing knew they
      // existed any more.
      if (drag.current) return
      const ll = pointFrom(ev)
      if (!ll) return
      ev.stopPropagation()
      startDrag(ev, ll)
    }
    if (path) {
      path.style.touchAction = 'none'
      path.style.cursor = 'grab'
      path.addEventListener('pointerdown', onDown)
      // Only where pointer events do not exist, so the two never both fire.
      if (!window.PointerEvent) path.addEventListener('touchstart', onDown, { passive: false })
    }

    function startDrag(ev, latlng) {
      const seg = segmentAt(latlng.lat, latlng.lng)
      map.dragging.disable()
      const prev = positions[seg - 1], next = positions[seg]
      // The temporary line is the whole route with the bend spliced in, drawn
      // exactly like the real one — so what you drag is the route itself, not a
      // dashed preview floating next to the old course.
      visRef.current?.setStyle({ opacity: 0 })
      drag.current = {
        seg, prev, next, latlng, moved: false,
        startPx: map.latLngToContainerPoint(latlng),
        line: L.polyline(withBend(seg, latlng), {
          color: '#a855f7', weight: 4, opacity: 0.65,
        }).addTo(map),
        dot: L.circleMarker(latlng, {
          radius: 8, color: '#fff', weight: 2.5, fillColor: '#a855f7', fillOpacity: 1,
        }).addTo(map),
      }
      tempLayers.current.push(drag.current.line, drag.current.dot)
      if (ev?.preventDefault && ev.cancelable) ev.preventDefault()
    }

    return () => {
      if (path) {
        path.removeEventListener('pointerdown', onDown)
        path.removeEventListener('touchstart', onDown)
      }
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onUp)
      const d = drag.current
      if (d) {
        visRef.current?.setStyle({ opacity: 0.65 })
        map.dragging.enable()
        drag.current = null
      }
      // Sweep every temporary layer, not just the current drag's pair.
      for (const layer of tempLayers.current) {
        if (map.hasLayer(layer)) map.removeLayer(layer)
      }
      tempLayers.current = []
    }
  }, [map, JSON.stringify(positions)])

  return (<>
    {/* Thick invisible hit-area so a finger finds the line — 36px ≈ a fingertip */}
    <Polyline
      ref={hitRef}
      positions={positions}
      pathOptions={{ color: 'transparent', weight: 36, opacity: 0 }}
    />
    {/* Visible line — ForeFlight-style magenta/purple course line, slightly
        translucent. Hidden while a drag is in progress: the dragged line takes
        its place, so the route bends rather than gaining a second line. */}
    <Polyline ref={visRef} positions={positions} pathOptions={{ color: '#a855f7', weight: 4, opacity: 0.65 }} />
  </>)
}

// Regions with an authoritative, current navdata pack (FAA NASR, SENEAM,
// COCESNA). Outside these, the map falls back to the Tier-2 reference layer —
// which the pilot must be told about.
const TIER1_BOXES = [
  [24.0, 50.0, -125.0, -66.0],   // CONUS
  [51.0, 72.0, -170.0, -129.0],  // Alaska
  [18.0, 23.0, -161.0, -154.0],  // Hawaii
  [14.0, 33.0, -118.0, -86.0],   // Mexico
  [5.0, 19.5, -93.0, -77.0],     // Central America
]
// NPS park boundaries and FAA Special Use Airspace are United States
// services. Outside these boxes their silence means "not covered", which is
// not the same as "nothing there" — the difference is disclosed rather than
// left to look like clearance.
const US_BOXES = [
  [24.0, 50.0, -125.0, -66.0],   // CONUS
  [51.0, 72.0, -170.0, -129.0],  // Alaska
  [18.0, 23.0, -161.0, -154.0],  // Hawaii
]
function touchesUS(waypoints) {
  return waypoints.some(w => US_BOXES.some(([s, n, wst, e]) =>
    w.lat >= s && w.lat <= n && w.lon >= wst && w.lon <= e))
}

function inTier1(lat, lon) {
  return TIER1_BOXES.some(([s, n, w, e]) => lat >= s && lat <= n && lon >= w && lon <= e)
}

// WorldRefLayer — TIER 2. Global airway structure for regions we have no
// authoritative pack for, drawn thin/dashed/grey so it never reads as the
// navy Tier-1 network. The data is a 2012 GPL snapshot: good for orientation,
// not for navigation, and the route planner cannot expand it.
function WorldRefLayer({ cls }) {
  const map = useMap()
  const [items, setItems] = useState(null)
  const [, setTick] = useState(0)
  useMapEvents({ moveend: () => setTick(t => t + 1), zoomend: () => setTick(t => t + 1) })
  useEffect(() => {
    let cancelled = false
    getWorldRef().then(d => { if (!cancelled) setItems(d) })
    return () => { cancelled = true }
  }, [])
  if (!items) return null

  const b = map.getBounds().pad(0.25)
  const n = b.getNorth(), s = b.getSouth(), w = b.getWest(), e = b.getEast()
  const wantHi = cls === 'hi'
  const out = []
  for (const it of items) {
    if (it.hi !== wantHi) continue
    const [minLat, maxLat, minLon, maxLon] = it.bbox
    // bbox overlap with the viewport
    if (minLat > n || maxLat < s || minLon > e || maxLon < w) continue
    out.push(it)
    if (out.length >= 2500) break
  }
  return out.map((it, i) => (
    <Polyline key={`wr-${i}-${it.bbox[0]}`} positions={it.latlngs}
      pathOptions={{ color: '#8290a4', weight: 0.8, opacity: 0.5, dashArray: '4 4', interactive: false }} />
  ))
}

// AirwayNetwork — draws the airway web (SkyVector World Lo/Hi style) from our
// own navdata. This is what puts route lines on the map where no raster chart
// exists (Central America); over the US it overlays the FAA chart at wide
// zooms where the raster doesn't render.
function AirwayNetwork({ cls }) {
  const [geo, setGeo] = useState(null)
  useEffect(() => {
    let cancelled = false
    getAirwayGeometry().then(g => { if (!cancelled) setGeo(g) })
    return () => { cancelled = true }
  }, [])
  if (!geo) return null
  return (<>
    {geo.lines.filter(l => l.cls === cls).map((l, i) => (
      <Polyline key={`${l.id}-${i}`} positions={l.latlngs}
        pathOptions={{ color: '#2a5ea8', weight: 1.1, opacity: 0.45, interactive: false }} />
    ))}
    <NavSymbols geo={geo} cls={cls} />
  </>)
}

// Chart symbology over the airway web — what pilots expect from an enroute
// chart: ▲ triangles with names for fixes, the VOR symbol with name/frequency
// box, and the airway designator in a navy box at each segment's midpoint.
// Rendered only at readable zooms and only inside the current viewport so the
// DOM stays small.
function NavSymbols({ geo, cls }) {
  const map = useMap()
  const [, setTick] = useState(0)
  useMapEvents({ moveend: () => setTick(t => t + 1), zoomend: () => setTick(t => t + 1) })

  const z = map.getZoom()
  if (z < 7) return null
  const b = map.getBounds().pad(0.1)

  const pts = geo.points.filter(p => p[cls] && b.contains([p.lat, p.lon])).slice(0, 160)

  // Airway ID label at the midpoint of each in-view line
  const labels = []
  if (z >= 7) {
    for (const l of geo.lines) {
      if (l.cls !== cls) continue
      const mid = l.latlngs[Math.floor(l.latlngs.length / 2)]
      if (b.contains(mid)) labels.push({ id: l.id, pos: mid })
      if (labels.length >= 60) break
    }
  }

  // Per-segment mag track° + distance NM, rotated along the leg — the chart's
  // "099 / 23" annotations. Only at closer zooms, capped for performance.
  // Staged density: distance only when zoomed out, course added closer in,
  // MEA only when you're actually reading a segment. Everything at once over
  // a hub like Guatemala City is unreadable.
  const showTrk = z >= 9
  const showMea = z >= 10
  const minLegNm = z >= 10 ? 2 : z >= 9 ? 8 : 20
  const segs = []
  const segSeen = new Set()
  const placed = []           // screen points, to keep labels apart
  if (z >= 8) {
    outer: for (const l of geo.lines) {
      if (l.cls !== cls) continue
      for (let i = 0; i < l.latlngs.length - 1; i++) {
        const a = l.latlngs[i], c = l.latlngs[i + 1]
        // Label the middle of the leg's VISIBLE portion: zoomed in, a long
        // leg's true midpoint is often off-screen and the label would vanish
        // exactly when the pilot is reading that segment.
        const inView = []
        for (let s = 0; s <= 20; s++) {
          const t = s / 20
          const p = [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t]
          if (b.contains(p)) inView.push(p)
        }
        if (!inView.length) continue
        const mid = inView[Math.floor(inView.length / 2)]
        const distNm = Math.round(haversineNm(a[0], a[1], c[0], c[1]))
        if (distNm < minLegNm) continue
        const trk = l.trk?.[i]
        const mea = l.mea?.[i]
        // rotate along the leg's screen bearing, kept upright
        let ang = (Math.atan2((c[1] - a[1]) * Math.cos(mid[0] * Math.PI / 180), c[0] - a[0]) * 180 / Math.PI)
        ang = 90 - ang
        if (ang > 90) ang -= 180
        if (ang < -90) ang += 180
        // Airways overlap (a leg can belong to several routes) — one label
        // per physical segment, or they stack into an unreadable pile.
        const key = `${a[0].toFixed(2)},${a[1].toFixed(2)}-${c[0].toFixed(2)},${c[1].toFixed(2)}`
        if (segSeen.has(key)) continue
        segSeen.add(key)
        // Keep labels physically apart on screen — near a hub, many distinct
        // legs converge and their labels would still collide.
        const pt = map.latLngToLayerPoint(mid)
        if (placed.some(p => Math.abs(p.x - pt.x) < 44 && Math.abs(p.y - pt.y) < 26)) continue
        placed.push(pt)
        segs.push({ pos: mid, trk: showTrk ? trk : null, distNm, mea: showMea ? mea : null, ang })
        if (segs.length >= 80) break outer
      }
    }
  }

  return (<>
    {pts.map(p => (
      <Marker key={`${p.name}${p.lat}`} position={[p.lat, p.lon]} interactive={false}
        icon={L.divIcon({
          className: '', iconSize: [0, 0],
          html: p.vor
            ? `<div style="transform:translate(-50%,-50%);text-align:center;pointer-events:none;">
                 <div style="font-size:13px;line-height:1;color:#1c3f7a;">⬡</div>
                 <div style="font:700 9px ui-monospace,monospace;color:#1c3f7a;background:rgba(255,255,255,0.75);border:0.5px solid #1c3f7a;border-radius:2px;padding:0 3px;white-space:nowrap;margin-top:1px;">${p.name}${p.freq ? ' ' + p.freq : ''}</div>
               </div>`
            : `<div style="transform:translate(-50%,-50%);text-align:center;pointer-events:none;">
                 <div style="font-size:8px;line-height:1;color:#233042;">▲</div>
                 ${z >= 8 ? `<div style="font:600 8.5px ui-monospace,monospace;color:#233042;text-shadow:0 0 3px #fff,0 0 3px #fff;white-space:nowrap;">${p.name}</div>` : ''}
               </div>`,
        })} />
    ))}
    {labels.map((l, i) => (
      <Marker key={`awy-${l.id}-${i}`} position={l.pos} interactive={false}
        icon={L.divIcon({
          className: '', iconSize: [0, 0],
          html: `<div style="transform:translate(-50%,-50%);pointer-events:none;font:700 8.5px ui-monospace,monospace;color:#fff;background:#1c3f7a;border-radius:2px;padding:0.5px 4px;white-space:nowrap;">${l.id}</div>`,
        })} />
    ))}
    {segs.map((s, i) => (
      <Marker key={`seg-${i}-${s.pos[0]}`} position={s.pos} interactive={false}
        icon={L.divIcon({
          className: '', iconSize: [0, 0],
          // track° over distance, with the MEA below in bold — the MEA is the
          // safety-critical number, so it reads first at a glance
          html: `<div style="transform:translate(-50%,-130%) rotate(${s.ang.toFixed(0)}deg);pointer-events:none;text-align:center;font:600 8px ui-monospace,monospace;color:#1c3f7a;text-shadow:0 0 3px #fff,0 0 3px #fff;white-space:nowrap;line-height:1.15;">
            ${s.trk != null ? String(s.trk).padStart(3, '0') + '°<br>' : ''}${s.distNm}
            ${s.mea != null ? `<br><span style="font-weight:800;font-size:8.5px;color:#0f2d5c;">${s.mea >= 18000 ? 'FL' + Math.round(s.mea / 100) : s.mea.toLocaleString()}</span>` : ''}
          </div>`,
        })} />
    ))}
  </>)
}

// LongPressAdd — ForeFlight-style: press-and-hold (or right-click) anywhere on
// the map to drop a point showing its aviation coordinates, with a button to
// insert it into the route at the nearest leg.
function LongPressAdd({ waypoints, onDrop, tapToAdd = false }) {
  const [pt, setPt] = useState(null)
  const ignoreNextClick = useRef(false)
  useMapEvents({
    // Leaflet fires `contextmenu` for long-press on touch and right-click on
    // desktop — exactly the ForeFlight hold gesture.
    contextmenu(e) {
      // Lifting the finger that performed the long-press fires ONE click —
      // however long the user keeps holding. A time window can't cover that
      // (hold 3s → release-click arrives after any window), so swallow
      // exactly the first click following a long-press instead.
      ignoreNextClick.current = true
      setPt({ lat: e.latlng.lat, lon: e.latlng.lng })
    },
    click(e) {
      if (ignoreNextClick.current) { ignoreNextClick.current = false; return }
      // The map was opened by "Add waypoint" and is waiting to be told where.
      // Holding is the gesture for an unprompted add; here the pilot has
      // already said what they want, so a plain tap places the point.
      //
      // Guarded because everything downstream — the marker, the popup, the
      // waypoint — goes straight into L.latLng, which throws on a NaN and
      // takes the card down with it.
      if (tapToAdd) {
        if (Number.isFinite(e.latlng?.lat) && Number.isFinite(e.latlng?.lng)) {
          setPt({ lat: e.latlng.lat, lon: e.latlng.lng })
        }
        return
      }
      setPt(null)
    },
    // No dismissal on drag: the tiniest finger movement while still holding
    // (or right after) registers as a map drag and was closing the popup.
    // It's anchored to the pressed point, so it simply pans with the map;
    // only a deliberate tap elsewhere dismisses it.
  })
  if (!pt) return null

  function addHere() {
    let bestSeg = 1, bestDist = Infinity
    for (let i = 0; i < waypoints.length - 1; i++) {
      const d = crossTrackNM(pt.lat, pt.lon, [waypoints[i].lat, waypoints[i].lon], [waypoints[i + 1].lat, waypoints[i + 1].lon])
      if (d < bestDist) { bestDist = d; bestSeg = i + 1 }
    }
    onDrop({ lat: pt.lat, lon: pt.lon, seg: bestSeg })
    setPt(null)
  }

  return (<>
    <CircleMarker center={[pt.lat, pt.lon]} radius={7}
      pathOptions={{ color: '#fff', weight: 2.5, fillColor: '#0a84ff', fillOpacity: 1 }} />
    <Popup position={[pt.lat, pt.lon]} offset={[0, -6]} closeButton={false} autoPan={false}>
      <div style={{
        textAlign: 'center', minWidth: 168,
        // Inline (beats every stylesheet): the popup opens under the user's
        // still-held finger, and without these iOS turns that ongoing press
        // into text selection of the coordinates — handles, loupe, Copy bar.
        userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none',
      }}>
        <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 13, letterSpacing: '0.3px' }}>
          {fmtAvCoord(pt.lat, pt.lon)}
        </div>
        <button
          onClick={addHere}
          style={{
            marginTop: 8, width: '100%', padding: '8px 12px', borderRadius: 8, border: 'none',
            background: '#0a84ff', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer',
          }}>
          + Add to route
        </button>
      </div>
    </Popup>
  </>)
}

// Close and zoom as one control group.
//
// These were two separate things that happened to sit near each other: a dark
// blurred CLOSE pill in the app's own idiom, and Leaflet's default white zoom
// box underneath it. Two visual languages, ten pixels apart, both doing the
// same job of "controls floating over the chart".
//
// Leaflet's control is dropped rather than restyled. Overriding
// .leaflet-control-zoom means fighting a stylesheet that also owns the
// disabled state, the seam between the buttons and the corner radii — and the
// result still would not match, because Leaflet's control cannot hold a third
// button that isn't a zoom.
//
// Disabled states are kept: at max or min zoom the button dims and stops
// responding, exactly as Leaflet's does, because a control that looks live and
// does nothing reads as a broken app.
function MapControlStack({ onClose }) {
  const map = useMap()
  const [zoom, setZoom] = useState(() => map.getZoom())
  const ref = useRef(null)

  // zoomend alone is not enough. Switching chart layers changes the map's
  // limits without changing the zoom — the sectional does not exist below
  // zoom 8 — so the buttons have to re-evaluate on zoomlevelschange too, or
  // "−" stays live at a floor it can no longer go below.
  const sync = () => setZoom(map.getZoom())
  useMapEvents({ zoomend: sync, zoomlevelschange: sync })

  // Without this, a drag started on the buttons pans the map underneath and a
  // double-click to zoom in twice zooms the map instead.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    L.DomEvent.disableClickPropagation(el)
    L.DomEvent.disableScrollPropagation(el)
  }, [])

  const atMax = zoom >= map.getMaxZoom()
  const atMin = zoom <= map.getMinZoom()

  const btn = (label, onClick, { disabled = false, first = false, last = false, size = 17 } = {}) => (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      aria-label={label === '✕' ? 'Close map' : label === '+' ? 'Zoom in' : 'Zoom out'}
      style={{
        width: 38, height: 38, padding: 0, margin: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'transparent', border: 'none',
        // Hairlines between the buttons, not around them — the group carries
        // its own outer border, so an edge here would double up.
        borderBottom: last ? 'none' : '0.5px solid rgba(255,255,255,0.14)',
        color: disabled ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.9)',
        fontSize: size, fontWeight: 500, lineHeight: 1,
        cursor: disabled ? 'default' : 'pointer',
        borderTopLeftRadius: first ? 9 : 0, borderTopRightRadius: first ? 9 : 0,
        borderBottomLeftRadius: last ? 9 : 0, borderBottomRightRadius: last ? 9 : 0,
        WebkitTapHighlightColor: 'transparent',
      }}
    >{label}</button>
  )

  return (
    <div
      ref={ref}
      style={{
        position: 'absolute', zIndex: 10005,
        top: 'calc(env(safe-area-inset-top, 0px) + 14px)', right: 12,
        display: 'flex', flexDirection: 'column',
        background: 'rgba(10,10,10,0.75)',
        backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
        border: '0.5px solid rgba(255,255,255,0.18)',
        borderRadius: 9, overflow: 'hidden',
        boxShadow: '0 2px 12px rgba(0,0,0,0.28)',
      }}
    >
      {btn('✕', onClose, { first: true, size: 15 })}
      {btn('+', () => map.zoomIn(), { disabled: atMax })}
      {btn('−', () => map.zoomOut(), { disabled: atMin, last: true })}
    </div>
  )
}

// Choosing where you are flying to, on the map.
//
// The route map only exists once a route does, and a route needs two ends —
// which is exactly the assumption this breaks. Plenty of flying is to places
// that have no ICAO code to type into the TO field: a ranch strip, a lake, a
// section corner, a friend's grass runway. Those pilots need to point at it.
//
// Deliberately spare: a basemap, the departure, and whatever the pilot taps.
// No charts, no airspace, no terrain — this map answers one question, and the
// full map with all its layers is one Calculate away.
function PickDestinationMap({ depPos, depIdent, onClose, onPick }) {
  const [pt, setPt] = useState(null)

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: '#e8e0d8' }}>
      <div style={{ position: 'absolute', inset: 0 }}>
        <MapContainer center={depPos} zoom={8}
          style={{ height: '100%', width: '100%' }}
          zoomAnimationThreshold={10}
          zoomControl={false} attributionControl={false}>
          <TileLayer url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>' />
          <MapInvalidator />
          <TapToPlace onPlace={setPt} />
          <CircleMarker center={depPos} radius={7}
            pathOptions={{ color: '#fff', weight: 2.5, fillColor: '#111', fillOpacity: 1 }} />
          {pt && (
            <CircleMarker center={[pt.lat, pt.lon]} radius={7}
              pathOptions={{ color: '#fff', weight: 2.5, fillColor: '#0a84ff', fillOpacity: 1 }} />
          )}
        </MapContainer>
      </div>

      {/* Departure label, so the one fixed point on this map is named */}
      <div style={{
        position: 'absolute', top: 'calc(env(safe-area-inset-top, 0px) + 14px)', left: 12,
        zIndex: 10002, pointerEvents: 'none',
        background: 'rgba(10,10,10,0.75)', backdropFilter: 'blur(12px)',
        border: '0.5px solid rgba(255,255,255,0.18)', borderRadius: 9,
        padding: '7px 10px', color: '#fff', fontSize: 11, fontWeight: 700, letterSpacing: '0.4px',
      }}>
        FROM {depIdent}
      </div>

      <button onClick={onClose} style={{
        position: 'absolute', top: 'calc(env(safe-area-inset-top, 0px) + 14px)', right: 12,
        zIndex: 10005, width: 38, height: 38, padding: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(10,10,10,0.75)', backdropFilter: 'blur(12px)',
        border: '0.5px solid rgba(255,255,255,0.18)', borderRadius: 9,
        color: 'rgba(255,255,255,0.9)', fontSize: 15, cursor: 'pointer',
      }}>✕</button>

      {!pt && (
        <div style={{
          position: 'absolute', bottom: 'calc(env(safe-area-inset-bottom, 0px) + 26px)',
          left: '50%', transform: 'translateX(-50%)', zIndex: 10002, pointerEvents: 'none',
          background: 'rgba(10,132,255,0.92)', backdropFilter: 'blur(10px)',
          borderRadius: 20, padding: '9px 16px', maxWidth: '86%',
          fontSize: 12, fontWeight: 600, color: '#fff', textAlign: 'center',
        }}>
          Tap where you are flying to
        </div>
      )}

      <DropPicker
        key={pt ? `${pt.lat.toFixed(4)},${pt.lon.toFixed(4)}` : 'none'}
        point={pt}
        mode="destination"
        canAppend={false}
        onChoose={choice => onPick(choice)}
        onCancel={() => setPt(null)} />
    </div>
  )
}

// A plain tap, guarded: everything downstream feeds L.latLng, which throws on
// a NaN and would take the card with it.
function TapToPlace({ onPlace }) {
  useMapEvents({
    click(e) {
      if (Number.isFinite(e.latlng?.lat) && Number.isFinite(e.latlng?.lng)) {
        onPlace({ lat: e.latlng.lat, lon: e.latlng.lng })
      }
    },
  })
  return null
}

// How much of the card stays on screen once it is swiped away — enough to be
// an obvious grab bar and to be hit reliably with a thumb, not so much that it
// eats the chart it just got out of the way of.
const CARD_PEEK_PX = 26

// How close the map goes when a subject on it is tapped — a field, or the
// highest ground. One number for both: they are the same gesture and the same
// kind of answer to "where is it", and two zooms made the map feel like it had
// two minds about being tapped. 13 is airport scale, close enough to see the
// runway layout under the marker.
const SUBJECT_ZOOM = 13

// Vertical swipe on the fullscreen bottom card.
//
// The card is dense with buttons and carries a horizontally scrolling route
// strip, so the gesture has to be sure of itself before it acts:
//
//   * it must travel far enough to be a swipe rather than a wobble during a tap
//   * it must be more vertical than horizontal, or scrubbing the route strip
//     sideways would dismiss the card
//   * having fired, it suppresses the click that would otherwise land on
//     whatever button the finger happened to start on — a swipe that also
//     presses something is the one outcome nobody wants
//
// Only pointer events are bound. Both pointerdown and touchstart fire for one
// finger, and listening for both is exactly the bug that left ghost layers on
// the map after a drag.
function useCardSwipe({ onDown, onUp, thresholdPx = 44 }) {
  const st = useRef(null)

  const suppressNextClick = () => {
    const kill = e => { e.stopPropagation(); e.preventDefault() }
    window.addEventListener('click', kill, { capture: true, once: true })
    // If no click follows (the usual case on touch), drop the trap rather than
    // leaving it armed for an unrelated click later.
    setTimeout(() => window.removeEventListener('click', kill, { capture: true }), 400)
  }

  return {
    onPointerDown: e => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      st.current = { x: e.clientX, y: e.clientY, fired: false }
    },
    onPointerMove: e => {
      const s = st.current
      if (!s || s.fired) return
      const dy = e.clientY - s.y
      const dx = e.clientX - s.x
      if (Math.abs(dy) < thresholdPx) return
      if (Math.abs(dy) < Math.abs(dx) * 1.5) { st.current = null; return }
      s.fired = true
      suppressNextClick()
      if (dy > 0) onDown?.(); else onUp?.()
    },
    onPointerUp:     () => { st.current = null },
    onPointerCancel: () => { st.current = null },
  }
}

// Fade-out hint shown once when fullscreen opens
function RouteHint() {
  const [visible, setVisible] = useState(true)
  useEffect(() => { const t = setTimeout(() => setVisible(false), 3500); return () => clearTimeout(t) }, [])
  if (!visible) return null
  return (
    <div style={{
      position: 'absolute', bottom: 280, left: '50%', transform: 'translateX(-50%)',
      zIndex: 10002, pointerEvents: 'none',
      background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(10px)',
      borderRadius: 20, padding: '7px 14px',
      display: 'flex', alignItems: 'center', gap: 8,
      animation: 'fadeOut 0.6s ease 2.9s forwards',
    }}>
      <span style={{ fontSize: 16 }}>✦</span>
      <span style={{ fontSize: 12, color: '#fff', fontWeight: 500 }}>Pull the line to bend it · hold the map to add a point · drag a point to move it</span>
      <style>{`@keyframes fadeOut { to { opacity: 0 } }`}</style>
    </div>
  )
}

// Map tile/overlay stack — MUST be a stable, top-level component. Defining
// this inline inside AltitudeItem's render (as it was before) gives it a new
// function identity every render, so React treats it as a brand-new component
// type and tears down + remounts the entire Leaflet layer tree (base tiles,
// sectional/airspace overlays, TFR markers, waypoint markers) on every single
// re-render of AltitudeItem — which happens constantly (hovering a chip,
// toggling a layer, TFR data arriving). That's what read as "the map glitches
// constantly" and, on iOS, remounting mid-tap can also swallow the tap event
// on nearby chips/buttons.
function MapLayers({ fit, fitOnce = true, layers, openaipKey, tfrData, detectedSUAPolys, waypoints, aerodromes, onAerodrome, openFieldIdent, peak, onPeak, peakFocused, refitNonce, onDrop, onDragInsert, onWaypointDrop, moveWaypoint, removeWaypoint, pickMode = false }) {
  const routePositions = waypoints.map(w => [w.lat, w.lon])
  return (<>
    <TileLayer url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>' />
    {/* Sectional — the FAA's own VFR raster service, same publisher and tile
        org as the IFR layers below. It replaces vfrmap.com, whose terms allow
        their API but prohibit hotlinking tiles, which is what this was doing.
        Cached z8-12; below 8 the chart is unreadable anyway and the mosaic's
        ragged edges look broken, so the basemap shows and the chart appears as
        you zoom in — the ForeFlight behaviour.

        tileSize 128 + zoomOffset 1 is the fix for a soft-looking chart: the
        service only publishes 256 px tiles at 96 dpi, so on a phone at 3x
        every chart pixel was being stretched across three device pixels. This
        pulls the next zoom level down and draws it into half the space, so a
        tile's own pixels land closer to the screen's. Four times the tiles for
        the same area, which is why it is worth doing for the chart layers and
        not the basemap (that one already serves @2x tiles).

        maxNativeZoom is one lower than the service's real limit because the
        offset is added to it: at map zoom 11 this requests zoom 12, the
        deepest level the FAA caches. */}
    {layers.sectional && (
      <TileLayer url="https://tiles.arcgis.com/tiles/ssFJjBXIUyZDrSYZ/arcgis/rest/services/VFR_Sectional/MapServer/tile/{z}/{y}/{x}"
        tileSize={128} zoomOffset={1}
        opacity={1} minZoom={8} maxNativeZoom={11} maxZoom={13}
        className="sectional-layer"
        errorTileUrl="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
        attribution='&copy; FAA AIS' />
    )}
    {/* IFR enroute charts — FAA's official free tile services (Web Mercator,
        56-day cycle — the FAA's own enroute product).
        Low is readable z8–11, High z5–9; beyond native range Leaflet
        over-zooms the tiles, below minZoom the basemap shows. */}
    {layers.ifrlo && (
      <TileLayer url="https://tiles.arcgis.com/tiles/ssFJjBXIUyZDrSYZ/arcgis/rest/services/IFR_AreaLow/MapServer/tile/{z}/{y}/{x}"
        tileSize={128} zoomOffset={1}
        opacity={1} minZoom={8} maxNativeZoom={11} maxZoom={13}
        className="sectional-layer"
        errorTileUrl="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
        attribution='&copy; FAA AIS' />
    )}
    {layers.ifrhi && (
      <TileLayer url="https://tiles.arcgis.com/tiles/ssFJjBXIUyZDrSYZ/arcgis/rest/services/IFR_High/MapServer/tile/{z}/{y}/{x}"
        tileSize={128} zoomOffset={1}
        opacity={1} minZoom={5} maxNativeZoom={8} maxZoom={12}
        className="sectional-layer"
        errorTileUrl="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
        attribution='&copy; FAA AIS' />
    )}
    {/* Tier 2 first so the authoritative network draws on top of it */}
    {layers.ifrlo && <WorldRefLayer cls="lo" />}
    {layers.ifrhi && <WorldRefLayer cls="hi" />}
    {layers.ifrlo && <AirwayNetwork cls="lo" />}
    {layers.ifrhi && <AirwayNetwork cls="hi" />}
    {layers.airspace && openaipKey && (
      <TileLayer key={openaipKey}
        url={`https://api.tiles.openaip.net/api/data/openaip/{z}/{x}/{y}.png?apiKey=${openaipKey}`}
        opacity={0.9} minZoom={4} maxZoom={17}
        attribution='&copy; <a href="https://www.openaip.net">openAIP</a>' />
    )}
    {layers.tfr && tfrData?.filter(t => t.lat !== null).map((t, i) => {
      const tfrColor = (() => {
        const type = (t.type || '').toUpperCase()
        if (type.includes('VIP') || type.includes('SECURITY') || type.includes('MILITARY')) return '#FF3B30'
        if (type.includes('HAZARD') || type.includes('WILDFIRE') || type.includes('DISASTER')) return '#FF9500'
        if (type.includes('AIR SHOW') || type.includes('SPORT')) return '#5AC8FA'
        if (type.includes('SPACE')) return '#AF52DE'
        if (type.includes('UAS') || type.includes('DRONE') || type.includes('GATHERING')) return '#FFD60A'
        return '#FF3B30'
      })()
      return t.polygon?.length > 2 ? (
        <Polygon key={i} positions={t.polygon}
          pathOptions={{ color: tfrColor, fillColor: tfrColor, fillOpacity: 0.18, weight: 2, opacity: 0.9 }}>
          <Popup><div style={{ fontSize: 12, lineHeight: 1.5, maxWidth: 200 }}>
            <strong style={{ color: tfrColor }}>{t.type}</strong> · {t.id}<br/>
            <span style={{ fontSize: 11 }}>{t.desc.slice(0, 120)}</span>
          </div></Popup>
        </Polygon>
      ) : (
        <CircleMarker key={i} center={[t.lat, t.lon]} radius={10}
          pathOptions={{ color: tfrColor, fillColor: tfrColor, fillOpacity: 0.25, weight: 2 }}>
          <Popup><div style={{ fontSize: 12, lineHeight: 1.5, maxWidth: 200 }}>
            <strong style={{ color: tfrColor }}>{t.type}</strong> · {t.id}<br/>
            <span style={{ fontSize: 11 }}>{t.desc.slice(0, 120)}</span>
          </div></Popup>
        </CircleMarker>
      )
    })}
    {/* SUA polygons — always shown when detected, no layer toggle needed */}
    {detectedSUAPolys.map((s, i) => {
      const tc = s.typeCode.toUpperCase()
      const suaColor = tc.startsWith('P') ? '#FF3B30'
        : tc.startsWith('R') ? '#FF9500'
        : tc.includes('MOA') ? '#FFD60A'
        : tc.startsWith('W') ? '#5AC8FA'
        : '#AF52DE' // Alert
      return (
        <Polygon key={`sua-${i}`} positions={s.poly}
          pathOptions={{ color: suaColor, fillColor: suaColor, fillOpacity: 0.15, weight: 1.5, opacity: 0.85, dashArray: '5 4' }}>
          <Popup><div style={{ fontSize: 12, lineHeight: 1.5, maxWidth: 200 }}>
            <strong style={{ color: suaColor }}>{s.name}</strong>
          </div></Popup>
        </Polygon>
      )
    })}
    {fit && <RouteFitter positions={routePositions} once={fitOnce} />}
    <RouteRefit nonce={refitNonce} positions={routePositions} />
    <AirspaceZoomer active={layers.airspace} />
    {/* Each min mirrors its TileLayer's own minZoom below — 8, 8, 5. */}
    <ChartZoomer active={layers.sectional} min={8} positions={routePositions} />
    <ChartZoomer active={layers.ifrlo} min={8} positions={routePositions} />
    <ChartZoomer active={layers.ifrhi} min={5} positions={routePositions} />
    {/* Dep/dest endpoints — draggable like any waypoint (fine-tune the start/
        end point around the airport), but never removable. Moving one well
        outside the airport area raises a warning upstream without blocking. */}
    {/* En-route fields, as small hollow markers distinct from the route's own
        points — the nearest handful only, because the corridor can hold 160
        of them and a route line under a field of dots is not a route line.
        The rest stay in the list, which is the same set seen another way. */}
    <AerodromeMarkers fields={aerodromes} layers={layers} onAerodrome={onAerodrome} highlightIdent={openFieldIdent} />
    <PeakMarker peak={peak} layers={layers} onOpen={onPeak} focused={peakFocused} />
    <RouteWaypoints waypoints={waypoints} onDrop={onDrop} onDragInsert={onDragInsert}
      onWaypointDrop={onWaypointDrop} moveWaypoint={moveWaypoint} removeWaypoint={removeWaypoint}
      pickMode={pickMode} />
  </>)
}

// The route's own markers, split out so the label-room calculation can use the
// map instance without every layer above re-running when the view changes.
function RouteWaypoints({ waypoints, onDrop, onDragInsert, onWaypointDrop, moveWaypoint, removeWaypoint, pickMode = false }) {
  const room = useLabelRoom(waypoints)
  return (<>
    {waypoints[0] && (
      <DraggableWaypoint key={waypoints[0].id} position={[waypoints[0].lat, waypoints[0].lon]}
        index={0} onMove={moveWaypoint} name={waypoints[0].name} removable={false} />
    )}
    {waypoints.length >= 2 && (
      <DraggableWaypoint key={waypoints[waypoints.length-1].id}
        position={[waypoints[waypoints.length-1].lat, waypoints[waypoints.length-1].lon]}
        index={waypoints.length-1} onMove={moveWaypoint}
        name={waypoints[waypoints.length-1].name} removable={false} />
    )}
    {waypoints.length >= 2 && <PolylineEditor waypoints={waypoints} onDragInsert={onDragInsert} />}
    {waypoints.length >= 2 && <LongPressAdd waypoints={waypoints} onDrop={onDrop} tapToAdd={pickMode} />}
    {waypoints.slice(1, -1).map((w, i) => (
      <DraggableWaypoint key={w.id} position={[w.lat, w.lon]} index={i + 1} onMove={onWaypointDrop} onRemove={removeWaypoint}
        // unnamed map-dropped points carry the same WPT n label as the card
        name={w.name || `WPT ${waypoints.slice(0, i + 1).filter(p => !p.name).length + 1}`} kind={w.kind}
        showLabel={room.has(i + 1)} />
    ))}
  </>)
}

// The altitude recommendation, and the reasons behind it.
//
// Every figure here is the engine's own — the score breakdown IS the reasons
// list, so nothing shown can drift from what was actually computed. What was
// unavailable or assumed is stated rather than quietly folded in.
function AltitudeAdvice({ advice, busy, selectedAlt, acPerf, onPick, brief, briefBusy, onBrief }) {
  if (busy && !advice) {
    return (
      <div style={{ borderRadius: 10, background: 'var(--bg-card-2)', padding: '11px 13px', marginBottom: 10 }}>
        <Bone w="60%" h={13} />
        <div style={{ height: 6 }} />
        <Bone w="85%" h={10} />
      </div>
    )
  }
  if (!advice) return null

  if (advice.status === 'no-legal-altitude') {
    return (
      <div style={{
        borderRadius: 10, background: 'var(--warn-light)', padding: '11px 13px', marginBottom: 10,
        border: '0.5px solid var(--warn)',
      }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--warn)' }}>
          No cruising altitude works for this route
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.5 }}>
          Every hemispheric altitude is ruled out — usually terrain below and the aircraft
          ceiling above. A routing that avoids the high ground, or a different aircraft,
          is the way through. Reasons are on each altitude below.
        </div>
      </div>
    )
  }
  if (advice.status !== 'ok' || !advice.recommended) return null

  const r = advice.recommended
  const differs = selectedAlt != null && selectedAlt !== r.altFt
  const wx = advice.atmosphere?.hourISO
    ? new Date(advice.atmosphere.hourISO).toUTCString().slice(5, 22) + 'Z'
    : null
  const modelled = advice.hazards?.coverage &&
    (advice.hazards.coverage.icing === 'modelled' || advice.hazards.coverage.turbulence === 'modelled')

  const DEGRADED = {
    'winds-aloft-unavailable': 'winds aloft unavailable — picked on terrain, airspace and rules alone',
    'no-aircraft-performance': 'no aircraft performance set — climb cost not considered',
    'assumed-climb-performance': `climb rate and ceiling assumed (${acPerf?.rocFpm} fpm, ${acPerf?.serviceCeilingFt?.toLocaleString()} ft) — set them on the Aircraft page`,
    'terrain-unavailable': 'terrain data unavailable — clearance not checked',
  }

  return (
    <div style={{
      borderRadius: 10, background: 'var(--bg-card-2)', padding: '11px 13px', marginBottom: 10,
      border: `0.5px solid ${differs ? 'var(--ok)' : 'var(--border)'}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
        <div>
          <div style={{ fontSize: 9.5, letterSpacing: '0.6px', color: 'var(--text-tertiary)' }}>RECOMMENDED</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)', fontFamily: 'monospace', lineHeight: 1.15 }}>
            {fmtAlt(r.altFt)}
          </div>
        </div>
        <div style={{ textAlign: 'right', fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          {r.econ && <div>{Math.round(r.econ.blockMin)} min · {r.econ.gallons.toFixed(1)} gal · GS {Math.round(r.econ.gsKt)} kt</div>}
          {r.wind && (
            <div>
              {Math.abs(Math.round(r.wind.hwKt))} kt {r.wind.hwKt < 0 ? 'tailwind' : 'headwind'}
              {r.oatC != null && ` · ${Math.round(r.oatC)} °C`}
            </div>
          )}
        </div>
      </div>

      {differs && (
        <button onClick={() => onPick(r.altFt)} style={{
          marginTop: 8, width: '100%', background: 'var(--ok)', border: 'none', borderRadius: 8,
          padding: '7px 0', fontSize: 12, fontWeight: 700, color: '#000', cursor: 'pointer',
        }}>
          Use {fmtAlt(r.altFt)}
        </button>
      )}

      {r.reasons.length > 0 && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {r.reasons.map((x, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 7, fontSize: 11 }}>
              <span style={{
                fontFamily: 'monospace', fontSize: 10, minWidth: 26, textAlign: 'right',
                color: x.points < 0 ? 'var(--warn)' : 'var(--ok)',
              }}>{x.points < 0 ? x.points : '+0'}</span>
              <span style={{ color: 'var(--text)' }}>{x.label}</span>
              {x.detail && <span style={{ color: 'var(--text-tertiary)', fontSize: 10 }}>{x.detail}</span>}
              {x.official === false && (
                <span style={{ fontSize: 9, color: 'var(--text-tertiary)', border: '0.5px dashed var(--border-strong)', borderRadius: 3, padding: '0 3px' }}>
                  modelled
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {advice.hazards?.convective && (
        <div style={{ marginTop: 7, fontSize: 10.5, color: 'var(--warn)', lineHeight: 1.45 }}>
          Convection likely along the route (CAPE {advice.hazards.convective.capeJkg} J/kg) — no
          cruising altitude is smooth through a build-up; plan to go around.
        </div>
      )}

      <div style={{ marginTop: 7, fontSize: 9.5, color: 'var(--text-tertiary)', lineHeight: 1.45 }}>
        {wx && `${advice.atmosphere.model}, ${wx}. `}
        {advice.atmosphere?.stale && `Winds are the last set that reached us, ${advice.atmosphere.ageMin} min old — the forecast service did not answer. `}
        {modelled && 'Icing and turbulence outside US coverage are modelled from the forecast profile, not an official product. '}
        VFR cloud clearance is checked vertically only. Pilot retains final authority.
      </div>

      {advice.degraded?.length > 0 && (
        <div style={{ marginTop: 6, fontSize: 10, color: 'var(--warn)', lineHeight: 1.45 }}>
          {advice.degraded.map(d => DEGRADED[d]).filter(Boolean).join(' · ')}
        </div>
      )}

      {/* The written briefing. The analysis above stands on its own — this
          reads it back as advice, and can only choose from the same legal
          altitudes and quote the same figures. */}
      <div style={{ marginTop: 9, borderTop: '0.5px solid var(--border)', paddingTop: 8 }}>
        {!brief && (
          <button onClick={onBrief} disabled={briefBusy} style={{
            width: '100%', background: 'var(--bg-card)', border: '0.5px solid var(--border)',
            borderRadius: 8, padding: '8px 0', fontSize: 12, fontWeight: 600,
            color: briefBusy ? 'var(--text-tertiary)' : 'var(--text)',
            cursor: briefBusy ? 'default' : 'pointer',
          }}>
            {briefBusy ? 'Writing the briefing…' : 'Brief me on this'}
          </button>
        )}

        {brief?.status === 'ok' && (
          <div>
            {!brief.agrees && (
              <div style={{
                fontSize: 11, color: 'var(--warn)', marginBottom: 6, lineHeight: 1.45,
                background: 'var(--warn-light)', borderRadius: 7, padding: '6px 8px',
              }}>
                The briefing prefers {fmtAlt(brief.altFt)}; the analysis scored {fmtAlt(brief.enginePick)} highest.
                Both are legal here — the figures above are the measured ones.
              </div>
            )}
            <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
              {brief.briefing}
            </div>
            {brief.watchFor && (
              <div style={{ fontSize: 11.5, color: 'var(--warn)', marginTop: 6, lineHeight: 1.5 }}>
                Watch for: {brief.watchFor}
              </div>
            )}
            {!brief.agrees && (
              <button onClick={() => onPick(brief.altFt)} style={{
                marginTop: 8, width: '100%', background: 'var(--bg-card)',
                border: '0.5px solid var(--border)', borderRadius: 8, padding: '7px 0',
                fontSize: 12, fontWeight: 600, color: 'var(--text)', cursor: 'pointer',
              }}>
                Use {fmtAlt(brief.altFt)} instead
              </button>
            )}
          </div>
        )}

        {brief && brief.status !== 'ok' && (
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
            {brief.status === 'not-configured'
              ? 'Briefing is not set up on this deployment — the analysis above is unaffected.'
              : brief.status === 'rejected'
              ? `Briefing discarded: ${brief.reason}. The analysis above stands.`
              : 'Briefing unavailable — the analysis above stands.'}
          </div>
        )}
      </div>
    </div>
  )
}

// Departure/destination ICAO chips overlaid on the inline map corners.
function AirportLabels({ dep, dest, depPos, destPos, onFlyTo }) {
  return (
    <div style={{
      position: 'absolute', bottom: 8, left: 8, right: 8, zIndex: 999,
      display: 'flex', justifyContent: 'space-between', pointerEvents: 'none',
    }}>
      {[
        { icao: dep,  pos: depPos },
        { icao: dest, pos: destPos },
      ].map(({ icao, pos }, i) => (
        <div key={i}
          onClick={e => { e.stopPropagation(); onFlyTo(pos) }}
          style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)', borderRadius: 6, padding: '3px 8px', pointerEvents: 'auto', cursor: 'pointer' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', fontFamily: 'monospace' }}>{icao}</span>
        </div>
      ))}
    </div>
  )
}

/* ── Altitude + Route calculator ─────────────────────────────── */
export function AltitudeItem({ item, isChecked, onToggle }) {
  const [open, setOpen]           = useState(false)
  const [course, setCourse]       = useState('')
  const [selectedAlt, setSelectedAlt] = useState(null)
  const [isHelicopter, setIsHelicopter] = useState(false)
  // The aircraft decides how high is worth climbing and how high is possible,
  // so the profile is held here rather than re-read per calculation.
  const [aircraft, setAircraft] = useState(null)
  const acPerf = useMemo(() => parseAircraftPerf(aircraft), [aircraft])
  // Planned departure. Starts at the phone's clock and keeps up with it, so a
  // pilot planning to leave shortly never has to set anything; the moment they
  // pick a time it stops following and stays where they put it.
  const [etd, setEtd] = useState(nowLocalISO)
  const [etdPinned, setEtdPinned] = useState(false)
  const [advice, setAdvice] = useState(null)
  const [adviceBusy, setAdviceBusy] = useState(false)
  // Follow the clock to the minute while the field is untouched. The analysis
  // keys on the hour, so this costs a re-render, not a forecast fetch.
  useEffect(() => {
    if (etdPinned) return
    const id = setInterval(() => setEtd(nowLocalISO()), 15000)
    return () => clearInterval(id)
  }, [etdPinned])

  const [brief, setBrief] = useState(null)
  const [briefBusy, setBriefBusy] = useState(false)

  useEffect(() => {
    get('aircraft', 'profile').then(profile => {
      setIsHelicopter(profile?.category === 'helicopter')
      setAircraft(profile || null)
    })
  }, [])

  // Route inputs
  const [dep, setDep]              = useState('')
  const [depValidated, setDepVal]  = useState(false)
  const [depChecking, setDepChk]   = useState(false)
  const [depError, setDepErr]      = useState(null)
  const [dest, setDest]            = useState('')
  const [destValidated, setDestVal] = useState(false)
  const [destChecking, setDestChk]  = useState(false)
  const [destError, setDestErr]     = useState(null)
  const [routeLoading, setRL]     = useState(false)
  const [route, setRoute]         = useState(null)
  const [routeError, setRE]       = useState(null)

  // Map layers
  const [layers, setLayers]         = useState({ sectional: false, ifrlo: false, ifrhi: false, airspace: false, tfr: false })

  // IFR flights get the FAA enroute Low/High chart chips; VFR/Local get the
  // sectional. Read from the picked flight-plan type (settings) on mount.
  const [flightRules, setFlightRules] = useState('VFR')
  useEffect(() => {
    get('settings', 'flightPlanType').then(s => {
      if (s?.value?.flightRules) setFlightRules(s.value.flightRules)
    })
  }, [])
  const [mapFullscreen, setMapFS]   = useState(false)
  const [showRefs, setShowRefs]     = useState(false)
  // Cleared view: the pilot swipes the bottom card down and everything but the
  // close button and the zoom control gets out of the way, so the chart can be
  // read the way a paper chart is read. Cleared on every entry to fullscreen
  // rather than in an effect, so reopening the map never starts in a state the
  // pilot has to undo and no render cascades to do it.
  const [mapClear, setMapClear]     = useState(false)
  const cardSwipe = useCardSwipe({
    onDown: () => setMapClear(true),
    onUp:   () => setMapClear(false),
  })
  const [activeChip, setActiveChip] = useState(null) // id of chip whose popup is open
  // Which chip was opened by a deliberate tap, as opposed to a pointer
  // passing over it. A pinned panel survives the cursor leaving. State rather
  // than a ref: it is read inside the map's render-time block, where a ref
  // read cannot be proven safe.
  const [chipPinned, setChipPinned] = useState(null)

  // ── Named intermediate waypoints (Garmin/ForeFlight style) ──
  // Each row: { id, text, resolved: {kind,name,lat,lon,...}|null, error,
  //             creating: {lat,lon}|null } — `creating` holds the inline
  //             lat/lon form for defining a new USER waypoint.
  const [wptRows, setWptRows] = useState([])

  // Coordinate hint for disambiguating duplicate idents — nearest wins.
  const depPosHint = useRef(null)

  // Changing an endpoint throws away the routing between the old pair.
  //
  // Waypoints only mean anything between the two airports they were entered
  // for. This used to leave them behind: file KMIA-KJFK, switch to KSFO-KSEA,
  // and the card still listed ALTNN2, DUCEN, JFK and ROBUC3 — a Miami
  // departure and a New York arrival on a San Francisco flight, all of which
  // would have gone straight into the calculated route.
  //
  // Done in the setters rather than in an effect on [dep, dest], because the
  // restored route arrives by setting exactly those values and an effect
  // cannot tell that apart from the pilot retyping the field. Here, restore
  // simply does not go through these.
  function endpointChanging(next, current) {
    if (next === current) return
    setWptRows(prev => (prev.length ? [] : prev))
    // The published routing and the calculated result describe the pair that
    // just went away.
    setPubApplied(null)
    setRoute(null)
    setRE(null)
  }
  const changeDep = v => { endpointChanging(v, dep); setDep(v) }
  const changeDest = v => { endpointChanging(v, dest); setDest(v) }

  // Restore saved route on mount; fall back to homeAirport for the FROM field
  useEffect(() => {
    get('settings', 'route').then(r => {
      if (r?.depPos && r?.destPos) {
        if (r.dep) { setDep(r.dep); setDepVal(true) }
        if (r.dest) { setDest(r.dest); setDestVal(true) }
        setRoute(r)
        if (r.atsTokens?.length > 2) {
          // Restore the rows AS TYPED (airway tokens intact, not their
          // expansion) — any token without a matching expanded waypoint is
          // an airway.
          const mid = r.atsTokens.slice(1, -1)
          setWptRows(mid.map((name, i) => {
            const w = (r.wpts ?? []).find(x => x.name === name && !x.via)
            return {
              id: `wr-restored-${i}`, text: name,
              resolved: w ?? { kind: 'AWY', name }, error: null, creating: null,
            }
          }))
        } else if (r.wpts?.length) {
          setWptRows(r.wpts.map((w, i) => ({
            id: `wr-restored-${i}`, text: w.name, resolved: w, error: null, creating: null,
          })))
        }
        if (r.mc != null) setCourse(String(r.mc))
        if (r.cruiseAlt != null) setSelectedAlt(r.cruiseAlt)
        if (r.etd) { setEtd(r.etd); setEtdPinned(true) }
        if (!r.dep) get('settings', 'homeAirport').then(h => { if (h?.value) { setDep(h.value); setDepVal(true) } })
      } else {
        get('settings', 'homeAirport').then(h => { if (h?.value) { setDep(h.value); setDepVal(true) } })
      }
    })
  }, [])

  async function validateDep() {
    const id = dep.trim().toUpperCase()
    if (id.length < 3) return
    setDepChk(true); setDepErr(null)
    const result = await fetchAWC(id)
    setDepChk(false)
    if (result) {
      setDep(id); setDepVal(true)
      if (result.lat != null) depPosHint.current = [parseFloat(result.lat), parseFloat(result.lon)]
    }
    else setDepErr('Airport not found')
  }

  async function validateDest() {
    const id = dest.trim().toUpperCase()
    if (id.length < 3) return
    setDestChk(true); setDestErr(null)
    const result = await fetchAWC(id)
    setDestChk(false)
    if (result) { setDest(id); setDestVal(true) }
    else setDestErr('Airport not found')
  }

  // ICAO codes are always exactly 4 characters (maxLength on both inputs) —
  // once a field reaches that length, validate immediately so the field
  // flips to the "found" pill without waiting for Enter/blur.
  useEffect(() => {
    if (dep.trim().length === 4 && !depValidated && !depChecking) validateDep()
  }, [dep])

  useEffect(() => {
    if (dest.trim().length === 4 && !destValidated && !destChecking) validateDest()
  }, [dest])

  // ── Published routes (FAA preferred / TEC) ──
  // What ATC actually issues between this pair, offered as soon as both ends
  // are known. Empty for most pairs — the FAA publishes routings for about
  // 7,700 of them — and the button simply doesn't appear then.
  const [pubRoutes, setPubRoutes] = useState({ exact: [], reverse: [], nearby: [] })
  const pubCount = pubRoutes.exact.length + pubRoutes.reverse.length + pubRoutes.nearby.length
  const [pubOpen, setPubOpen]     = useState(false)
  const [pubBusy, setPubBusy]     = useState(null)
  const [pubApplied, setPubApplied] = useState(null)

  useEffect(() => {
    let cancelled = false
    const ready = depValidated && destValidated
    // Resolved asynchronously either way — an unvalidated pair settles to an
    // empty list rather than being cleared synchronously, which would cascade
    // a render on every keystroke in the ICAO fields.
    const empty = { exact: [], reverse: [], nearby: [] }
    ;(ready ? lookupRoutes(dep, dest) : Promise.resolve(empty))
      .then(r => { if (!cancelled) { setPubRoutes(r); if (!ready) { setPubOpen(false); setPubApplied(null) } } })
      .catch(() => { if (!cancelled) setPubRoutes(empty) })
    return () => { cancelled = true }
  }, [dep, dest, depValidated, destValidated])

  // Fill the waypoint rows from a published string. Every kind of token keeps
  // the name it is filed under and expands underneath: airways into their fix
  // chains, SIDs and STARs into theirs, plain fixes resolved outright. A
  // procedure name that is not published at this airport stays as text — the
  // route string can reference one we have no record of, and inventing a path
  // for it would be worse than showing the name.
  async function applyPublished(r) {
    setPubBusy(r.d)
    let tokens = await classifyRoute(r.r, depPosHint.current, { dep, dest })
    // A route published for the opposite direction is read back to front: its
    // string runs from the field you are flying to. The airway tokens stay
    // where they are — an airway expands the same either way, it is the fixes
    // either side of it that swap.
    if (r.basis === 'reverse') tokens = [...tokens].reverse()
    const rows = tokens
      .filter(t => t.kind !== 'PROC' || t.procedure)
      .map((t, i) => ({
        id: `wr-pfr-${i}`, text: t.text, error: null, creating: null,
        resolved: t.procedure
          ? { kind: 'PROC', name: t.text, role: t.procedure.t, fixCount: t.procedure.fixes.length }
          : t.resolved,
      }))
    setWptRows(rows)
    // Clear the chart overlays. A published routing is about the points it
    // goes through, and an enroute chart under it buries them in every other
    // airway and navaid in the region — the route stops being the thing you
    // can see. The plain basemap leaves the line and its own waypoints as the
    // only marked features; the chart chips are one tap away when wanted.
    setLayers({ sectional: false, ifrlo: false, ifrhi: false, airspace: false, tfr: false })
    setRE(null)
    setPubBusy(null); setPubOpen(false)
    setPubApplied({ designator: r.label, string: r.r, basis: r.basis, viaField: r.viaField,
                    from: r.from, to: r.to,
                    skipped: tokens.filter(t => t.kind === 'PROC' && !t.procedure).map(t => t.text) })
    // Draw it straight away rather than leaving the pilot to press Calculate:
    // picking a published route is the decision, and the map re-frames onto
    // the new routing as it appears.
    await calcRoute({ rows })
  }

  // ── Tapping a field along the route ──
  //
  // The list and the map are the same set of fields seen two ways, so both
  // The camera as it was before a subject was focused.
  //
  // Tapping a field or the peak zooms somewhere specific; closing that card
  // used to re-fit the whole route, which is not where the pilot was. If they
  // had zoomed into a valley to read the terrain, looked at one airport, and
  // closed it, the map threw the valley away. Saved once per excursion, so
  // peak then field then close still returns to the original view rather than
  // to the peak.
  // The Leaflet instance, handed over by MapContainer's ref. State rather
  // than a ref: a state setter as a ref callback is read-safe during render,
  // which a ref object passed through JSX is not.
  const [fsMap, setFsMap] = useState(null)
  const [savedView, setSavedView] = useState(null)

  const rememberView = () => {
    if (!fsMap || savedView) return
    try {
      const c = fsMap.getCenter()
      setSavedView({ lat: c.lat, lon: c.lng, zoom: fsMap.getZoom() })
    } catch { /* map not ready; the refit fallback still applies */ }
  }

  // Back to wherever the map was, exactly — same centre, same zoom, and no
  // offsetFrac, since nothing is being lifted clear of a sheet any more.
  // Closing the Mountains panel is the same gesture as closing an aerodrome
  // popup: the excursion is over, so the camera goes back where it was.
  const closeChipPanel = id => {
    setChipPinned(null)
    setActiveChip(null)
    if (id === 'mountains' && peakFocused) {
      setPeakFocused(false)
      setAwayFromRoute(false)
      restoreView()
    }
  }

  const restoreView = () => {
    if (!savedView) return false
    setMapFlyTarget({ lat: savedView.lat, lon: savedView.lon, zoom: savedView.zoom })
    setSavedView(null)
    return true
  }

  // entry points land here: fly the map onto the field, open its popup, and
  // remember that the view has left the route so it can be offered back.
  function openAerodrome(f) {
    setMapClear(false); setMapFS(true)
    setPeakFocused(false)
    setChipPinned(null)
    setActiveChip(null)                       // the chip panel would cover the field
    rememberView()
    // The offset lifts it into the band above the popup — the point of
    // tapping it is to look at it.
    setMapFlyTarget({ lat: f.lat, lon: f.lon, zoom: SUBJECT_ZOOM, offsetFrac: 0.26 })
    setOpenField(f)
    setAwayFromRoute(true)
  }

  // Tapping the height in the Mountains card puts the map on that ridge, in
  // the same band above the sheet the aerodrome popup uses — the number is
  // the answer to "how high", and this is the answer to "where".
  function focusPeak() {
    if (terrainInfo?.status !== 'ok' || terrainInfo.atLat == null) return
    setMapClear(false); setMapFS(true)
    rememberView()
    setMapFlyTarget({ lat: terrainInfo.atLat, lon: terrainInfo.atLon, zoom: SUBJECT_ZOOM, offsetFrac: 0.26 })
    setPeakFocused(true)
    setAwayFromRoute(true)
    setOpenField(null)
  }

  // Tapping the peak on the map is the same act as tapping the Mountains
  // chip, and it behaves like tapping a control tower: fly in, focus it, open
  // the card that explains it — and on closing, fly back out to exactly the
  // view that was there before. Same zoom as a tower, so the two subjects on
  // this map are approached identically.
  function openMountains() {
    setChipPinned('mountains')
    setActiveChip('mountains')
    focusPeak()
  }

  function backToRoute() {
    setOpenField(null)
    setPeakFocused(false)
    setAwayFromRoute(false)
    // Where the pilot was beats where the route is. Only when there is no
    // saved view — the subject was opened from the card, not from the map —
    // does this fall back to framing the route. RouteFitter fits once in
    // fullscreen, deliberately, so that needs asking for explicitly.
    if (restoreView()) return
    setMapFlyTarget(null)
    setRefitNonce(n => n + 1)
  }

  // Divert: the field becomes the destination, which is the same operation the
  // map's drop picker already offers for an airport.
  async function divertTo(f) {
    setOpenField(null)
    setAwayFromRoute(false)
    changeDest(f.ident); setDestVal(true)
    setMapFS(false)
    // rows: [] because changeDest has just emptied them and this call would
    // otherwise read the pre-clear closure and put them straight back.
    await calcRoute({ destId: f.ident, destPos: [f.lat, f.lon], rows: [] })
  }

  // Alternate: written into the landing-alternate list the Alternates section
  // already keeps, so the field arrives there filled in rather than needing
  // its ident typed again. The section stores takeoff and landing alternates
  // separately; a field found along the route is a landing alternate.
  //
  // The entry is built the same way that section builds its own — the full
  // airport record plus distance and bearing from the destination — so it
  // renders identically whichever way it got there.
  async function setAsAlternate(f) {
    const [saved, airport, rawMetar] = await Promise.all([
      get('settings', 'alternates'),
      lookupAirport(f.ident).catch(() => null),
      fetch(awcUrl('metar', { ids: f.ident, format: 'raw', hours: '3' }))
        .then(r => r.text()).catch(() => ''),
    ])
    if (!airport) { setOpenField(null); return }

    const ldAlts = saved?.ldAlts ?? []
    if (ldAlts.some(a => a.icaoId === f.ident)) { setOpenField(null); return }

    const raw = (rawMetar || '').trim()
    const ref = route?.destPos
    const entry = {
      ...airport,
      raw,
      wx: raw.length > 8 ? parseMetar(raw) : null,
      distNm: ref ? Math.round(haversineNm(ref[0], ref[1], f.lat, f.lon)) : null,
      bearing: ref ? Math.round(bearingDeg(ref[0], ref[1], f.lat, f.lon)) : null,
      refIcao: route?.dest ?? dest,
    }
    await put('settings', { key: 'alternates', toAlts: saved?.toAlts ?? [], ldAlts: [...ldAlts, entry] })
    setOpenField(null)
  }

  function addWptRow() {
    setWptRows(prev => [...prev, { id: `wr-${Date.now()}`, text: '', resolved: null, error: null, creating: null }])
  }

  // The first waypoint is asked for differently from the rest.
  //
  // An empty text field assumes the pilot already knows the name of the fix
  // they want, which is true for the second one — by then they are refining a
  // routing they can see. It is often not true for the first: what they have
  // is a place on the chart, a way around weather or terrain, not a
  // five-letter ident. So the first press opens the map and waits for a tap.
  //
  // Later presses go back to the text row: once there is a waypoint in the
  // list, adding another is usually typing one, and the map is still one long
  // press away.
  async function pickWaypointOnMap() {
    // No destination yet: the map is being asked where the flight is going,
    // not where it detours. That map is its own thing, because the route map
    // cannot exist until a route does.
    if (!dest.trim()) {
      // It has to open somewhere the pilot recognises, and the only anchor
      // available before a route is the departure — so resolve it first if
      // typing it never triggered a lookup.
      if (!depPosHint.current) await validateDep()
      if (!depPosHint.current) { setRE('Could not place that departure airport on the map'); return }
      setRE(null)
      setPickDest({ pos: depPosHint.current, ident: dep.trim().toUpperCase() })
      return
    }

    let r = route
    if (!r) {
      r = await calcRoute()
      if (!r) return                 // calcRoute has already shown why
    }
    setPickMode(true)
    setMapClear(false)
    setMapFS(true)
  }

  // A place chosen on the destination map. A typed name is saved first, so
  // the same spot can be found by name from any route field afterwards —
  // which is the whole point of naming it.
  async function commitDestination(choice) {
    const { lat, lon, name, saveAs } = choice
    let ident = name
    if (saveAs) {
      try {
        await saveUserWaypoint(saveAs, lat, lon)
        ident = saveAs
      } catch (e) {
        // Almost always "that name is already a real waypoint" — worth saying,
        // and the flight can still be planned to the coordinate.
        setRE(e.message)
        ident = null
      }
    }
    // Unnamed and uncharted: the coordinate is the identifier, which is what
    // it is on a ForeFlight route line too.
    const label = ident || fmtAvCoord(lat, lon)
    setPickDest(null)
    changeDest(label)
    setDestVal(true)
    setDestErr(null)
    await calcRoute({ dest: label, destPos: [lat, lon], rows: [] })
  }
  function patchWptRow(id, patch) {
    setWptRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r))
  }
  function removeWptRow(id) {
    setWptRows(prev => prev.filter(r => r.id !== id))
    setRoute(null); setRE(null)
  }

  async function resolveWptRow(id, text) {
    const ident = text.trim().toUpperCase()
    if (!ident) return
    // Airway ID (V25, J501, Q822…) — expanded into its fix chain at
    // Calculate time, between the fixes in the neighboring rows.
    if (looksLikeAirway(ident) && await lookupAirway(ident)) {
      patchWptRow(id, { text: ident, resolved: { kind: 'AWY', name: ident }, error: null, creating: null })
      setRoute(null); setRE(null)
      return
    }
    const nearPos = route ? [(route.depPos[0] + route.destPos[0]) / 2, (route.depPos[1] + route.destPos[1]) / 2]
      : depPosHint.current
    const hit = await resolveWaypoint(ident, nearPos)
    if (hit) {
      patchWptRow(id, { text: ident, resolved: hit, error: null, creating: null })
      setRoute(null); setRE(null)
    } else {
      patchWptRow(id, { text: ident, resolved: null, error: 'not-found', creating: null })
    }
  }

  async function createUserWpt(id, ident, latStr, lonStr) {
    const lat = parseFloat(latStr), lon = parseFloat(lonStr)
    if (isNaN(lat) || isNaN(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      patchWptRow(id, { error: 'bad-coords' })
      return
    }
    try {
      const wp = await saveUserWaypoint(ident, lat, lon)
      patchWptRow(id, { text: wp.name, resolved: wp, error: null, creating: null })
      setRoute(null); setRE(null)
    } catch (e) {
      patchWptRow(id, { error: e.message })
    }
  }

  // Editable waypoints — dep + optional intermediates + dest
  const [waypoints, setWaypoints] = useState([])

  // Amber, non-blocking notice when a dep/dest point is dragged off-airport
  const [endpointWarning, setEndpointWarning] = useState(null)
  const endpointWarnTimer = useRef(null)
  function showEndpointWarning(msg) {
    clearTimeout(endpointWarnTimer.current)
    setEndpointWarning(msg)
    if (msg) endpointWarnTimer.current = setTimeout(() => setEndpointWarning(null), 5000)
  }
  useEffect(() => {
    if (route?.depPos && route?.destPos) {
      setWaypoints([
        { id: 'dep',  lat: route.depPos[0],  lon: route.depPos[1],  name: dep },
        // `via` rides along: it marks a fix an airway expanded into rather
        // than a point the pilot entered, which is what lets the map drop its
        // label first when there isn't room for every one.
        ...(route.wpts ?? []).map((w, i) => ({ id: `named-${i}-${w.name}`, lat: w.lat, lon: w.lon, name: w.name, kind: w.kind, via: w.via })),
        { id: 'dest', lat: route.destPos[0], lon: route.destPos[1], name: dest },
      ])
    }
  }, [route?.depPos?.[0], route?.depPos?.[1], route?.destPos?.[0], route?.destPos?.[1], JSON.stringify(route?.wpts)])

  function insertWaypoint(index, lat, lon, name = null) {
    setWaypoints(prev => {
      const next = [...prev]
      next.splice(index, 0, { id: `wp-${Date.now()}`, lat, lon, name })
      return next
    })
  }

  // ── Dropping a point on the map ──
  // A drop opens the picker rather than committing a coordinate: the finger
  // lands somewhere approximate, and what the pilot almost always wants is the
  // charted point a mile or two away.
  // True while the map is open specifically to be asked "where?" — a tap
  // places a point instead of dismissing one.
  const [pickMode, setPickMode] = useState(false)
  // The standalone "where am I going" map, shown before a route exists.
  // Holds the departure it opened over rather than a bare flag, so render
  // never has to read a ref to find out where to centre.
  const [pickDest, setPickDest] = useState(null)
  const [dropPoint, setDropPoint] = useState(null)
  function openDropPicker(pt) { setDropPoint(pt) }

  // Bending the route line proposes a point; it does not add one.
  //
  // This used to insert on release and leave the waypoint behind when the
  // picker was dismissed, so an accidental pull left a bend in the route that
  // had to be hunted down and deleted. Nothing enters the route until the
  // picker is confirmed, and closing it leaves the route exactly as it was.
  function onDragInsert({ lat, lon, seg }) {
    setDropPoint({ lat, lon, seg })
  }

  // Dragging an existing waypoint is different: the marker has already moved
  // under the finger, so the map would lie if the route did not follow. It
  // moves, and the original position is remembered so dismissing the picker
  // puts it back rather than silently keeping a position nobody confirmed.
  function onWaypointDrop(index, latlng) {
    const before = waypoints[index]
    moveWaypoint(index, latlng)
    setDropPoint({
      lat: latlng.lat, lon: latlng.lng, moveIndex: index,
      revertTo: before ? { lat: before.lat, lon: before.lon, name: before.name ?? null } : null,
    })
  }

  // Closing the picker undoes whatever the gesture did on the way in.
  function cancelDrop() {
    setPickMode(false)
    const d = dropPoint
    if (d?.revertTo && d.moveIndex != null) {
      setWaypoints(prev => prev.map((w, i) => (i === d.moveIndex ? { ...w, ...d.revertTo } : w)))
    }
    setDropPoint(null)
  }

  function commitDrop(choice) {
    setPickMode(false)
    const { lat, lon, name, as } = choice
    if (as === 'destination' && name) {
      // Re-file the route to end here. The coordinates come from the bundled
      // pack, so a strip the weather service has never heard of still routes.
      changeDest(name); setDestVal(true); setDestErr(null)
      setDropPoint(null)
      calcRoute({ dest: name, destPos: [lat, lon], rows: [] })
      return
    }
    if (dropPoint?.moveIndex != null) {
      setWaypoints(prev => prev.map((w, i) =>
        i === dropPoint.moveIndex ? { ...w, lat, lon, name } : w))
      setDropPoint(null)
      return
    }
    if (as === 'append') {
      // A new final waypoint: the old destination stays in the route as the
      // point before it, which is what "continue on to" means.
      setWaypoints(prev => [...prev, { id: `wp-${Date.now()}`, lat, lon, name }])
    } else {
      insertWaypoint(dropPoint?.seg ?? Math.max(1, waypoints.length - 1), lat, lon, name)
    }
    setDropPoint(null)
  }
  function moveWaypoint(index, latlng) {
    // Dragging an endpoint away from its airport is allowed, but warn once
    // it leaves the airport area (~2 NM from the field reference point).
    // Side effect stays OUTSIDE the state updater (React suppresses effects
    // run inside updaters).
    const isDep  = index === 0
    const isDest = index === waypoints.length - 1
    if ((isDep || isDest) && route?.depPos && route?.destPos) {
      const home = isDep ? route.depPos : route.destPos
      const icao = isDep ? route.dep : route.dest
      const distOff = haversineNm(latlng.lat, latlng.lng, home[0], home[1])
      if (distOff > 2) {
        showEndpointWarning(`${icao} point is ${Math.round(distOff)} NM outside the airport area`)
      } else {
        showEndpointWarning(null)
      }
    }
    setWaypoints(prev => prev.map((w, i) => i === index ? { ...w, lat: latlng.lat, lon: latlng.lng } : w))
  }
  function removeWaypoint(index) {
    setWaypoints(prev => prev.filter((_, i) => i !== index))
  }

  // Real terrain detection via corridor elevation + FAA airport corridor check
  const [detectedTerrain, setDetectedTerrain] = useState([])
  // Terrain measurement behind the Mountains chip: highest point in the
  // corridor, where it is, and what it leaves under the planned altitude.
  // status 'unavailable' is shown rather than hidden — see below.
  const [terrainInfo, setTerrainInfo] = useState(null)
  // Overwater measurement behind the Water chip — distance, longest crossing,
  // and how far from shore the route gets.
  const [waterInfo, setWaterInfo] = useState(null)
  // Aerodromes near the route — which fields, how far off track.
  const [aeroInfo, setAeroInfo] = useState(null)
  // The field whose popup is open, and whether the map has been flown off the
  // route to reach it. Flying 800 NM up the route to look at an airport is a
  // one-way trip without somewhere to go back to, so the framing is offered
  // back explicitly rather than left to the pilot to re-find.
  const [openField, setOpenField] = useState(null)
  const [awayFromRoute, setAwayFromRoute] = useState(false)
  const [refitNonce, setRefitNonce] = useState(0)
  const [peakFocused, setPeakFocused] = useState(false)
  // Class B/C/D the ground track crosses, with their vertical limits.
  const [airspaceInfo, setAirspaceInfo] = useState(null)
  // Per-source outcome: 'ok' | 'unavailable' | 'not-covered'. A failed query
  // and a clear route used to render identically (nothing), so a dead service
  // read as "no hazards found".
  const [sourceStatus, setSourceStatus] = useState({})
  const [recheckNonce, setRecheck] = useState(0)
  const [detectedParkNames, setDetectedParkNames] = useState([])
  const [detectedSUANames, setDetectedSUANames]   = useState([])
  const [detectedSUAPolys, setDetectedSUAPolys]   = useState([]) // [{name, typeCode, poly:[lat,lon][]}]
  useEffect(() => {
    if (waypoints.length < 2) { setDetectedTerrain([]); setTerrainInfo(null); setWaterInfo(null); setAeroInfo(null); setAirspaceInfo(null); setSourceStatus({}); return }
    let cancelled = false

    async function detect() {
      // Great-circle samples every 5 NM — see lib/corridor.js for why fixed
      // spacing (rather than a fixed count) and spherical interpolation matter.
      const { samples } = sampleRoute(waypoints, { spacingNm: 5 })
      const pts = samples.map(s => [s.lat, s.lon])

      // Terrain across the ±5 NM corridor, with the highest point and the
      // clearance it leaves under the planned altitude (see lib/terrain.js).
      // Water against bundled coastline polygons (see lib/water.js) — no
      // network, so this half of the analysis survives a dead connection.
      const [terrain, water] = await Promise.all([
        analyzeTerrain(waypoints, { altFt: selectedAlt || null }),
        analyzeWater(waypoints),
      ])

      if (cancelled) return

      const det = []
      setTerrainInfo(terrain)
      setWaterInfo(water)

      // Water: measured against the coastline. This used to be "terrain at or
      // below 15 ft, or inside one of three hardcoded ocean boxes", which
      // called every sea-level airport and coastal plain an overwater leg.
      const hasWater = water.status === 'ok' && water.overwater
      // Mountains: measured terrain only. Cruise altitude used to trigger this
      // as well, which flagged "Mountains" for a high cruise over flat ground.
      const hasMountains = terrain.status === 'ok' && terrain.maxFt > MOUNTAIN_FT

      if (hasWater) det.push('water')
      if (hasMountains) det.push('mountains')

      // Aerodromes from the bundled worldwide set (see lib/aerodromes.js).
      // This was an FAA ArcGIS query, which covers the US only — outside it
      // the chip simply never appeared, which reads as "no fields near your
      // route" rather than "not checked".
      const aero = await analyzeAerodromes(waypoints)
      setAeroInfo(aero)
      const hasAero = aero.status === 'ok' && aero.count > 0

      if (hasAero) det.push('aero')
      if (selectedAlt && selectedAlt > 10000) det.push('oxygen')

      // Bounding box for park + SUA queries
      const lats2 = pts.map(p => p[0]), lons2 = pts.map(p => p[1])
      const pad2 = 0.1
      const bbox2 = `${Math.min(...lons2)-pad2},${Math.min(...lats2)-pad2},${Math.max(...lons2)+pad2},${Math.max(...lats2)+pad2}`

      // Esri ring → [lat, lon][] polygon
      const ringToPoly = ring => ring.map(([x, y]) => [y, x])

      // NPS parks and FAA SUA — both US-only services, so a route outside
      // their coverage is reported as such instead of coming back empty.
      const inUS = touchesUS(waypoints)
      // Controlled airspace: FAA class airspace in the US, the bundled COCESNA
      // pack over Central America. It decides its own coverage.
      const airspace = await analyzeAirspace(waypoints, { altFt: selectedAlt || null })
      setAirspaceInfo(airspace)
      if (airspace.status === 'ok' && airspace.count > 0) det.push('airspace')

      const [npsRes, suaRes] = inUS ? await Promise.allSettled([
        fetch(`https://mapservices.nps.gov/arcgis/rest/services/LandResourcesDivisionTractAndBoundaryService/MapServer/1/query?where=1%3D1&geometry=${encodeURIComponent(bbox2)}&geometryType=esriGeometryEnvelope&spatialRel=esriSpatialRelIntersects&outFields=UNIT_NAME,UNIT_TYPE&returnGeometry=true&f=json`, { signal: AbortSignal.timeout(8000) }),
        fetch(`https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/Special_Use_Airspace/FeatureServer/0/query?where=1%3D1&geometry=${encodeURIComponent(bbox2)}&geometryType=esriGeometryEnvelope&spatialRel=esriSpatialRelIntersects&outFields=NAME,TYPE_CODE&returnGeometry=true&f=json`, { signal: AbortSignal.timeout(8000) }),
      ]) : [null, null]

      if (cancelled) return

      const okRes = r => r && r.status === 'fulfilled' && r.value.ok
      const statusOf = r => !inUS ? 'not-covered' : okRes(r) ? 'ok' : 'unavailable'

      // Parks
      const parkNames = []
      if (okRes(npsRes)) {
        try {
          const d = await npsRes.value.json()
          for (const f of (d.features || [])) {
            const rings = f.geometry?.rings || []
            const hit = rings.some(r => routeIntersectsPoly(waypoints, ringToPoly(r)))
            if (hit) parkNames.push(f.attributes?.UNIT_NAME || 'National Park')
          }
        } catch { /* ignore */ }
      }
      if (parkNames.length) det.push('parks')
      setDetectedParkNames(parkNames)

      // Special Use Airspace
      const suaNames = []
      const suaPolys = []
      if (okRes(suaRes)) {
        try {
          const d = await suaRes.value.json()
          for (const f of (d.features || [])) {
            const rings = f.geometry?.rings || []
            const hitRing = rings.find(r => routeIntersectsPoly(waypoints, ringToPoly(r)))
            if (hitRing) {
              const label = [f.attributes?.TYPE_CODE, f.attributes?.NAME].filter(Boolean).join(' ')
              if (label) {
                suaNames.push(label)
                suaPolys.push({ name: label, typeCode: f.attributes?.TYPE_CODE || '', poly: ringToPoly(hitRing) })
              }
            }
          }
        } catch { /* ignore */ }
      }
      if (suaNames.length) det.push('sua')
      setDetectedSUANames(suaNames)
      setDetectedSUAPolys(suaPolys)

      setSourceStatus({
        terrain: terrain.status === 'ok' ? 'ok' : 'unavailable',
        airspace: airspace.status === 'ok' ? 'ok' : airspace.status,
        parks: statusOf(npsRes),
        sua: statusOf(suaRes),
      })
      setDetectedTerrain(det)
    }

    detect()
    return () => { cancelled = true }
  }, [JSON.stringify(waypoints.map(w => [+w.lat.toFixed(3), +w.lon.toFixed(3)])), selectedAlt, recheckNonce])

  const OPENAIP_KEY = 'b640e75c082134fd6f1524246478f301'
  const [openaipKey, setOAKey] = useState(() => localStorage.getItem('openaip_key') || OPENAIP_KEY)

  // Persist key to localStorage + IndexedDB on mount so it's always available
  useEffect(() => {
    localStorage.setItem('openaip_key', OPENAIP_KEY)
    put('settings', { key: 'openaip_key', value: OPENAIP_KEY }).catch(() => {})
    setOAKey(OPENAIP_KEY)
  }, [])
  const [tfrData, setTfrData]    = useState(null)
  const [tfrLoading, setTfrLoad] = useState(false)
  const [mapFlyTarget, setMapFlyTarget] = useState(null)

  // TFR conflict detection — uses shared routeIntersectsPoly
  const tfrConflicts = useMemo(() => {
    if (!tfrData?.length || waypoints.length < 2) return []
    const hits = []
    for (const tfr of tfrData) {
      if (tfr.polygon?.length > 2) {
        if (routeIntersectsPoly(waypoints, tfr.polygon)) hits.push(tfr)
      } else if (tfr.lat && tfr.lon) {
        const near = waypoints.slice(0, -1).some((w, s) => {
          const d = crossTrackNM(tfr.lat, tfr.lon, [w.lat, w.lon], [waypoints[s+1].lat, waypoints[s+1].lon])
          return d < 5
        })
        if (near) hits.push(tfr)
      }
    }
    return hits
  }, [tfrData, JSON.stringify(waypoints.map(w => [+w.lat.toFixed(3), +w.lon.toFixed(3)]))])

  function saveKey(k) {
    const trimmed = k.trim()
    setOAKey(trimmed)
    localStorage.setItem('openaip_key', trimmed)
    put('settings', { key: 'openaip_key', value: trimmed }).catch(() => {})
  }

  function toggleLayer(name) {
    setLayers(prev => {
      const next = { ...prev, [name]: !prev[name] }
      // Chart layers are mutually exclusive — stacking two raster charts
      // (both multiply-blended) is unreadable.
      const CHARTS = ['sectional', 'ifrlo', 'ifrhi']
      if (CHARTS.includes(name) && next[name]) {
        for (const k of CHARTS) if (k !== name) next[k] = false
      }
      // Retry when the previous attempt failed or returned nothing —
      // `!tfrData` alone never retried after a failed fetch stored [].
      if (name === 'tfr' && next.tfr && !tfrData?.length && !tfrLoading) loadTFRs()
      return next
    })
  }

  async function loadTFRs() {
    setTfrLoad(true)
    setTfrData(null)

    // FAA GeoServer WFS (the endpoint tfr3 uses internally) via OUR /api/tfr
    // proxy — the FAA serves no CORS headers, and the public CORS proxies the
    // app previously fell back on (corsproxy.io, allorigins) have gone
    // dead/blocking, which silently broke TFRs. Same-origin proxy is the
    // reliable path; the old public proxies remain only as a last resort.
    const WFS_URL = 'https://tfr.faa.gov/geoserver/TFR/ows?service=WFS&version=1.1.0&request=GetFeature&typeName=TFR:V_TFR_LOC&maxFeatures=300&outputFormat=application/json&srsname=EPSG:4326'
    try {
      let raw
      try {
        const res = await fetch('/api/tfr', { signal: AbortSignal.timeout(15000) })
        if (!res.ok) throw new Error('proxy ' + res.status)
        raw = await res.text()
      } catch {
        raw = await proxyFetch(WFS_URL, 15000)
      }
      const geo = JSON.parse(raw)
      if (geo?.features?.length) {
        const tfrs = (geo.features || []).map(f => {
          const p = f.properties
          // GeoJSON coords are [lon, lat] — Leaflet needs [lat, lon]
          let polygon = null, lat = null, lon = null
          if (f.geometry?.type === 'Polygon') {
            polygon = f.geometry.coordinates[0].map(([lo, la]) => [la, lo])
            lat = polygon[0][0]; lon = polygon[0][1]
          } else if (f.geometry?.type === 'Point') {
            [lon, lat] = f.geometry.coordinates
          } else if (f.geometry?.type === 'MultiPolygon') {
            polygon = f.geometry.coordinates[0][0].map(([lo, la]) => [la, lo])
            lat = polygon[0][0]; lon = polygon[0][1]
          }
          return {
            id:      p.NOTAM_KEY ?? f.id ?? '?',
            type:    p.LEGAL ?? 'TFR',
            desc:    p.TITLE ?? '',
            state:   p.STATE ?? '',
            lat, lon, polygon,
          }
        }).filter(t => t.lat !== null)
        setTfrData(tfrs)
        setTfrLoad(false)
        return
      }
    } catch { /* ignore */ }

    // Parse GeoRSS XML — returns TFRs with polygon/point geometry for map rendering
    const parseGeoRss = xml => {
      const doc = new DOMParser().parseFromString(xml, 'text/xml')
      const items = [...doc.querySelectorAll('item')]
      return items.map(item => {
        const title = item.querySelector('title')?.textContent?.trim() ?? '?'
        const desc  = item.querySelector('description')?.textContent?.trim() ?? ''

        // GeoRSS polygon: space-separated "lat lon lat lon ..."
        const polyNode = [...item.childNodes].find(n => n.localName === 'polygon')
        // GeoRSS point: "lat lon"
        const ptNode   = [...item.childNodes].find(n => n.localName === 'point')
        // where element: may contain gml:polygon
        const whereNode = [...item.childNodes].find(n => n.localName === 'where')

        let polygon = null, lat = null, lon = null

        if (polyNode) {
          const nums = polyNode.textContent.trim().split(/\s+/).map(Number).filter(n => !isNaN(n))
          if (nums.length >= 4) {
            polygon = []
            for (let i = 0; i < nums.length - 1; i += 2) polygon.push([nums[i], nums[i+1]])
            lat = polygon[0][0]; lon = polygon[0][1]
          }
        }
        if (!polygon && whereNode) {
          const coords = whereNode.textContent.trim().split(/\s+/).map(Number).filter(n => !isNaN(n))
          if (coords.length >= 4) {
            polygon = []
            for (let i = 0; i < coords.length - 1; i += 2) polygon.push([coords[i], coords[i+1]])
            lat = polygon[0][0]; lon = polygon[0][1]
          }
        }
        if (!lat && ptNode) {
          const [la, lo] = ptNode.textContent.trim().split(/\s+/).map(Number)
          lat = la; lon = lo
        }

        // Extract type from description HTML
        const typeMatch = desc.match(/(?:type|scenario)[^>]*?>([^<]+)/i)
        const type = typeMatch?.[1]?.trim().toUpperCase() ?? 'TFR'

        return { id: title, type, desc: desc.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(), lat, lon, polygon }
      }).filter(t => t.lat !== null)
    }

    // Parse tfr2 JSON (no coords — list only fallback)
    const parseTfr2Json = raw => {
      const data = JSON.parse(raw)
      const list = Array.isArray(data) ? data : (data.TFRAreaList || data.tfr || data.items || [])
      return list.map(t => ({
        id:      t.notam_id ?? t.notamID ?? t.id ?? '?',
        type:    t.type ?? 'TFR',
        desc:    t.description ?? t.facilityName ?? '',
        date:    t.creation_date ?? '',
        lat:     null, lon: null, polygon: null,
      }))
    }

    let tfrs = null

    // 1. FAA GeoRSS feeds — have actual coordinates for map rendering
    const GEORSS_URLS = [
      'https://tfr.faa.gov/tfr2/georss.xml',
      'https://tfr.faa.gov/save_pages/tfrRssALL.xml',
      'https://tfr.faa.gov/tfr2/tfr.rss',
    ]
    for (const url of GEORSS_URLS) {
      try {
        const raw = await proxyFetch(url, 12000)
        if (raw.includes('<item') || raw.includes('<entry')) {
          const parsed = parseGeoRss(raw)
          if (parsed.length) { tfrs = parsed; break }
        }
      } catch { /* ignore */ }
    }

    // 2. AWC NOTAM API — CORS-friendly, no proxy needed
    if (!tfrs) {
      try {
        const res = await fetch(
          awcUrl('notam', { format: 'json', hazard: 'tfr' }),
          { signal: AbortSignal.timeout(8000) }
        )
        if (res.ok) {
          const data = await res.json()
          const list = Array.isArray(data) ? data : (data.items || data.notams || [])
          if (list.length) {
            tfrs = list.map(t => {
              // AWC may include geometry in WKT or GeoJSON
              let polygon = null, lat = t.lat ?? null, lon = t.lon ?? null
              if (t.geometry?.coordinates) {
                const coords = t.geometry.coordinates[0]
                if (coords) { polygon = coords.map(([lo, la]) => [la, lo]); lat = polygon[0][0]; lon = polygon[0][1] }
              }
              return { id: t.notamID ?? t.icaoId ?? '?', type: t.hazard ?? 'TFR', desc: t.rawNOTAM ?? '', lat, lon, polygon }
            }).filter(t => t.lat !== null)
          }
        }
      } catch { /* ignore */ }
    }

    // 3. tfr2 JSON fallback (list only, no map geometry)
    if (!tfrs) {
      try {
        const raw = await proxyFetch('https://tfr.faa.gov/tfr2/list.json', 15000)
        tfrs = parseTfr2Json(raw)
      } catch { /* ignore */ }
    }

    setTfrData(tfrs ?? [])
    setTfrLoad(false)
  }


  // `over` lets a caller recalculate with a field it has only just chosen,
  // without waiting a render for the state to land — and lets it supply
  // coordinates it already holds, so a small field the weather service has
  // never heard of still routes.
  async function calcRoute(over = {}) {
    const depId = (over.dep ?? dep).trim().toUpperCase()
    const destId = (over.dest ?? dest).trim().toUpperCase()
    if (!depId || !destId) return
    setRL(true); setRE(null); setRoute(null)
    try {
      const [da, dsta] = await Promise.all([
        over.depPos ? { lat: over.depPos[0], lon: over.depPos[1] } : fetchAWC(depId),
        over.destPos ? { lat: over.destPos[0], lon: over.destPos[1] } : fetchAWC(destId),
      ])
      if (!da?.lat || !dsta?.lat) throw new Error('Coordinates not found')

      const depLat = parseFloat(da.lat), depLon = parseFloat(da.lon)
      const dstLat = parseFloat(dsta.lat), dstLon = parseFloat(dsta.lon)

      // Full chain: dep → named waypoints → dest, expanding airway tokens
      // (V25, J501…) into their fix chain between the neighboring rows.
      // Distance sums per leg; course is the first leg's (what you'd fly
      // off the departure).
      // over.rows lets a caller that has just built a new set of waypoints
      // calculate with them immediately, rather than waiting a render for
      // wptRows state to catch up.
      const rowTokens = (over.rows ?? wptRows).filter(r => r.resolved).map(r => r.resolved)
      const wpts = []
      const airwayNotes = []
      const procedureNotes = []
      for (let i = 0; i < rowTokens.length; i++) {
        const t = rowTokens[i]
        // A SID or STAR expands the same way an airway does — the row keeps
        // the published name, because that is what gets filed and read back,
        // and the fixes underneath it are what gets drawn. Which transition
        // applies is decided by the fix on the other side of it in the route,
        // exactly as the clearance reads: "CWARD2 SLI" leaves at SLI.
        if (t.kind === 'PROC') {
          const isDeparture = t.role === 'SID'
          const neighbour = isDeparture
            ? rowTokens[i + 1]?.name ?? destId
            : wpts[wpts.length - 1]?.name ?? depId
          const res = await expandProcedure(isDeparture ? depId : destId, t.name, neighbour)
          if (!res) {
            const err = new Error(`${t.name} is not a published procedure at ${isDeparture ? depId : destId}`)
            err.userMessage = err.message
            throw err
          }
          for (const ident of res.fixes) {
            const hit = await resolveWaypoint(ident, [depLat, depLon])
            if (hit) wpts.push({ kind: hit.kind, name: hit.name, lat: hit.lat, lon: hit.lon, via: t.name })
          }
          if (res.undrawable || res.partial || res.hasRunwayTransition) {
            procedureNotes.push({ proc: t.name, t: res.t, undrawable: res.undrawable,
                                  partial: res.partial, transition: res.transition,
                                  runway: res.hasRunwayTransition })
          }
          continue
        }
        if (t.kind !== 'AWY') {
          wpts.push({ kind: t.kind, name: t.name, lat: t.lat, lon: t.lon, ...(t.via ? { via: t.via } : {}) })
          continue
        }
        const prev = wpts[wpts.length - 1]
        const nextT = rowTokens[i + 1]
        if (!prev || !nextT || nextT.kind === 'AWY') {
          const err = new Error(`${t.name} needs a fix or VOR on the airway before and after it`)
          err.userMessage = err.message
          throw err
        }
        const res = await expandAirway(t.name, prev.name, nextT.name, [prev.lat, prev.lon])
        if (res.error) {
          const err = new Error(res.error)
          err.userMessage = res.error
          throw err
        }
        for (const f of res.fixes) wpts.push(f)
        if (res.maxMEA != null) airwayNotes.push({ awy: t.name, mea: res.maxMEA })
      }
      // A procedure or airway normally ends on the very fix the next token
      // names — "CWARD2 SLI" leaves the departure at SLI, and SLI is then
      // filed again as the next point. Flown, that is one fix; left in, it is
      // a zero-length leg that shows up as a doubled label on the map and an
      // extra row in the navigation log.
      for (let i = wpts.length - 1; i > 0; i--) {
        if (wpts[i].name && wpts[i].name === wpts[i - 1].name) wpts.splice(i, 1)
      }

      const chain = [[depLat, depLon], ...wpts.map(w => [w.lat, w.lon]), [dstLat, dstLon]]
      let dist = 0
      for (let i = 0; i < chain.length - 1; i++) {
        dist += haversineNm(chain[i][0], chain[i][1], chain[i + 1][0], chain[i + 1][1])
      }
      const tc = bearingDeg(chain[0][0], chain[0][1], chain[1][0], chain[1][1])

      // NOAA magnetic declination at route midpoint
      const midLat = (depLat + dstLat) / 2
      const midLon = (depLon + dstLon) / 2
      let magVar = 0
      try {
        const r = await fetch(
          `https://www.ngdc.noaa.gov/geomag-web/calculators/calculateDeclination?lat1=${midLat.toFixed(4)}&lon1=${midLon.toFixed(4)}&key=zNEw7&resultFormat=json`
        )
        const d = await r.json()
        magVar = d.result?.[0]?.declination ?? 0
      } catch { /* ignore */ }

      const mc = ((tc - magVar) + 360) % 360
      const mcRounded = Math.round(mc)

      const routeObj = {
        tc: Math.round(tc), mc: mcRounded,
        distNm: Math.round(dist),
        magVar: magVar.toFixed(1),
        depName: da.name || dep.toUpperCase(),
        destName: dsta.name || dest.toUpperCase(),
        depPos:  [depLat, depLon],
        destPos: [dstLat, dstLon],
        dep: depId,
        dest: destId,
        wpts,
        airwayNotes,
        procedureNotes,
        // Compact filed-route tokens (airways kept as V25 etc.) — drives the
        // row restore and the one-pager's ATS route string.
        atsTokens: [depId, ...rowTokens.map(t => t.name), destId],
      }
      setRoute(routeObj)
      // No chart is switched on here. Calculating a route used to open the
      // enroute Low for IFR and the sectional for VFR, which put a dense chart
      // under the one thing the pilot had just asked to see — the line between
      // two airports — in the small preview where it is least legible. The
      // preview starts bare; the chart buttons are right above it, and once a
      // layer is chosen it stays chosen, including when the fullscreen map is
      // closed and the preview comes back.
      // No fly-to here — RouteFitter frames the whole route on map mount,
      // and a lingering target would snap fullscreen away from that framing.
      setMapFlyTarget(null)
      put('settings', { key: 'route', ...routeObj }).catch(() => {})
      setCourse(String(mcRounded))
      setSelectedAlt(null)
      // Returned so a caller that needs the route to exist before it can act —
      // opening the map to pick a waypoint on it — can wait for the real thing
      // instead of for a state update it cannot see yet.
      return routeObj
    } catch (e) {
      setRE(e.userMessage || 'Could not calculate — check both ICAO codes')
      return null
    } finally {
      setRL(false)
    }
  }

  const hasWaypoint = wptRows.length > 0 || waypoints.length > 2
  const c        = parseInt(course)
  const valid    = !isNaN(c) && c >= 0 && c <= 360
  const isEast   = valid && c <= 179
  const direction = valid ? (isEast ? 'Eastbound' : 'Westbound') : null
  // VFR cruising altitudes are hemispheric thousands + 500 (§91.159); IFR
  // are plain thousands (§91.179) — odd eastbound, even westbound.
  const isIFR = flightRules === 'IFR'
  // Below 18,000 ft the hemispheric rule gives thousands (IFR) or thousands
  // +500 (VFR). At and above FL180 everything is IFR in Class A, so the list
  // continues as flight levels on the same odd/even split. Capped at the
  // aircraft's service ceiling — offering FL450 to a C172 is noise.
  const altitudes = valid ? (() => {
    const out = []
    const oddEast = isEast
    for (let a = 3000; a <= 17000; a += 1000) {
      const odd = (a / 1000) % 2 === 1
      if (odd !== oddEast) continue
      out.push(isIFR ? a : a + 500)
    }
    for (let fl = 180; fl <= 600; fl += 10) {
      const odd = (fl / 10) % 2 === 1
      if (odd !== oddEast) continue
      out.push(fl * 100)
    }
    const ceiling = acPerf?.serviceCeilingFt
    return ceiling ? out.filter(a => a <= ceiling + 1000) : out
  })() : null
  // Highest MEA among the airways in the calculated route — altitudes below
  // it are flagged (never blocked; ATC may still assign segment-specific).
  const routeMaxMEA = route?.airwayNotes?.length
    ? Math.max(...route.airwayNotes.map(n => n.mea)) : null

  // ── Altitude advice ──
  // Runs once per route/rules/ETD change and scores every candidate at once,
  // so changing the selected altitude afterwards costs nothing. Terrain and
  // airspace are handed in from the state above rather than refetched.
  useEffect(() => {
    if (!altitudes?.length || waypoints.length < 2) { setAdvice(null); return }
    let cancelled = false
    setAdviceBusy(true)
    recommendCruise(waypoints, {
      flightRules,
      candidateAlts: altitudes,
      aircraft,
      routeMaxMEA,
      departAtISO: etd || null,
      terrain: terrainInfo,
      airspace: airspaceInfo,
      fieldElevFt: route?.depElevFt ?? 0,
    }).then(res => { if (!cancelled) { setAdvice(res); setAdviceBusy(false); setBrief(null) } })
      .catch(() => { if (!cancelled) { setAdvice({ status: 'unavailable' }); setAdviceBusy(false) } })
    return () => { cancelled = true }
  }, [
    JSON.stringify(waypoints.map(w => [+w.lat.toFixed(3), +w.lon.toFixed(3)])),
    flightRules, etd?.slice(0, 13), aircraft?.id, altitudes?.length, routeMaxMEA,
    terrainInfo?.maxFt, airspaceInfo?.count,
  ])

  // True when any point of the planned route sits outside the regions we hold
  // current navdata for — drives the Tier-2 reference disclosure on the map.
  const routeLeavesTier1 = waypoints.length >= 2 &&
    waypoints.some(w => !inTier1(w.lat, w.lon))

  return (
    <ExpandableCard item={item} isChecked={isChecked} onToggle={onToggle} open={open} setOpen={setOpen}>
      <div style={{ padding: '14px 12px 12px' }}>

        {/* ── Route calculator ── */}
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 10 }}>
          Route
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginBottom: 4, letterSpacing: '0.3px', textTransform: 'uppercase' }}>From</div>
            {depValidated ? (
              <div style={{
                width: '100%', background: 'var(--bg-card-2)', borderRadius: 9, padding: '9px 11px', boxSizing: 'border-box',
                display: 'flex', alignItems: 'center',
              }}>
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 7,
                  background: 'var(--bg-card)', borderRadius: 6, padding: '3px 8px 3px 10px',
                }}>
                  <span style={{
                    fontSize: 16, fontWeight: 700, fontFamily: 'monospace',
                    letterSpacing: '1px', color: 'var(--text)', lineHeight: 1,
                  }}>
                    {dep}
                  </span>
                  <button
                    onClick={() => { changeDep(''); setDepVal(false); setDepErr(null) }}
                    style={{
                      background: 'none', border: 'none', padding: '2px',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      cursor: 'pointer', color: 'var(--text-tertiary)',
                    }}>
                    <svg width={9} height={9} viewBox="0 0 24 24" fill="none">
                      <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
                    </svg>
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <input
                  value={dep}
                  onChange={e => { changeDep(e.target.value.toUpperCase()); setDepErr(null) }}
                  onKeyDown={e => e.key === 'Enter' && validateDep()}
                  onBlur={() => dep.trim().length >= 3 && validateDep()}
                  placeholder="KMIA"
                  maxLength={4}
                  style={{
                    width: '100%', background: 'var(--bg-card-2)', border: `0.5px solid ${depError ? 'var(--danger)' : 'var(--border)'}`,
                    borderRadius: 9, padding: '9px 11px', color: 'var(--text)',
                    fontSize: 16, fontWeight: 700, fontFamily: 'monospace',
                    letterSpacing: '1px', outline: 'none', boxSizing: 'border-box',
                    opacity: depChecking ? 0.6 : 1,
                  }}
                />
                {depError && <div style={{ fontSize: 10, color: 'var(--danger)', marginTop: 3 }}>{depError}</div>}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ height: 18, flexShrink: 0 }} />
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <img
                src={isHelicopter ? '/helicopter.png' : '/modo-avion.png'}
                width={18} height={18} alt=""
                style={{ objectFit: 'contain', filter: 'var(--icon-filter)', flexShrink: 0, transform: 'rotate(90deg)' }}
              />
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginBottom: 4, letterSpacing: '0.3px', textTransform: 'uppercase' }}>To</div>
            {destValidated ? (
              <div style={{
                width: '100%', background: 'var(--bg-card-2)', borderRadius: 9, padding: '9px 11px', boxSizing: 'border-box',
                display: 'flex', alignItems: 'center',
              }}>
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 7,
                  background: 'var(--bg-card)', borderRadius: 6, padding: '3px 8px 3px 10px',
                }}>
                  <span style={{ fontSize: 16, fontWeight: 700, fontFamily: 'monospace', letterSpacing: '1px', color: 'var(--text)', lineHeight: 1 }}>
                    {dest}
                  </span>
                  <button
                    onClick={() => { changeDest(''); setDestVal(false); setDestErr(null) }}
                    style={{
                      background: 'none', border: 'none', padding: '2px',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      cursor: 'pointer', color: 'var(--text-tertiary)',
                    }}>
                    <svg width={9} height={9} viewBox="0 0 24 24" fill="none">
                      <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
                    </svg>
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <input
                  value={dest}
                  onChange={e => { changeDest(e.target.value.toUpperCase()); setDestErr(null) }}
                  onKeyDown={e => e.key === 'Enter' && validateDest()}
                  onBlur={() => dest.trim().length >= 3 && validateDest()}
                  placeholder="MGGT"
                  maxLength={4}
                  style={{
                    width: '100%', background: 'var(--bg-card-2)', border: `0.5px solid ${destError ? 'var(--danger)' : 'transparent'}`,
                    borderRadius: 9, padding: '9px 11px', color: 'var(--text)',
                    fontSize: 16, fontWeight: 700, fontFamily: 'monospace',
                    letterSpacing: '1px', outline: 'none', boxSizing: 'border-box',
                    opacity: destChecking ? 0.6 : 1,
                  }}
                />
                {destError && <div style={{ fontSize: 10, color: 'var(--danger)', marginTop: 3 }}>{destError}</div>}
              </div>
            )}
          </div>
        </div>

        {/* ── Published routes ── */}
        {pubCount > 0 && (
          <div style={{ marginBottom: 8 }}>
            <button
              onClick={() => setPubOpen(o => !o)}
              style={{
                width: '100%', padding: '8px 11px', borderRadius: 9,
                background: 'var(--bg-card-2)', border: 'none', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
              }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
                {pubRoutes.exact.length > 0
                  ? `Published routes (${pubRoutes.exact.length})`
                  : `Related routes (${pubCount})`}
              </span>
              <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
                {pubOpen ? 'Hide'
                  : pubRoutes.exact.length > 0 ? 'What ATC issues'
                  : 'Nothing published for this pair'}
              </span>
            </button>

            {pubOpen && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 6 }}>
                {PUB_GROUPS.map(g => pubRoutes[g.key]?.length ? (
                  <div key={g.key} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {g.key !== 'exact' && (
                      <div style={{ marginTop: 4 }}>
                        <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.4px',
                          color: 'var(--warn)', textTransform: 'uppercase' }}>{g.heading}</div>
                        <div style={{ fontSize: 9.5, color: 'var(--text-tertiary)', lineHeight: 1.45, marginTop: 2 }}>
                          {g.note}
                        </div>
                      </div>
                    )}
                    {pubRoutes[g.key].map(r => (
                      <button
                        key={`${g.key}-${r.from}-${r.to}-${r.d}-${r.r}`}
                        onClick={() => applyPublished(r)}
                        disabled={pubBusy != null}
                        style={{
                          textAlign: 'left', padding: '8px 11px', borderRadius: 9, cursor: 'pointer',
                          background: 'var(--bg-card-2)',
                          border: `0.5px solid ${g.key === 'exact' ? 'var(--border)' : 'rgba(255,159,10,0.35)'}`,
                          opacity: pubBusy && pubBusy !== r.d ? 0.5 : 1,
                        }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 12, fontWeight: 700, fontFamily: 'monospace', letterSpacing: '0.5px', color: 'var(--text)' }}>
                            {r.label}
                          </span>
                          <span style={{
                            fontSize: 9, fontWeight: 700, letterSpacing: '0.4px', padding: '2px 6px',
                            borderRadius: 7, background: 'rgba(10,132,255,0.18)', color: '#64a8ff',
                          }}>{r.typeLabel}</span>
                          {/* The pair it was actually published for, on the row
                              itself — a heading scrolls out of sight, and this
                              is the one thing that must not be missed. */}
                          {g.key !== 'exact' && (
                            <span style={{
                              fontSize: 9, fontWeight: 700, letterSpacing: '0.4px', padding: '2px 6px',
                              borderRadius: 7, background: 'rgba(255,159,10,0.16)', color: 'var(--warn)',
                            }}>
                              {r.from} → {r.to}{r.viaDistNm ? ` · ${r.viaDistNm} NM away` : ''}
                            </span>
                          )}
                          {r.a && <span style={{ fontSize: 9.5, color: 'var(--text-tertiary)' }}>{r.a}</span>}
                          {pubBusy === r.d && <span style={{ fontSize: 9.5, color: 'var(--text-tertiary)' }}>Loading…</span>}
                        </div>
                        <div style={{ fontSize: 11.5, fontFamily: 'monospace', color: 'var(--text-secondary)', lineHeight: 1.4, wordBreak: 'break-word' }}>
                          {r.r}
                        </div>
                        {(r.h || r.ac) && (
                          <div style={{ fontSize: 9.5, color: 'var(--text-tertiary)', marginTop: 3 }}>
                            {[r.ac, r.h].filter(Boolean).join(' · ')}
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                ) : null)}
                <div style={{ fontSize: 9.5, color: 'var(--text-tertiary)', lineHeight: 1.45, padding: '2px 2px 0' }}>
                  FAA preferred and tower en-route routes, {' '}NASR current cycle. Tapping one
                  replaces the waypoints below. Verify against your clearance — these are what
                  ATC normally issues, not a guarantee of what you will get.
                </div>
              </div>
            )}

            {pubApplied && !pubOpen && (
              <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 5, lineHeight: 1.45 }}>
                Filled from <span style={{ fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{pubApplied.designator}</span>
                {pubApplied.basis === 'reverse' && (
                  <span style={{ color: 'var(--warn)' }}>, published {pubApplied.from} → {pubApplied.to} and reversed here</span>
                )}
                {pubApplied.basis === 'nearby' && (
                  <span style={{ color: 'var(--warn)' }}>, published for {pubApplied.from} → {pubApplied.to}, not this pair</span>
                )}.
                {pubApplied.skipped.length > 0 && (
                  <> {pubApplied.skipped.join(', ')} {pubApplied.skipped.length > 1 ? 'are' : 'is'} a
                  departure or arrival procedure — file {pubApplied.skipped.length > 1 ? 'them' : 'it'} as
                  published, but the app cannot draw {pubApplied.skipped.length > 1 ? 'them' : 'it'} without
                  the FAA procedure data.</>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Intermediate waypoints ── */}
        {wptRows.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
            {wptRows.map((row, i) => (
              <div key={row.id}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ fontSize: 10, color: 'var(--text-tertiary)', letterSpacing: '0.3px', width: 34, flexShrink: 0, textTransform: 'uppercase' }}>
                    WPT {i + 1}
                  </div>
                  {row.resolved ? (
                    <div style={{
                      flex: 1, background: 'var(--bg-card-2)', borderRadius: 9, padding: '7px 11px',
                      display: 'flex', alignItems: 'center', gap: 8, boxSizing: 'border-box',
                    }}>
                      <span style={{ fontSize: 15, fontWeight: 700, fontFamily: 'monospace', letterSpacing: '1px', color: 'var(--text)' }}>
                        {row.resolved.name}
                      </span>
                      <span style={{
                        fontSize: 9, fontWeight: 700, letterSpacing: '0.5px', padding: '2px 7px', borderRadius: 8,
                        background: row.resolved.kind === 'VOR' ? 'rgba(139,92,246,0.18)' : row.resolved.kind === 'GPS' ? 'rgba(52,199,89,0.15)' : row.resolved.kind === 'AWY' ? 'rgba(10,132,255,0.18)' : row.resolved.kind === 'PROC' ? 'rgba(255,214,10,0.18)' : 'rgba(255,159,10,0.15)',
                        color:      row.resolved.kind === 'VOR' ? '#a78bfa' : row.resolved.kind === 'GPS' ? 'var(--ok)' : row.resolved.kind === 'AWY' ? '#64a8ff' : row.resolved.kind === 'PROC' ? '#FFD60A' : 'var(--warn)',
                      }}>
                        {/* A procedure row reads SID or STAR, not "PROC" —
                            that is the word on the chart and in the clearance. */}
                        {row.resolved.kind === 'PROC' ? row.resolved.role : row.resolved.kind}
                      </span>
                      {row.resolved.kind === 'PROC' && (
                        <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
                          {row.resolved.fixCount} fixes
                        </span>
                      )}
                      {row.resolved.kind === 'VOR' && row.resolved.vorName && (
                        <span style={{ fontSize: 10, color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {row.resolved.vorName}{row.resolved.freq ? ` · ${row.resolved.freq}` : ''}
                        </span>
                      )}
                    </div>
                  ) : (
                    <input
                      value={row.text}
                      onChange={e => {
                        const v = e.target.value.toUpperCase()
                        patchWptRow(row.id, { text: v, resolved: null, error: null })
                        // silent auto-resolve at fix/VOR lengths, Garmin-style
                        if (v.trim().length === 5 || v.trim().length === 3) {
                          resolveWaypoint(v.trim()).then(hit => {
                            if (hit) patchWptRow(row.id, { text: v.trim(), resolved: hit, error: null })
                          })
                        }
                        // …and airway IDs (V25, J501) as they're typed
                        if (looksLikeAirway(v.trim())) {
                          lookupAirway(v.trim()).then(a => {
                            if (a) patchWptRow(row.id, { text: v.trim().toUpperCase(), resolved: { kind: 'AWY', name: v.trim().toUpperCase() }, error: null })
                          })
                        }
                      }}
                      onKeyDown={e => e.key === 'Enter' && resolveWptRow(row.id, row.text)}
                      onBlur={() => row.text.trim() && resolveWptRow(row.id, row.text)}
                      placeholder="GPS · VOR · user"
                      maxLength={10}
                      style={{
                        flex: 1, minWidth: 0, background: 'var(--bg-card-2)',
                        border: `0.5px solid ${row.error ? 'var(--danger)' : 'transparent'}`,
                        borderRadius: 9, padding: '8px 11px', color: 'var(--text)',
                        fontSize: 16, fontWeight: 700, fontFamily: 'monospace',
                        letterSpacing: '1px', outline: 'none', boxSizing: 'border-box',
                      }}
                    />
                  )}
                  <button
                    onClick={() => removeWptRow(row.id)}
                    style={{
                      background: 'var(--bg-card-2)', border: 'none', borderRadius: 8,
                      width: 28, height: 28, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      cursor: 'pointer', color: 'var(--text-tertiary)',
                    }}>
                    <svg width={10} height={10} viewBox="0 0 24 24" fill="none">
                      <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
                    </svg>
                  </button>
                </div>
                {row.error === 'not-found' && !row.creating && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0 0 42px' }}>
                    <span style={{ fontSize: 10, color: 'var(--danger)' }}>Not a known GPS fix or VOR</span>
                    <button
                      onClick={() => patchWptRow(row.id, { creating: { lat: '', lon: '' }, error: null })}
                      style={{
                        background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                        fontSize: 10, fontWeight: 600, color: 'var(--warn)', textDecoration: 'underline',
                      }}>
                      Create user waypoint
                    </button>
                  </div>
                )}
                {row.error && row.error !== 'not-found' && (
                  <div style={{ fontSize: 10, color: 'var(--danger)', margin: '4px 0 0 42px' }}>
                    {row.error === 'bad-coords' ? 'Enter valid decimal coordinates (lat −90…90, lon −180…180)' : row.error}
                  </div>
                )}
                {row.creating && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '6px 0 0 42px' }}>
                    <input
                      value={row.creating.lat}
                      onChange={e => patchWptRow(row.id, { creating: { ...row.creating, lat: e.target.value } })}
                      placeholder="Lat 37.615"
                      inputMode="decimal"
                      style={{
                        flex: 1, minWidth: 0, background: 'var(--bg-card-2)', border: 'none', borderRadius: 8,
                        padding: '7px 10px', color: 'var(--text)', fontSize: 16, fontFamily: 'monospace', outline: 'none', boxSizing: 'border-box',
                      }}
                    />
                    <input
                      value={row.creating.lon}
                      onChange={e => patchWptRow(row.id, { creating: { ...row.creating, lon: e.target.value } })}
                      placeholder="Lon −122.375"
                      inputMode="decimal"
                      style={{
                        flex: 1, minWidth: 0, background: 'var(--bg-card-2)', border: 'none', borderRadius: 8,
                        padding: '7px 10px', color: 'var(--text)', fontSize: 16, fontFamily: 'monospace', outline: 'none', boxSizing: 'border-box',
                      }}
                    />
                    <button
                      onClick={() => createUserWpt(row.id, row.text, row.creating.lat, row.creating.lon)}
                      style={{
                        background: 'var(--text)', color: 'var(--bg)', border: 'none', borderRadius: 8,
                        padding: '7px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', flexShrink: 0,
                      }}>
                      Save
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Three jobs, one button, decided by what the route is missing.
            No destination — the map is asking where the flight goes. A
            destination but no waypoints — the map is asking where it detours.
            Waypoints already — a text row, because by then the pilot is
            naming fixes they can see, and the map is a long press away.

            "Has a waypoint yet" counts both places one can live: a typed row,
            and a point picked on the map, which goes straight into the route's
            waypoint list and never becomes a row. */}
        <button
          onClick={hasWaypoint ? addWptRow : pickWaypointOnMap}
          disabled={!hasWaypoint && !dep.trim()}
          style={{
            width: '100%', padding: '7px 0', borderRadius: 9, marginBottom: 8,
            background: 'var(--bg-card-2)',
            color: (!hasWaypoint && !dep.trim()) ? 'var(--text-tertiary)' : 'var(--text-secondary)',
            fontSize: 12, fontWeight: 600, border: 'none',
            cursor: (!hasWaypoint && !dep.trim()) ? 'default' : 'pointer',
          }}>
          {hasWaypoint ? '+ Add waypoint'
            : !dep.trim() ? 'Enter a departure to pick on the map'
            : !dest.trim() ? '📍 Pick destination on the map'
            : '+ Add waypoint from the map'}
        </button>

        <button
          onClick={() => calcRoute()}
          disabled={routeLoading || !dep.trim() || !dest.trim()}
          style={{
            width: '100%', padding: '9px 0', borderRadius: 9,
            background: dep.trim() && dest.trim() && !routeLoading ? 'var(--text)' : 'var(--bg-card-2)',
            color: dep.trim() && dest.trim() && !routeLoading ? 'var(--bg)' : 'var(--text-tertiary)',
            fontSize: 13, fontWeight: 600, cursor: dep.trim() && dest.trim() ? 'pointer' : 'default',
            transition: 'all 0.15s',
          }}>
          {routeLoading ? 'Calculating…' : 'Calculate Route'}
        </button>

        {routeError && <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 8 }}>{routeError}</div>}

        {pickDest && createPortal(
          <PickDestinationMap
            depPos={pickDest.pos}
            depIdent={pickDest.ident}
            onClose={() => setPickDest(null)}
            onPick={commitDestination} />,
          document.body)}

        {/* Route result */}
        {route && (
          <div style={{ marginTop: 10, background: 'var(--bg-card-2)', borderRadius: 10, padding: '10px 12px' }}>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 8 }}>
              {route.depName} → {route.destName}
            </div>
            {route.wpts?.length > 0 && (
              <div style={{ fontSize: 11, fontFamily: 'monospace', fontWeight: 700, letterSpacing: '0.5px', color: 'var(--text-secondary)', marginBottom: 8, overflowX: 'auto', whiteSpace: 'nowrap' }}>
                {(route.atsTokens ?? [route.dep, ...route.wpts.map(w => w.name), route.dest]).join(' → ')}
              </div>
            )}
            {route.airwayNotes?.length > 0 && (
              <div style={{ fontSize: 11, color: '#64a8ff', fontWeight: 600, marginBottom: 8 }}>
                {route.airwayNotes.map(n => `${n.awy} · MEA up to ${n.mea.toLocaleString()} ft`).join('   ')}
              </div>
            )}
            {/* What the procedure expansion could not draw. The initial legs of
                a departure are often flown on a heading until an altitude or
                until ATC turns you — where those go depends on the day, so
                there is no line for them and the count says so rather than the
                map implying a path that was never published. */}
            {route.procedureNotes?.length > 0 && (
              <div style={{ fontSize: 10.5, color: 'var(--warn)', lineHeight: 1.45, marginBottom: 8 }}>
                {route.procedureNotes.map(n => (
                  <div key={n.proc}>
                    {n.proc} · {n.t}
                    {n.transition ? ` via ${n.transition}` : ''}
                    {/* The runway-specific segment is where a departure's
                        heading and vector legs live, and which one applies
                        isn't known until the runway is — so it is never drawn,
                        and that is said plainly rather than left to be
                        inferred from a line that starts in mid-air. */}
                    {n.runway && ` — ${n.t === 'SID' ? 'begins' : 'ends'} with a runway-specific segment that is not drawn; fly the chart for it`}
                    {n.undrawable > 0 && ` — ${n.undrawable} further ${n.undrawable > 1 ? 'legs are' : 'leg is'} flown on a heading or vector`}
                    {n.partial && ` — rejoins beyond the portion published for this routing; fly the chart`}
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
              {[
                { label: 'Distance',    val: `${route.distNm} NM` },
                { label: 'True Course', val: `${route.tc}°` },
                { label: 'Mag Var',     val: `${parseFloat(route.magVar) >= 0 ? '+' : ''}${route.magVar}°` },
              ].map(r => (
                <div key={r.label} style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', fontFamily: 'monospace' }}>{r.val}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.3px' }}>{r.label}</div>
                </div>
              ))}
            </div>
            <div style={{
              marginTop: 10, padding: '7px 10px', borderRadius: 8,
              background: 'var(--bg-card)', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Magnetic Course</span>
              <span style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)', fontFamily: 'monospace' }}>{route.mc}°</span>
            </div>
          </div>
        )}

        {/* ── Route map ── */}
        {route?.depPos && route?.destPos && (
          <div style={{ marginTop: 10 }}>

            {/* Layer toggles — every chart is offered whatever the flight
                rules. A VFR pilot still wants the enroute chart to see airways,
                MEAs and the airspace structure, and hiding it made the map
                depend on a setting that has nothing to do with what you can
                look at. The rules decide which layer opens by default, not
                which ones exist. */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
              {[
                { id: 'sectional', label: 'Sectional' },
                { id: 'ifrlo',     label: 'IFR Low' },
                { id: 'ifrhi',     label: 'IFR High' },
                { id: 'airspace',  label: 'Airspace' },
                { id: 'tfr',       label: tfrLoading ? 'TFR…' : 'TFR' },
              ].map(l => (
                <button key={l.id} onClick={() => toggleLayer(l.id)} style={{
                  padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                  cursor: 'pointer', transition: 'all 0.15s',
                  background: layers[l.id] ? 'var(--text)' : 'var(--bg-card-2)',
                  color:      layers[l.id] ? 'var(--bg)' : 'var(--text-secondary)',
                  border: `0.5px solid ${layers[l.id] ? 'var(--text)' : 'var(--border)'}`,
                }}>{l.label}</button>
              ))}
            </div>

            {layers.tfr && tfrLoading && (
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 6 }}>Loading TFRs…</div>
            )}
            {layers.tfr && !tfrLoading && tfrData !== null && (
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 6, display: 'flex', justifyContent: 'space-between' }}>
                <span>{tfrData.length === 0 ? 'FAA server unreachable' : `${tfrData.length} TFRs loaded — open map to view`}</span>
                <a href="https://tfr.faa.gov/tfr2/list.html" target="_blank" rel="noreferrer"
                  style={{ color: 'var(--accent)', textDecoration: 'none' }}>FAA Map ↗</a>
              </div>
            )}

            {/* Map — inline + fullscreen modal */}
            {(() => {
              const mapCenter = [
                (route.depPos[0] + route.destPos[0]) / 2,
                (route.depPos[1] + route.destPos[1]) / 2,
              ]
              // Only the nearest handful get markers; the full corridor list
              // stays in the Aerodromes card. Ordered by cross-track distance
              // already, so this is the closest twelve.
              const nearest = (aeroInfo?.status === 'ok' ? aeroInfo.fields : []).slice(0, 12)
              // Whichever field is open is always marked, even when it came
              // from further down the list than the twelve drawn by default —
              // an open popup describing an airport with nothing on the map is
              // the one case that must not happen.
              const markedFields = openField && !nearest.some(f => f.ident === openField.ident)
                ? [...nearest, openField]
                : nearest
              const mapLayerProps = { layers, openaipKey, tfrData, detectedSUAPolys, waypoints, aerodromes: markedFields, onAerodrome: openAerodrome, openFieldIdent: openField?.ident ?? null,
                peak: terrainInfo?.status === 'ok' && terrainInfo.atLat != null
                  ? { lat: terrainInfo.atLat, lon: terrainInfo.atLon } : null,
                onPeak: openMountains, peakFocused, pickMode, refitNonce, onDrop: openDropPicker, onDragInsert, onWaypointDrop, moveWaypoint, removeWaypoint, depPos: route.depPos, destPos: route.destPos }

              return (<>
                {/* Inline map */}
                <div style={{ borderRadius: 10, overflow: 'hidden', height: 240, position: 'relative', cursor: 'pointer' }}
                  onClick={() => { setMapFlyTarget(null); setMapClear(false); setMapFS(true) }}>
                  <MapContainer center={route.depPos} zoom={10}
                    style={{ height: '100%', width: '100%' }}
                    zoomControl={false} attributionControl={false}
                    dragging={false} scrollWheelZoom={false} doubleClickZoom={false} touchZoom={false}>
                    <MapLayers fit={true} fitOnce={false} {...mapLayerProps} />
                    <MapFlyTo target={mapFlyTarget} instant={true} />
                  </MapContainer>
                  {/* Expand hint */}
                  <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 999,
                    background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)',
                    borderRadius: 6, padding: '4px 7px', pointerEvents: 'none' }}>
                    <span style={{ fontSize: 13, color: '#fff' }}>⤢</span>
                  </div>
                  <AirportLabels dep={dep} dest={dest} depPos={route.depPos} destPos={route.destPos}
                    onFlyTo={pos => setMapFlyTarget({ lat: pos[0], lon: pos[1], zoom: 10, _t: Date.now() })} />
                </div>

                {/* Fullscreen modal */}
                {/* Portal to <body>: the tab track above has a CSS transform,
                    which turns position:fixed into "fill the transformed
                    ancestor" — a 5-pane-wide track — so the map rendered on a
                    huge offscreen canvas and opened misframed. */}
                {mapFullscreen && createPortal((() => {
                  const TERRAIN_DATA = {
                    water:     { label: 'Water',         items: ['Life jacket / flotation device aboard','Glide range reaches shore or vessel','Survival equipment for water temp','Filed flight plan with overwater leg'] },
                    mountains: { label: 'Mountains',     items: ['Terrain clearance — 1,000 ft above highest within 5 NM','Escape route identified for each leg','Turbulence / downdraft margins planned','Density altitude checked at cruise level'] },
                    airspace:  { label: 'Controlled Airspace', items: ['Class B — explicit clearance required: "cleared into the Class B"','Class C — two-way radio established (ATC uses your callsign)','Class D — two-way radio before entering the surface area','Mode C transponder within 30 NM of a Class B primary airport','Check the airspace floor against your planned altitude'] },
                    aero:      { label: 'Aerodromes',    items: ['Cross at min 500 ft above circuit altitude','Monitor CTAF / MF frequency','Note traffic pattern direction'] },
                    oxygen:    { label: 'Oxygen',        items: ['Above 10,000 ft MSL >30 min: O₂ required (crew)','Above 12,500 ft MSL: O₂ required','Passengers: O₂ available above 10,000 ft'] },
                    parks:     { label: 'Nat. Park',     items: ['Check NPS overflight rules — many parks have voluntary/mandatory altitude corridors','Noise-sensitive wildlife areas may have seasonal restrictions','Review park-specific SFAR or LOA if applicable'] },
                    sua:       { label: 'Spec. Use Airspace', items: ['Verify SUA active status via NOTAM / 1800wxbrief','MOA — contact controlling agency for advisories','Restricted / Prohibited — do not enter without clearance','Alert area — extra vigilance required'] },
                  }
                  const REFS = [
                    { label: 'FAA NOTAM Search', sub: 'Official FAA NOTAM system',          url: 'https://notams.aim.faa.gov/notamSearch/' },
                    { label: 'FAA TFR Map',       sub: 'Active TFRs plotted on a map',       url: 'https://tfr.faa.gov/tfr2/list.html' },
                    { label: '1800wxbrief.com',   sub: 'Leidos — full preflight briefing',   url: 'https://www.1800wxbrief.com' },
                  ]
                  const TFR_LEGEND = [
                    { label: 'Security / VIP', color: '#FF3B30' },
                    { label: 'Hazard',         color: '#FF9500' },
                    { label: 'Air Show',       color: '#5AC8FA' },
                    { label: 'Space Ops',      color: '#AF52DE' },
                    { label: 'UAS',            color: '#FFD60A' },
                  ]
                  const tfrCounts = {}
                  if (tfrData) {
                    tfrData.forEach(t => {
                      const type = (t.type || '').toUpperCase()
                      const key = type.includes('HAZARD') || type.includes('WILDFIRE') ? 'Hazard'
                        : type.includes('AIR SHOW') || type.includes('SPORT') ? 'Air Show'
                        : type.includes('SPACE') ? 'Space Ops'
                        : type.includes('UAS') || type.includes('GATHERING') ? 'UAS'
                        : 'Security / VIP'
                      tfrCounts[key] = (tfrCounts[key] || 0) + 1
                    })
                  }

                  return (
                    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: '#e8e0d8' }}>
                      {/* Map — full height */}
                      <div style={{ position: 'absolute', inset: 0, background: '#e8e0d8' }}>
                        <MapContainer center={mapCenter} zoom={7}
                          ref={setFsMap}
                          style={{ height: '100%', width: '100%' }}
                          zoomAnimationThreshold={10}
                          zoomControl={false} attributionControl={false}>
                          {/* Leaflet's own zoom control is replaced by
                              MapControlStack, which puts close and zoom in one
                              group — see the note on that component. */}
                          <MapControlStack onClose={() => setMapFS(false)} />
                          <MapInvalidator />
                          <MapLayers fit={true} {...mapLayerProps} />
                          <MapFlyTo target={mapFlyTarget} />
                        </MapContainer>
                      </div>

                      {/* What to do with a point just dropped on the map */}
                      <DropPicker
                        key={dropPoint ? `${dropPoint.lat.toFixed(4)},${dropPoint.lon.toFixed(4)}` : 'none'}
                        point={dropPoint}
                        mode={dropPoint?.moveIndex != null ? 'move' : 'insert'}
                        canAppend={waypoints.length >= 2}
                        onChoose={commitDrop}
                        onCancel={cancelDrop} />

                      {/* A field along the route, tapped from the map or the
                          aerodromes list */}
                      <AerodromePopup
                        key={openField?.ident ?? 'none'}
                        field={openField}
                        onClose={() => { setOpenField(null); setAwayFromRoute(false); restoreView() }}
                        onSetAlternate={setAsAlternate}
                        onDivert={divertTo} />

                      {/* The way back. Flying to a field 800 NM along the route
                          leaves the route off-screen, and the fullscreen map
                          deliberately never re-fits on its own — the camera
                          belongs to the pilot — so returning is offered rather
                          than done for them. */}
                      {awayFromRoute && !openField && !mapClear && (
                        <button onClick={backToRoute} style={{
                          position: 'absolute', left: '50%', transform: 'translateX(-50%)',
                          bottom: 'calc(env(safe-area-inset-bottom, 0px) + 22px)', zIndex: 10025,
                          background: 'rgba(10,10,10,0.82)', backdropFilter: 'blur(12px)',
                          border: '0.5px solid rgba(255,255,255,0.2)', borderRadius: 20,
                          color: '#fff', fontSize: 12, fontWeight: 700, letterSpacing: '0.3px',
                          padding: '9px 16px', cursor: 'pointer', whiteSpace: 'nowrap',
                        }}>← Back to route</button>
                      )}

                      {/* Route edit hint — fades after 4s */}
                      {/* Pick mode says what the map is waiting for. It
                          replaces the ordinary hint rather than stacking on
                          it — two banners competing for the same strip is
                          worse than either. */}
                      {pickMode && !dropPoint && !mapClear && (
                        <div style={{
                          position: 'absolute', bottom: 280, left: '50%', transform: 'translateX(-50%)',
                          zIndex: 10002, pointerEvents: 'none',
                          background: 'rgba(10,132,255,0.92)', backdropFilter: 'blur(10px)',
                          borderRadius: 20, padding: '7px 14px', maxWidth: '86%',
                          fontSize: 11.5, fontWeight: 600, color: '#fff', whiteSpace: 'nowrap',
                        }}>
                          Tap the map to place your waypoint
                        </div>
                      )}
                      {!pickMode && !dropPoint && !openField && !mapClear && <RouteHint />}

                      {/* Tier-2 disclosure — only when THIS route leaves the
                          regions we hold current data for, since that's when
                          the pilot is actually looking at the 2012 reference
                          airways. */}
                      {(layers.ifrlo || layers.ifrhi) && routeLeavesTier1 && !mapClear && (
                        <div style={{
                          position: 'absolute', left: 12, top: 'calc(env(safe-area-inset-top, 0px) + 64px)',
                          zIndex: 10002, pointerEvents: 'none',
                          background: 'rgba(255,255,255,0.92)', border: '0.5px solid rgba(0,0,0,0.15)',
                          borderRadius: 7, padding: '5px 9px', maxWidth: 235,
                          fontSize: 9.5, lineHeight: 1.35, color: '#3d4a5c', fontWeight: 600,
                        }}>
                          Airways outside US · Mexico · Central America are a 2012 reference —
                          orientation only, verify against current charts
                        </div>
                      )}

                      {/* Off-airport endpoint warning — informative, never blocking */}
                      {endpointWarning && !mapClear && (
                        <div style={{
                          position: 'absolute', top: 'calc(env(safe-area-inset-top, 0px) + 64px)',
                          left: '50%', transform: 'translateX(-50%)', zIndex: 10003,
                          background: 'rgba(255,159,10,0.95)', color: '#1a1200',
                          borderRadius: 20, padding: '8px 16px', maxWidth: '86%',
                          fontSize: 12, fontWeight: 700, letterSpacing: '0.2px',
                          boxShadow: '0 4px 16px rgba(0,0,0,0.35)', pointerEvents: 'none',
                          display: 'flex', alignItems: 'center', gap: 7,
                        }}>
                          <span style={{ fontSize: 13 }}>⚠︎</span>
                          <span>{endpointWarning}</span>
                        </div>
                      )}

                      {/* Top bar — the map behind it extends under the status bar for a true
                          full-screen feel, but the controls themselves need the safe-area
                          inset or they'd sit right under (and look cut off by) the status bar */}
                      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10001,
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        gap: 6, padding: '14px 12px',
                        paddingTop: 'calc(14px + env(safe-area-inset-top))',
                        // The scrim exists to keep the chips legible over a
                        // busy chart. With the chips gone it is just a stain
                        // across the top of the map, so it goes too.
                        background: mapClear ? 'none' : 'linear-gradient(to bottom, rgba(0,0,0,0.75) 0%, transparent 100%)',
                        pointerEvents: 'none',
                      }}>
                        {/* Layer toggles. They shrink and wrap rather than
                            running off the right edge of a narrow phone —
                            five chips plus CLOSE is more than 375 px of
                            comfortable width. */}
                        <div style={{
                          display: 'flex', gap: 5, flexWrap: 'wrap', minWidth: 0,
                          opacity: mapClear ? 0 : 1,
                          pointerEvents: mapClear ? 'none' : 'auto',
                          transition: 'opacity 200ms',
                        }}>
                          {[
                            ['sectional','SECT'],
                            ['ifrlo','LO'],
                            ['ifrhi','HI'],
                            ['airspace','ARSP'],
                            ['tfr', tfrLoading ? 'TFR…' : (layers.tfr && tfrData?.length === 0 ? 'TFR ·0' : 'TFR')],
                          ].map(([k,label]) => (
                            <button key={k} onClick={() => toggleLayer(k)} style={{
                              background: layers[k] ? 'rgba(255,255,255,0.95)' : 'rgba(10,10,10,0.75)',
                              backdropFilter: 'blur(12px)',
                              border: layers[k] ? 'none' : '0.5px solid rgba(255,255,255,0.18)',
                              borderRadius: 7, color: layers[k] ? '#000' : 'rgba(255,255,255,0.85)',
                              fontSize: 10.5, fontWeight: 700, letterSpacing: '0.4px',
                              padding: '7px 9px', cursor: 'pointer', flexShrink: 0,
                            }}>{label}</button>
                          ))}
                        </div>
                        {/* Close now lives in MapControlStack, grouped with
                            the zoom buttons on the right. */}
                      </div>

                      {/* Bottom panel */}
                      <div
                        {...cardSwipe}
                        style={{
                        position: 'absolute', bottom: 16, left: 16, right: 16, zIndex: 10001,
                        height: 'auto', minHeight: 210,
                        background: 'rgba(8,8,10,0.92)',
                        backdropFilter: 'blur(28px)',
                        WebkitBackdropFilter: 'blur(28px)',
                        border: '0.5px solid rgba(255,255,255,0.12)',
                        borderRadius: 18,
                        boxShadow: '0 8px 40px rgba(0,0,0,0.55), 0 1px 0 rgba(255,255,255,0.06) inset',
                        display: 'flex', flexDirection: 'column',
                        overflow: 'visible',
                        // Cleared: slide the card down until only the grab bar
                        // clears the bottom edge. Translating rather than
                        // unmounting keeps the card's state — the open picker,
                        // the scrolled route strip — exactly as it was left.
                        transform: mapClear ? `translateY(calc(100% + 16px - ${CARD_PEEK_PX}px))` : 'translateY(0)',
                        transition: 'transform 260ms cubic-bezier(0.32, 0.72, 0, 1)',
                        touchAction: 'pan-x',
                      }}>
                        {/* Grab bar. Doubles as the peek: when the card is
                            cleared this strip is the only part still on
                            screen, so what the pilot swipes up is the same
                            thing they swiped down. */}
                        <div
                          onClick={() => mapClear && setMapClear(false)}
                          style={{
                            height: CARD_PEEK_PX, flexShrink: 0, cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}
                          aria-label={mapClear ? 'Show route panel' : 'Hide route panel'}
                        >
                          <div style={{
                            width: 38, height: 4, borderRadius: 2,
                            background: mapClear ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.22)',
                            transition: 'background 200ms',
                          }} />
                        </div>

                        {/* Route strip */}
                        <div style={{
                          padding: '11px 18px 9px',
                          flexShrink: 0,
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            {/* Route pills — dep, intermediates, dest, in order.
                                One line, scrolls sideways so the stats stay put. */}
                            <div style={{
                              display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1,
                              overflowX: 'auto', overflowY: 'hidden', marginRight: 14,
                              WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none',
                              // fade the last pill out when the row scrolls
                              maskImage: 'linear-gradient(to right, #000 calc(100% - 24px), transparent)',
                              WebkitMaskImage: 'linear-gradient(to right, #000 calc(100% - 24px), transparent)',
                            }}>
                              {(() => {
                                // Map-dropped points have no ident — number them in
                                // route order (WPT 1, WPT 2…) so they can be referred to.
                                let n = 0
                                return waypoints.map(w => ({ w, label: w.name || `WPT ${++n}` }))
                              })().map(({ w, label }, i) => {
                                const isDep = i === 0
                                const isDest = i === waypoints.length - 1
                                const clear = isDep
                                  ? () => { changeDep(''); setDepVal(false); setDepErr(null) }
                                  : isDest
                                  ? () => { changeDest(''); setDestVal(false); setDestErr(null) }
                                  : () => removeWaypoint(i)
                                return (
                                  <div key={w.id} style={{
                                    display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0,
                                    background: 'rgba(255,255,255,0.08)', borderRadius: 7,
                                    padding: '4px 6px 4px 9px',
                                  }}>
                                    <span style={{
                                      fontSize: 14, fontWeight: 800, color: '#fff',
                                      fontFamily: 'monospace', letterSpacing: '1px', lineHeight: 1,
                                    }}>{label}</span>
                                    <button
                                      onClick={clear}
                                      style={{
                                        background: 'none', border: 'none', padding: 3,
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        cursor: 'pointer', color: 'rgba(255,255,255,0.45)',
                                      }}>
                                      <svg width={9} height={9} viewBox="0 0 24 24" fill="none">
                                        <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
                                      </svg>
                                    </button>
                                  </div>
                                )
                              })}
                            </div>
                            {/* Stats */}
                            <div style={{ display: 'flex', gap: 16, flexShrink: 0 }}>
                              {[
                                { val: `${route.distNm} NM`, lbl: 'DIST' },
                                { val: `${route.mc}°`,       lbl: 'MC' },
                              ].map(({ val, lbl }) => (
                                <div key={lbl} style={{ textAlign: 'right' }}>
                                  <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', fontFamily: 'monospace' }}>{val}</div>
                                  <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.6px', marginTop: 1 }}>{lbl}</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>

                        {/* Content — vertical stack, everything fits */}
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'visible', padding: '8px 18px 10px', gap: 0, position: 'relative' }}>

                          {/* ── TFR section ── */}
                          {layers.tfr && tfrData && (() => {
                            const flyToConflict = () => {
                              const tfr = tfrConflicts[0]
                              let lat = tfr.lat, lon = tfr.lon
                              if (!lat && tfr.polygon?.length) {
                                lat = tfr.polygon.reduce((s,p) => s + p[0], 0) / tfr.polygon.length
                                lon = tfr.polygon.reduce((s,p) => s + p[1], 0) / tfr.polygon.length
                              }
                              if (lat && lon) setMapFlyTarget({ lat, lon, zoom: 10, _t: Date.now() })
                            }
                            return (<>
                              {/* Conflict warning — full width, compact single line */}
                              {tfrConflicts.length > 0 && (
                                <div
                                  onClick={flyToConflict}
                                  style={{
                                    background: 'rgba(255,59,48,0.2)', border: '1px solid rgba(255,59,48,0.6)',
                                    borderRadius: 6, padding: '5px 10px', marginBottom: 7,
                                    display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer',
                                    transition: 'background 0.15s',
                                  }}
                                  onMouseEnter={e => e.currentTarget.style.background='rgba(255,59,48,0.30)'}
                                  onMouseLeave={e => e.currentTarget.style.background='rgba(255,59,48,0.2)'}
                                >
                                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#FF3B30" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                                  <span style={{ fontSize: 10, fontWeight: 800, color: '#FF3B30', letterSpacing: '0.3px', flex: 1 }}>ROUTE ENTERS TFR</span>
                                  <span style={{ fontSize: 9, color: 'rgba(255,100,90,0.8)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>
                                    {tfrConflicts.slice(0,3).map(t => t.type || 'TFR').join(' · ')}{tfrConflicts.length > 3 ? ` +${tfrConflicts.length-3}` : ''}
                                  </span>
                                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(255,100,90,0.6)" strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0 }}>
                                    <circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>
                                  </svg>
                                </div>
                              )}
                              {/* TFR count row — label + dots inline, all on one line */}
                              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', rowGap: 4 }}>
                                <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.7px', color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                                  TFR · {tfrData.length}
                                </span>
                                {TFR_LEGEND.map(({ label, color }) => tfrCounts[label] ? (
                                  <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
                                    <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.65)', fontWeight: 500, whiteSpace: 'nowrap' }}>{label}</span>
                                    <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace' }}>{tfrCounts[label]}</span>
                                  </div>
                                ) : null)}
                              </div>
                            </>)
                          })()}

                          {/* Divider between TFR and Overflight */}
                          {layers.tfr && tfrData && detectedTerrain.length > 0 && (
                            <div style={{ height: '0.5px', background: 'rgba(255,255,255,0.07)', margin: '8px 0' }} />
                          )}

                          {/* ── Overflight section ── */}
                          {(detectedTerrain.length > 0 || Object.values(sourceStatus).some(v => v !== 'ok')) && (() => {
                            const chipColor = id =>
                              id === 'parks' ? { bg: 'rgba(52,199,89,0.15)', fg: 'rgba(52,199,89,0.9)', activeBg: 'rgba(52,199,89,0.28)', border: 'rgba(52,199,89,0.4)' }
                              : id === 'sua' ? { bg: 'rgba(255,149,0,0.15)', fg: 'rgba(255,149,0,0.9)', activeBg: 'rgba(255,149,0,0.28)', border: 'rgba(255,149,0,0.4)' }
                              : id === 'airspace' ? { bg: 'rgba(90,200,250,0.15)', fg: 'rgba(90,200,250,0.95)', activeBg: 'rgba(90,200,250,0.28)', border: 'rgba(90,200,250,0.4)' }
                              : { bg: 'rgba(255,255,255,0.08)', fg: 'rgba(255,255,255,0.65)', activeBg: 'rgba(255,255,255,0.16)', border: 'rgba(255,255,255,0.25)' }
                            const subNames = id =>
                              id === 'parks' ? detectedParkNames
                              : id === 'sua' ? detectedSUANames
                              : id === 'airspace' ? (airspaceInfo?.areas ?? []).map(a => a.name)
                              : []
                            return (
                              <div style={{ minWidth: 0, position: 'relative' }}>
                                {/* Label + chips all on one line */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', rowGap: 5 }}>
                                  <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.7px', color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                                    Overflight
                                  </span>
                                  {detectedTerrain.map(id => {
                                    const c = chipColor(id)
                                    const names = subNames(id)
                                    const isActive = activeChip === id
                                    return (
                                      <div key={id} style={{ position: 'relative' }}>
                                        <span
                                          onClick={() => {
                                            // Pinned, not merely active. On a mouse the chip is
                                            // already active by the time the click lands, because
                                            // the pointer entered it first — testing isActive here
                                            // would read every desktop click as "close".
                                            const wasPinned = chipPinned === id
                                            if (wasPinned) { closeChipPanel(id); return }
                                            setChipPinned(id)
                                            setActiveChip(id)
                                            // Mountains is the one chip with a place attached to
                                            // it. Opening the panel and then hunting for the
                                            // coordinate line inside it was two steps for one
                                            // question — "where is it?" — so the tap that opens
                                            // it also flies there, the way tapping a tower goes
                                            // to the field. The fly-to lifts the peak into the
                                            // band above the sheet, so the panel stays readable
                                            // over it.
                                            if (!wasPinned && id === 'mountains') focusPeak()
                                          }}
                                          // Hover previews the panel; it never moves the map,
                                          // which would drag the chart under a passing cursor.
                                          // A pinned chip ignores the pointer leaving.
                                          onMouseEnter={() => setActiveChip(id)}
                                          onMouseLeave={() => { if (chipPinned !== id) setActiveChip(null) }}
                                          style={{
                                            fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 4,
                                            background: isActive ? c.activeBg : c.bg,
                                            color: c.fg,
                                            letterSpacing: '0.2px',
                                            cursor: 'pointer',
                                            border: `0.5px solid ${isActive ? c.border : 'transparent'}`,
                                            transition: 'background 0.15s',
                                            userSelect: 'none',
                                            display: 'inline-flex', alignItems: 'center', gap: 4,
                                            whiteSpace: 'nowrap',
                                          }}>
                                          {TERRAIN_DATA[id]?.label}
                                          {names.length > 0 && <span style={{ opacity: 0.5, fontSize: 8 }}>{names.length}</span>}
                                          <span style={{ opacity: 0.5, fontSize: 9 }}>ⓘ</span>
                                        </span>
                                      </div>
                                    )
                                  })}
                                  {/* What was NOT checked. A failed query and a clear
                                      route used to render identically — nothing — so a
                                      dead service read as "no hazards found". */}
                                  {(() => {
                                    const failed = ['terrain', 'airspace', 'parks', 'sua'].filter(k => sourceStatus[k] === 'unavailable')
                                    const uncovered = ['airspace', 'parks', 'sua'].filter(k => sourceStatus[k] === 'not-covered')
                                    const LABEL = { terrain: 'Terrain', airspace: 'Controlled airspace', parks: 'Parks', sua: 'Special use airspace' }
                                    return (<>
                                      {failed.length > 0 && (
                                        <span style={{
                                          fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 4,
                                          background: 'var(--warn-light)', color: 'var(--warn)',
                                          letterSpacing: '0.2px', display: 'inline-flex', alignItems: 'center', gap: 6,
                                        }}>
                                          {failed.map(k => LABEL[k]).join(' · ')} unavailable — verify manually
                                          <span
                                            onClick={() => setRecheck(n => n + 1)}
                                            style={{ textDecoration: 'underline', cursor: 'pointer', opacity: 0.8 }}>
                                            Recheck
                                          </span>
                                        </span>
                                      )}
                                      {uncovered.length > 0 && (
                                        <span style={{
                                          fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 4,
                                          background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.4)',
                                          letterSpacing: '0.2px', whiteSpace: 'nowrap',
                                        }}>
                                          {uncovered.map(k => LABEL[k]).join(' · ')}: US only — not checked
                                        </span>
                                      )}
                                    </>)
                                  })()}
                                </div>
                              </div>
                            )
                          })()}

                          {/* Chip popup — rendered inside bottom panel, above it */}
                          {activeChip && TERRAIN_DATA[activeChip] && (() => {
                            const c = activeChip === 'parks' ? { accent: 'rgba(52,199,89,0.9)', border: 'rgba(52,199,89,0.25)' }
                              : activeChip === 'sua' ? { accent: 'rgba(255,149,0,0.9)', border: 'rgba(255,149,0,0.25)' }
                              : activeChip === 'airspace' ? { accent: 'rgba(90,200,250,0.95)', border: 'rgba(90,200,250,0.25)' }
                              : { accent: 'rgba(255,255,255,0.7)', border: 'rgba(255,255,255,0.15)' }
                            const names = activeChip === 'parks' ? detectedParkNames : activeChip === 'sua' ? detectedSUANames : []
                            const td = TERRAIN_DATA[activeChip]
                            return (
                              <div
                                onMouseEnter={() => setActiveChip(activeChip)}
                                onMouseLeave={() => { if (!chipPinned) setActiveChip(null) }}
                                style={{
                                  position: 'absolute', bottom: 'calc(100% + 10px)', left: 0, right: 0,
                                  zIndex: 10010,
                                  background: 'rgba(12,12,16,0.97)',
                                  backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
                                  border: `0.5px solid ${c.border}`,
                                  borderRadius: 14,
                                  padding: '14px 16px',
                                  boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
                                  pointerEvents: 'auto',
                                }}>
                                {/* Header */}
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                                  <div style={{ fontSize: 13, fontWeight: 700, color: c.accent, letterSpacing: '0.2px' }}>{td.label}</div>
                                  <span onClick={() => closeChipPanel(activeChip)} style={{ fontSize: 16, color: 'rgba(255,255,255,0.3)', cursor: 'pointer', padding: '0 4px', lineHeight: 1 }}>✕</span>
                                </div>
                                {activeChip === 'sua' && (
                                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginBottom: 10, lineHeight: 1.4 }}>
                                    Your route passes through or crosses the boundary of the following airspaces. Each requires a specific action before flight.
                                  </div>
                                )}

                                {/* Controlled airspace — which classes the track crosses
                                    and their floors/ceilings, marking the ones the planned
                                    cruise sits inside */}
                                {activeChip === 'airspace' && airspaceInfo?.status === 'ok' && airspaceInfo.areas.length > 0 && (
                                  <div style={{ borderRadius: 8, background: 'rgba(255,255,255,0.04)', padding: '9px 11px', marginBottom: 10 }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                                      {airspaceInfo.areas.map(a => {
                                        const col = a.cls === 'B' ? '#FF3B30' : a.cls === 'C' ? '#FF9500'
                                          : a.cls === 'D' ? '#5AC8FA' : 'rgba(255,255,255,0.4)'
                                        return (
                                          <div key={a.cls + a.name} style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                                            <span style={{
                                              fontSize: 10, fontWeight: 800, color: col, fontFamily: 'monospace',
                                              border: `0.5px solid ${col}`, borderRadius: 3, padding: '1px 4px', flexShrink: 0,
                                            }}>{a.cls || '?'}</span>
                                            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                              {a.name}
                                              {a.approx && <span style={{ color: 'rgba(255,255,255,0.3)' }}> · approx</span>}
                                            </span>
                                            <span style={{ fontSize: 10.5, color: a.atCruise ? 'var(--warn)' : 'rgba(255,255,255,0.5)', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                                              {a.upperFt == null
                                                ? 'limits n/pub'
                                                : `${a.lowerFt === 0 ? 'SFC' : a.lowerFt?.toLocaleString()}–${a.upperFt.toLocaleString()}${a.ref === 'AGL' ? ' AGL' : ' ft'}`}
                                            </span>
                                          </div>
                                        )
                                      })}
                                    </div>
                                    {airspaceInfo.areas.some(a => a.atCruise) && (
                                      <div style={{ fontSize: 10.5, color: 'var(--warn)', marginTop: 7, lineHeight: 1.45 }}>
                                        Amber limits contain your planned altitude — entry needs a clearance (B) or
                                        established two-way radio (C/D).
                                      </div>
                                    )}
                                    <div style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.25)', marginTop: 6, lineHeight: 1.4 }}>
                                      {(airspaceInfo.sources ?? []).includes('CENAMER')
                                        ? 'FAA class airspace + COCESNA eAIP ENR 2.1 · "approx" means the eAIP describes that boundary by naming a national border rather than publishing coordinates. '
                                        : 'FAA class airspace · '}
                                      Every area the ground track crosses is listed, including ones below cruise — you
                                      still transit them on climb and descent. Class E excluded.
                                    </div>
                                  </div>
                                )}

                                {/* Aerodromes — which fields and how far off track, so
                                    "monitor CTAF" has a frequency to look up */}
                                {activeChip === 'aero' && aeroInfo?.status === 'ok' && aeroInfo.fields.length > 0 && (
                                  <div style={{ borderRadius: 8, background: 'rgba(255,255,255,0.04)', padding: '9px 11px', marginBottom: 10 }}>
                                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.4px', marginBottom: 6 }}>
                                      {aeroInfo.count} FIELD{aeroInfo.count === 1 ? '' : 'S'} WITHIN {aeroInfo.withinNm} NM OF TRACK
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                      {aeroInfo.fields.map(f => (
                                        <div key={f.ident + f.alongNm}
                                          onClick={() => openAerodrome(f)}
                                          style={{ display: 'flex', alignItems: 'baseline', gap: 8, cursor: 'pointer',
                                            padding: '2px 4px', margin: '0 -4px', borderRadius: 6 }}>
                                          <span style={{ fontSize: 12, fontWeight: 700, color: '#fff', fontFamily: 'monospace', letterSpacing: '0.5px', minWidth: 52 }}>
                                            {f.ident}
                                          </span>
                                          <span style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.45)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {f.name || ''}
                                          </span>
                                          <span style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.6)', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                                            {f.distNm} NM · {f.alongNm} NM in
                                          </span>
                                          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>›</span>
                                        </div>
                                      ))}
                                    </div>
                                    {aeroInfo.count > aeroInfo.fields.length && (
                                      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginTop: 6 }}>
                                        + {aeroInfo.count - aeroInfo.fields.length} more, smaller or farther off track
                                      </div>
                                    )}
                                    <div style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.25)', marginTop: 6, lineHeight: 1.4 }}>
                                      OurAirports · departure and destination excluded. Verify frequencies on the chart.
                                    </div>
                                  </div>
                                )}

                                {/* Water — distance over water and how far from shore
                                    it gets, which is what picks life jackets vs. a raft */}
                                {activeChip === 'water' && waterInfo?.status === 'ok' && (
                                  <div style={{ borderRadius: 8, background: 'rgba(255,255,255,0.04)', padding: '9px 11px', marginBottom: 10 }}>
                                    <div style={{ display: 'flex', gap: 14 }}>
                                      {[
                                        { v: `${waterInfo.overwaterNm} NM`,     l: `OVER WATER · ${waterInfo.pctOverwater}%` },
                                        { v: `${waterInfo.longestLegNm} NM`,    l: 'LONGEST CROSSING' },
                                        { v: `${waterInfo.maxFromShoreNm} NM`,  l: 'MAX FROM SHORE' },
                                      ].map(({ v, l }) => (
                                        <div key={l} style={{ flex: 1, minWidth: 0 }}>
                                          <div style={{ fontSize: 14, fontWeight: 800, color: '#fff', fontFamily: 'monospace' }}>{v}</div>
                                          <div style={{ fontSize: 8.5, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.4px', marginTop: 2 }}>{l}</div>
                                        </div>
                                      ))}
                                    </div>
                                    {waterInfo.atDistNm != null && (
                                      <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.45)', marginTop: 6, lineHeight: 1.45 }}>
                                        Farthest from land at {waterInfo.atDistNm} NM along route
                                      </div>
                                    )}
                                    <div style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.25)', marginTop: 6, lineHeight: 1.4 }}>
                                      Natural Earth coastline · {waterInfo.spacingNm} NM sampling, ~1 NM shoreline resolution.
                                      Crossings shorter than the sampling interval can be missed.
                                    </div>
                                  </div>
                                )}

                                {/* Mountains — the measurement behind the chip, so the
                                    clearance item below is checkable against a number */}
                                {activeChip === 'mountains' && terrainInfo?.status === 'ok' && (
                                  <div
                                    onClick={terrainInfo.atLat != null ? focusPeak : undefined}
                                    style={{ borderRadius: 8, background: 'rgba(255,255,255,0.04)', padding: '9px 11px', marginBottom: 10,
                                      cursor: terrainInfo.atLat != null ? 'pointer' : 'default' }}>
                                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
                                      <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.4px' }}>
                                        HIGHEST WITHIN {terrainInfo.corridorNm} NM
                                      </span>
                                      <span style={{ fontSize: 15, fontWeight: 800, color: '#fff', fontFamily: 'monospace' }}>
                                        {terrainInfo.maxFt.toLocaleString()} ft
                                      </span>
                                    </div>
                                    <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.45)', marginTop: 4, lineHeight: 1.45 }}>
                                      {terrainInfo.atDistNm} NM along route
                                      {terrainInfo.atLat != null && ` · ${fmtAvCoord(terrainInfo.atLat, terrainInfo.atLon)}`}
                                      {terrainInfo.atLat != null && (
                                        <span style={{ color: 'rgba(255,255,255,0.3)' }}> · tap to show on map ›</span>
                                      )}
                                    </div>
                                    {terrainInfo.clearanceFt != null && (
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 7 }}>
                                        <div style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                                          background: terrainInfo.meetsMin ? 'var(--ok)' : 'var(--danger)' }} />
                                        <span style={{ fontSize: 11.5, fontWeight: 600, color: terrainInfo.meetsMin ? 'var(--ok)' : 'var(--danger)' }}>
                                          {terrainInfo.clearanceFt >= 0
                                            ? `${terrainInfo.clearanceFt.toLocaleString()} ft clearance at ${selectedAlt.toLocaleString()} ft`
                                            : `${Math.abs(terrainInfo.clearanceFt).toLocaleString()} ft BELOW terrain at ${selectedAlt.toLocaleString()} ft`}
                                        </span>
                                      </div>
                                    )}
                                    <div style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.25)', marginTop: 6, lineHeight: 1.4 }}>
                                      Copernicus DEM · {terrainInfo.pointCount} points, {terrainInfo.spacingNm} NM
                                      across the corridor{terrainInfo.finestNm && terrainInfo.finestNm < terrainInfo.spacingNm
                                        ? ` and ${terrainInfo.finestNm} NM around the peak` : ''}.
                                      Terrain only — obstacles are not included, and a summit between samples can still
                                      read low. Cross-check the chart's MEF.
                                    </div>
                                  </div>
                                )}

                                {/* SUA — smart breakdown by airspace type */}
                                {activeChip === 'sua' && names.length > 0 ? (() => {
                                  const SUA_TYPES = [
                                    { key: 'P',   match: n => /^P[-\s]/i.test(n),   label: 'Prohibited Area',         color: '#FF3B30', desc: 'Flight strictly prohibited. Do not enter under any circumstances.', action: 'Do not enter — no exceptions' },
                                    { key: 'R',   match: n => /^R[-\s]/i.test(n),   label: 'Restricted Area',         color: '#FF9500', desc: 'Hazardous activities (live fire, missiles). Entry requires ATC clearance — check NOTAM for active times.', action: 'Obtain clearance or reroute' },
                                    { key: 'MOA', match: n => /MOA/i.test(n),        label: 'Military Ops Area (MOA)', color: '#FFD60A', desc: 'High-speed military training. VFR flight is legal but contact controlling agency (usually Center) for advisories.', action: 'Call ATC Center for advisory' },
                                    { key: 'W',   match: n => /^W[-\s]/i.test(n),   label: 'Warning Area',            color: '#5AC8FA', desc: 'Offshore international airspace with hazardous activity. Similar to Restricted but no clearance authority — avoid or proceed with extreme caution.', action: 'Avoid or monitor advisory' },
                                    { key: 'A',   match: n => /^A[-\s]/i.test(n),   label: 'Alert Area',              color: '#AF52DE', desc: 'Unusually high volume of flight training or unusual aerial activity. Pilots must be especially vigilant.', action: 'Extra vigilance — see and avoid' },
                                  ]
                                  const grouped = SUA_TYPES.map(t => ({
                                    ...t,
                                    names: names.filter(t.match),
                                  })).filter(t => t.names.length > 0)

                                  return (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                      {grouped.map(g => (
                                        <div key={g.key} style={{ borderRadius: 8, background: 'rgba(255,255,255,0.04)', padding: '9px 11px' }}>
                                          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 }}>
                                            <div style={{ width: 8, height: 8, borderRadius: '50%', background: g.color, flexShrink: 0 }} />
                                            <span style={{ fontSize: 11, fontWeight: 700, color: g.color, letterSpacing: '0.3px' }}>{g.label}</span>
                                          </div>
                                          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginBottom: 5, fontFamily: 'monospace', lineHeight: 1.4 }}>
                                            {g.names.join('  ·  ')}
                                          </div>
                                          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)', lineHeight: 1.45, marginBottom: 5 }}>{g.desc}</div>
                                          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                            <div style={{ width: 3, height: 3, borderRadius: '50%', background: g.color, flexShrink: 0 }} />
                                            <span style={{ fontSize: 10.5, fontWeight: 600, color: g.color }}>{g.action}</span>
                                          </div>
                                        </div>
                                      ))}
                                      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', textAlign: 'center', marginTop: 2 }}>
                                        Always verify active status via NOTAM · 1800wxbrief
                                      </div>
                                    </div>
                                  )
                                })() : (
                                  /* Generic checklist for non-SUA chips */
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    {td.items.map((item, i) => (
                                      <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                                        <div style={{ width: 18, height: 18, borderRadius: 4, border: `1px solid ${c.border}`, flexShrink: 0, marginTop: 1,
                                          display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                          <div style={{ width: 6, height: 6, borderRadius: '50%', background: c.accent, opacity: 0.5 }} />
                                        </div>
                                        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.75)', lineHeight: 1.5 }}>{item}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )
                          })()}

                          {/* References button — pushed to right */}
                          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'flex-end', flexShrink: 0 }}>
                            <button onClick={() => setShowRefs(r => !r)} style={{
                              background: showRefs ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.07)',
                              border: '0.5px solid rgba(255,255,255,0.15)',
                              borderRadius: 8, color: 'rgba(255,255,255,0.7)',
                              fontSize: 11, fontWeight: 700, letterSpacing: '0.5px',
                              padding: '8px 13px', cursor: 'pointer', whiteSpace: 'nowrap',
                            }}>REFS ↗</button>
                          </div>
                        </div>
                      </div>

                      {/* References sheet */}
                      {showRefs && !mapClear && (
                        <div style={{
                          position: 'absolute', bottom: 242, left: 'auto', right: 16, zIndex: 10002,
                          width: 260,
                          background: 'rgba(14,14,18,0.97)', backdropFilter: 'blur(20px)',
                          border: '0.5px solid rgba(255,255,255,0.1)', borderRadius: 12,
                          overflow: 'hidden',
                        }}>
                          <div style={{ padding: '11px 15px 8px', borderBottom: '0.5px solid rgba(255,255,255,0.07)' }}>
                            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.7px', color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase' }}>NOTAM &amp; TFR References</span>
                          </div>
                          {REFS.map((r, i) => (
                            <a key={r.url} href={r.url} target="_blank" rel="noreferrer" style={{
                              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                              padding: '11px 15px',
                              borderTop: i > 0 ? '0.5px solid rgba(255,255,255,0.06)' : 'none',
                              textDecoration: 'none',
                            }}>
                              <div>
                                <div style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>{r.label}</div>
                                <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>{r.sub}</div>
                              </div>
                              <svg width={12} height={12} viewBox="0 0 24 24" fill="none" style={{ color: 'rgba(255,255,255,0.3)', flexShrink: 0, marginLeft: 10 }}>
                                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                                <polyline points="15 3 21 3 21 9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                                <line x1="10" y1="14" x2="21" y2="3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                              </svg>
                            </a>
                          ))}
                          <div style={{ padding: '8px 15px 10px', borderTop: '0.5px solid rgba(255,255,255,0.06)' }}>
                            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.22)', fontStyle: 'italic' }}>NOTAMs change daily — always check day of flight.</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })(), document.body)}
              </>)
            })()}
          </div>
        )}

        {/* ── Altitude calculator ── */}
        {altitudes && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, marginTop: 12 }}>
            <span style={{
              fontSize: 12, fontWeight: 700, color: 'var(--text)',
              background: 'var(--bg-card-2)', borderRadius: 20, padding: '4px 10px', whiteSpace: 'nowrap',
            }}>
              {isEast ? '↗ Eastbound' : '↙ Westbound'}
            </span>
            {/* The forecast has to be asked about a time. Left empty it answers
                for now, which is the wrong question for tomorrow's flight. */}
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
              <span style={{ fontSize: 10, color: 'var(--text-tertiary)', letterSpacing: '0.3px' }}>ETD</span>
              <input
                type="datetime-local"
                step="60"
                value={etd}
                // Tapping the field should open the OS picker, not drop a
                // caret into a text mask. showPicker throws when it is not
                // driven by a real gesture, which is exactly when we do not
                // need it — let the browser do its default thing instead.
                onClick={e => { try { e.currentTarget.showPicker?.() } catch { /* focus is enough */ } }}
                onFocus={e => { try { e.currentTarget.showPicker?.() } catch { /* focus is enough */ } }}
                onChange={e => {
                  setEtd(e.target.value)
                  setEtdPinned(true)
                  get('settings', 'route').then(r => {
                    if (r) put('settings', { ...r, etd: e.target.value }).catch(() => {})
                  })
                }}
                style={{
                  background: 'var(--bg-card-2)', border: '0.5px solid var(--border)',
                  borderRadius: 7, padding: '4px 7px', color: 'var(--text)',
                  fontSize: 11, outline: 'none', colorScheme: 'inherit',
                }} />
            </label>
          </div>
        )}

        {altitudes && (
          <>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 8 }}>
              {isIFR
                ? (isEast ? 'Odd thousands (IFR)' : 'Even thousands (IFR)')
                : (isEast ? 'Odd thousands + 500 ft' : 'Even thousands + 500 ft')}
            </div>
            <AltitudeAdvice advice={advice} busy={adviceBusy} selectedAlt={selectedAlt} acPerf={acPerf}
              brief={brief} briefBusy={briefBusy}
              onBrief={() => {
                setBriefBusy(true)
                fetchBriefing(advice, {
                  dep, dest, flightRules, etd,
                  aircraftName: aircraft?.fullName || aircraft?.label,
                }).then(b => { setBrief(b); setBriefBusy(false) })
              }}
              onPick={alt => {
                setSelectedAlt(alt)
                get('settings', 'route').then(r => {
                  if (r) put('settings', { ...r, cruiseAlt: alt }).catch(() => {})
                })
              }} />
            {/* minmax(0, 1fr) rather than 1fr: a grid column's automatic
                minimum is its content's min-content width, so one long gate
                reason ("Not worth it on 95 NM — climb and descent use up the
                leg") widened its column until the second column ran off the
                side of the screen and took half the altitudes with it. */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6 }}>
              {altitudes.map(alt => {
                const selected = selectedAlt === alt
                const belowMEA = isIFR && routeMaxMEA != null && alt < routeMaxMEA
                const cand = advice?.candidates?.find(c => c.altFt === alt)
                const gate = advice?.rejected?.find(r => r.altFt === alt)
                const best = advice?.recommended?.altFt === alt
                return (
                  <button key={alt} title={gate ? gate.gates.map(g => g.label).join(' · ') : undefined}
                    onClick={() => {
                    const next = selected ? null : alt
                    setSelectedAlt(next)
                    get('settings', 'route').then(r => {
                      if (r) put('settings', { ...r, cruiseAlt: next }).catch(() => {})
                    })
                  }} style={{
                    background: selected ? 'var(--text)' : 'var(--bg-card-2)',
                    border: `0.5px solid ${selected ? 'var(--text)'
                      : best ? 'var(--ok)'
                      : belowMEA ? 'rgba(255,159,10,0.5)' : 'var(--border)'}`,
                    borderRadius: 8, padding: '7px 8px', minWidth: 0,
                    fontSize: 13, fontWeight: 600,
                    color: selected ? 'var(--bg)' : gate ? 'var(--text-tertiary)'
                      : belowMEA ? 'var(--warn)' : 'var(--text)',
                    // A gated altitude stays tappable — the pilot is the final
                    // authority — but reads as discouraged and says why on hold.
                    opacity: gate ? 0.45 : 1,
                    cursor: 'pointer', transition: 'all 0.18s', textAlign: 'center',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
                  }}>
                    <span>{fmtAlt(alt)}{belowMEA ? ' ⚠' : ''}{best ? ' ★' : ''}</span>
                    {(cand || gate) && (
                      <span style={{
                        fontSize: 9, fontWeight: 500,
                        color: selected ? 'var(--bg)' : gate ? 'var(--text-tertiary)' : 'var(--text-secondary)',
                        opacity: 0.85, width: '100%', lineHeight: 1.35,
                        // A gate reason is the whole point of a gated
                        // altitude, so it wraps to two lines and is readable
                        // rather than being cut off mid-word on one.
                        display: '-webkit-box', WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical', overflow: 'hidden',
                        overflowWrap: 'anywhere',
                      }}>
                        {gate ? gate.gates[0].label : `${cand.econ ? Math.round(cand.econ.blockMin) + ' min · ' : ''}${cand.score}`}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
            {advice?.crossSection && (
              <CrossSection data={advice.crossSection} dep={dep} dest={dest} chosenAltFt={selectedAlt} />
            )}
            {isIFR && routeMaxMEA != null && (
              <div style={{ marginTop: 8, fontSize: 11, color: 'var(--warn)', lineHeight: 1.5 }}>
                ⚠ Altitudes below {routeMaxMEA.toLocaleString()} ft are under the highest MEA on
                your airway routing — usable only where segment MEAs allow.
              </div>
            )}
            {selectedAlt && (
              <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 9, background: 'var(--bg-card-2)' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                  Planned: {selectedAlt.toLocaleString()} ft MSL
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
                  {direction} · {isEast ? 'Odd' : 'Even'} thousands{isIFR ? '' : ' + 500 ft'} · {isIFR ? '§91.179' : '§91.159'}
                </div>
                {isIFR && routeMaxMEA != null && selectedAlt < routeMaxMEA && (
                  <div style={{ fontSize: 11, color: 'var(--warn)', fontWeight: 600, marginTop: 4 }}>
                    ⚠ Below the highest MEA on this routing ({routeMaxMEA.toLocaleString()} ft)
                  </div>
                )}
              </div>
            )}
            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
              Above 18,000 ft MSL is Class A airspace, IFR only.
            </div>

            <a href={isIFR
                ? 'https://www.ecfr.gov/current/title-14/chapter-I/subchapter-F/part-91/subpart-B/section-91.179'
                : 'https://www.ecfr.gov/current/title-14/chapter-I/subchapter-F/part-91/subpart-B/section-91.159'}
              target="_blank" rel="noreferrer" style={{
              display: 'block', marginTop: 10, textAlign: 'center', padding: '8px 0', borderRadius: 9,
              background: 'var(--bg-card-2)', textDecoration: 'none', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)',
            }}>
              {isIFR ? '14 CFR §91.179' : '14 CFR §91.159'}
            </a>
          </>
        )}
      </div>
      <DoneButton isChecked={isChecked} onDone={() => { onToggle(item.id); setOpen(false) }} />
    </ExpandableCard>
  )
}

/* ── VFR Chart map ───────────────────────────────────────────── */
function fmtZ(iso) {
  if (!iso) return null
  const d = new Date(iso)
  return d.getUTCHours().toString().padStart(2,'0') + ':' + d.getUTCMinutes().toString().padStart(2,'0') + 'Z'
}

// FAA chart code → human label + sort order
// codes from d-TPP metafile: APD, IAP, DP, DAU (DP AAUP), STR (STAR), MIN, HOT, LAHSO
const CHART_META = {
  APD:   { label: 'Airport Diagram',  order: 0 },
  IAP:   { label: 'Approaches',       order: 1 },
  DP:    { label: 'Departures',       order: 2 },
  DAU:   { label: 'DP AAUP',          order: 3 },
  STR:   { label: 'Arrivals (STAR)',  order: 4 },
  MIN:   { label: 'Minimums',         order: 5 },
  HOT:   { label: 'Hot Spots',        order: 6 },
  LAHSO: { label: 'LAHSO',            order: 7 },
}
// Bundled FAA charts index (~1MB, keyed to FAA_CHART_CYCLE, updates each airac cycle)

export function ChartsItem({ item, isChecked, onToggle }) {
  const [open, setOpen]           = useState(false)
  const [tab, setTab]             = useState('dep')   // 'dep' | 'arr'
  const [depIcao, setDepIcao]     = useState(null)
  const [arrIcao, setArrIcao]     = useState(null)
  // per-tab data: { airport, sun, faaCharts, loading, error, openGroup }
  const [depState, setDepState]   = useState({ airport: null, sun: null, faaCharts: null, loading: false, error: null, openGroup: null })
  const [arrState, setArrState]   = useState({ airport: null, sun: null, faaCharts: null, loading: false, error: null, openGroup: null })

  const active   = tab === 'dep' ? depState : arrState
  const setActive = tab === 'dep' ? setDepState : setArrState

  // Load route ICAOs when card opens
  useEffect(() => {
    if (!open) return
    get('settings', 'route').then(r => {
      if (r?.dep)  setDepIcao(r.dep.toUpperCase())
      if (r?.dest) setArrIcao(r.dest.toUpperCase())
    })
  }, [open])

  // Load airport data when tab becomes active and icao is known but not yet loaded
  useEffect(() => {
    const icao = tab === 'dep' ? depIcao : arrIcao
    const state = tab === 'dep' ? depState : arrState
    if (!icao || state.airport || state.loading || state.error) return
    loadAirport(icao, tab === 'dep' ? setDepState : setArrState)
  }, [tab, depIcao, arrIcao])

  async function loadAirport(icao, setState) {
    setState(s => ({ ...s, loading: true, error: null }))
    try {
      const apt = await lookupAirport(icao)
      setState(s => ({ ...s, airport: apt, loading: false }))
      // Sunrise
      if (apt.lat && apt.lon) {
        fetch(`https://api.open-meteo.com/v1/forecast?latitude=${apt.lat}&longitude=${apt.lon}&timezone=auto&forecast_days=0`)
          .then(r => r.json())
          .then(tzData => {
            const tz = tzData?.timezone || null
            const localDate = tz
              ? new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
              : new Date().toISOString().slice(0, 10)
            return fetch(`https://api.sunrise-sunset.org/json?lat=${apt.lat}&lng=${apt.lon}&date=${localDate}&formatted=0`)
              .then(r => r.json())
              .then(sunData => { if (sunData?.status === 'OK') setState(s => ({ ...s, sun: { ...sunData.results, tz } })) })
          })
          .catch(() => {
            fetch(`https://api.sunrise-sunset.org/json?lat=${apt.lat}&lng=${apt.lon}&date=today&formatted=0`)
              .then(r => r.json())
              .then(d => { if (d?.status === 'OK') setState(s => ({ ...s, sun: { ...d.results, tz: null } })) })
              .catch(() => {})
          })
      }
      // FAA charts
      const rawIdent = (apt.faaId || apt.icaoId || icao).replace(/^K/, '').toUpperCase()
      const charts = (FAA_CHARTS_DATA[rawIdent] || []).map(([chart_code, chart_name, pdf_name]) => ({ chart_code, chart_name, pdf_name }))
      setState(s => ({ ...s, faaCharts: { edition: FAA_CHART_CYCLE, charts } }))
    } catch {
      setState(s => ({ ...s, loading: false, error: 'Airport not found' }))
    }
  }

  const airport  = active.airport
  const sun      = active.sun
  const faaCharts = active.faaCharts
  const loading  = active.loading
  const openGroup = active.openGroup

  const lat    = airport?.lat ? parseFloat(airport.lat).toFixed(4) : null
  const lon    = airport?.lon ? parseFloat(airport.lon).toFixed(4) : null

  const routeLoaded = depIcao || arrIcao

  return (
    <ExpandableCard item={item} isChecked={isChecked} onToggle={onToggle} open={open} setOpen={setOpen}>

          {/* Segmented tab switcher */}
          {routeLoaded && (
            <div style={{ padding: '10px 12px 0' }}>
              <div onClick={() => setTab(t => t === 'dep' ? 'arr' : 'dep')} style={{
                position: 'relative', display: 'flex',
                background: 'var(--bg-card-2)', borderRadius: 12, padding: 3,
                cursor: 'pointer', userSelect: 'none',
              }}>
                {/* Sliding pill */}
                <div style={{
                  position: 'absolute', top: 3, bottom: 3,
                  width: 'calc(50% - 3px)',
                  left: tab === 'dep' ? 3 : 'calc(50%)',
                  background: 'var(--accent)', borderRadius: 9,
                  transition: 'left 0.22s cubic-bezier(0.4,0,0.2,1)',
                  pointerEvents: 'none',
                }} />
                {[
                  { key: 'dep', label: 'Takeoff', icao: depIcao },
                  { key: 'arr', label: 'Arrival', icao: arrIcao },
                ].map(t => (
                  <div key={t.key} style={{
                    flex: 1, padding: '6px 10px', zIndex: 1,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'color 0.22s',
                    color: tab === t.key ? 'var(--accent-fg)' : 'var(--text-secondary)',
                  }}>
                    <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'monospace', letterSpacing: '1px' }}>
                      {t.icao || '—'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Manual search — only shown if no route airports */}
          {!routeLoaded && (
          <div style={{ padding: '12px 12px 10px', position: 'relative' }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 8 }}>
              ICAO Airport
            </div>
            <div style={{ position: 'relative' }}>
              <input
                value={''}
                onChange={() => {}}
                placeholder="Set a route first, or search…"
                style={{
                  width: '100%', background: 'var(--bg-card-2)', borderRadius: 9,
                  padding: '10px 12px', color: 'var(--text)',
                  fontSize: 16, outline: 'none', boxSizing: 'border-box',
                }}
              />
              {loading && (
                <div style={{
                  position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                  fontSize: 12, color: 'var(--text-tertiary)',
                }}>…</div>
              )}
            </div>

          </div>
          )}

          {/* Loading skeleton */}
          {active.error && (
            <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--danger)' }}>{active.error}</div>
          )}

          {loading && (
            <div style={{ padding: '14px 12px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Bone w={56} h={22} r={4} />
                <Bone w={70} h={16} r={20} />
              </div>
              <Bone w="75%" h={14} r={5} />
              <Bone w="40%" h={11} r={4} />

              {/* Facts grid */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 4 }}>
                <Bone h={44} r={8} />
                <Bone h={44} r={8} />
              </div>

              {/* Sun row */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                <Bone h={44} r={8} />
                <Bone h={44} r={8} />
                <Bone h={44} r={8} />
                <Bone h={44} r={8} />
              </div>

              {/* Frequencies */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                {[80, 60, 90, 55, 70].map((w, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Bone w={`${w}px`} h={12} r={4} />
                    <Bone w="52px" h={14} r={4} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Airport result */}
          {!loading && airport && (
            <>
              {/* Header */}
              <div style={{ padding: '12px 12px 8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', fontFamily: '"SF Mono", monospace', letterSpacing: '1px' }}>
                      {airport.icaoId}
                    </span>
                    {airport.tower != null && (
                      <span style={{
                        fontSize: 10, fontWeight: 700, letterSpacing: '0.4px', textTransform: 'uppercase',
                        color: airport.tower ? 'var(--ok)' : 'var(--text-tertiary)',
                        background: airport.tower ? 'var(--ok-light)' : 'var(--bg-card-2)',
                        border: `0.5px solid ${airport.tower ? 'var(--ok)' : 'var(--border)'}`,
                        borderRadius: 20, padding: '2px 7px',
                      }}>{airport.tower ? 'Towered' : 'Uncontrolled'}</span>
                    )}
                  </div>
                </div>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', marginTop: 3 }}>{airport.name}</div>
                {(airport.state || airport.country) && (
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
                    {[airport.state, airport.country].filter(Boolean).join(', ')}
                  </div>
                )}
              </div>

              {/* Key facts — compact row */}
              {(airport.elev || lat) && (
                <div style={{ padding: '0 12px 10px', display: 'flex', gap: 6 }}>
                  {airport.elev && (
                    <div style={{ background: 'var(--bg-card-2)', borderRadius: 8, padding: '6px 10px', flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{airport.elev}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.3px', marginTop: 2 }}>Elevation</div>
                    </div>
                  )}
                  {lat && lon && (
                    <div style={{ background: 'var(--bg-card-2)', borderRadius: 8, padding: '6px 10px', flex: 2 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', fontFamily: 'monospace' }}>{fmtAvCoord(parseFloat(lat), parseFloat(lon))}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.3px', marginTop: 2 }}>Coordinates</div>
                    </div>
                  )}
                </div>
              )}

              {/* Sunrise / Sunset */}
              {sun && (() => {
                // Format ISO → local time at airport using IANA tz, fallback to UTC
                function fmtLocal(iso) {
                  if (!iso) return '—'
                  try {
                    const d = new Date(iso)
                    const fmt = new Intl.DateTimeFormat('en-US', {
                      hour: 'numeric', minute: '2-digit', hour12: true,
                      timeZone: sun.tz || undefined,
                    })
                    return fmt.format(d).toLowerCase().replace(' ', ' ') // narrow no-break space
                  } catch {
                    return fmtZ(iso)
                  }
                }

                // Reference-matched icons: solid circle sun, short rays, horizon, double-chevron arrows
                const SunriseIcon = ({ size = 30 }) => (
                  <svg width={size} height={size} viewBox="0 0 32 28" fill="none" strokeLinecap="round" strokeLinejoin="round" stroke="currentColor" strokeWidth="1.9" style={{ color: 'var(--text)' }}>
                    {/* solid sun circle */}
                    <circle cx="16" cy="10" r="3.2" fill="currentColor" stroke="none"/>
                    {/* rays — top, upper-L, upper-R, left, right */}
                    <line x1="16"  y1="2.5" x2="16"  y2="5.2"/>
                    <line x1="9.2" y1="4.8" x2="11.1" y2="6.7"/>
                    <line x1="22.8" y1="4.8" x2="20.9" y2="6.7"/>
                    <line x1="7"   y1="10"  x2="9.8"  y2="10"/>
                    <line x1="25"  y1="10"  x2="22.2" y2="10"/>
                    {/* horizon */}
                    <line x1="2" y1="16" x2="30" y2="16" strokeWidth="1.7"/>
                    {/* double upward chevron */}
                    <polyline points="7,24.5 16,19 25,24.5"/>
                    <polyline points="7,28   16,22.5 25,28" opacity="0.45"/>
                  </svg>
                )

                const SunsetIcon = ({ size = 30 }) => (
                  <svg width={size} height={size} viewBox="0 0 32 28" fill="none" strokeLinecap="round" strokeLinejoin="round" stroke="currentColor" strokeWidth="1.9" style={{ color: 'var(--text)' }}>
                    {/* solid sun circle */}
                    <circle cx="16" cy="10" r="3.2" fill="currentColor" stroke="none"/>
                    {/* rays */}
                    <line x1="16"  y1="2.5" x2="16"  y2="5.2"/>
                    <line x1="9.2" y1="4.8" x2="11.1" y2="6.7"/>
                    <line x1="22.8" y1="4.8" x2="20.9" y2="6.7"/>
                    <line x1="7"   y1="10"  x2="9.8"  y2="10"/>
                    <line x1="25"  y1="10"  x2="22.2" y2="10"/>
                    {/* horizon */}
                    <line x1="2" y1="16" x2="30" y2="16" strokeWidth="1.7"/>
                    {/* double downward chevron */}
                    <polyline points="7,19 16,24.5 25,19"/>
                    <polyline points="7,22.5 16,28 25,22.5" opacity="0.45"/>
                  </svg>
                )

                return (
                  <div style={{ padding: '14px 12px 10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-around' }}>

                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, opacity: 0.45 }}>
                        <SunriseIcon size={26} />
                        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', fontFamily: 'monospace' }}>{fmtLocal(sun.civil_twilight_begin)}</span>
                        <span style={{ fontSize: 9, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Civil dawn</span>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                        <SunriseIcon size={30} />
                        <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)', fontFamily: 'monospace' }}>{fmtLocal(sun.sunrise)}</span>
                        <span style={{ fontSize: 9, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Sunrise</span>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                        <SunsetIcon size={30} />
                        <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)', fontFamily: 'monospace' }}>{fmtLocal(sun.sunset)}</span>
                        <span style={{ fontSize: 9, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Sunset</span>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, opacity: 0.45 }}>
                        <SunsetIcon size={26} />
                        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', fontFamily: 'monospace' }}>{fmtLocal(sun.civil_twilight_end)}</span>
                        <span style={{ fontSize: 9, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Civil dusk</span>
                      </div>
                    </div>

                    <div style={{ textAlign: 'center', marginTop: 7, fontSize: 10, color: 'var(--text-tertiary)' }}>
                      {sun.tz ? sun.tz.replace(/_/g, ' ') : 'UTC'} · Night §61.57: civil dusk → dawn
                    </div>
                  </div>
                )
              })()}

              {/* Frequencies — collapsible, styled like chart groups */}
              {airport.frequencies?.length > 0 && (() => {
                const FreqToggle = () => {
                  const [open, setOpen] = useState(false)
                  return (
                    <div style={{ borderRadius: open ? '0 0 10px 10px' : undefined }}>
                      <button onClick={() => setOpen(o => !o)} style={{
                        width: '100%', display: 'flex', alignItems: 'center',
                        justifyContent: 'space-between', padding: '10px 12px',
                        background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>Frequencies</span>
                          <span style={{ fontSize: 11, color: 'var(--text-tertiary)',
                            background: 'var(--bg-card-2)', borderRadius: 10, padding: '1px 7px' }}>
                            {airport.frequencies.length}
                          </span>
                        </div>
                        <span style={{ fontSize: 12, color: 'var(--text-tertiary)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▾</span>
                      </button>
                      {open && (
                        <div style={{}}>
                          {airport.frequencies.map((f, i) => (
                            <div key={i} style={{
                              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                              padding: '9px 12px',
                              borderTop: i > 0 ? '0.5px solid var(--border)' : 'none',
                              background: 'var(--bg-card-2)',
                            }}>
                              <span style={{ fontSize: 12, color: 'var(--text)', fontWeight: 500 }}>{f.type}</span>
                              <span style={{ fontSize: 14, fontWeight: 700, fontFamily: 'monospace', color: 'var(--text)' }}>{f.freq}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                }
                return <FreqToggle />
              })()}


              {/* FAA Official Charts */}
              {faaCharts && (() => {
                const pdfBase = `https://aeronav.faa.gov/d-tpp/${faaCharts?.edition || ''}/`
                // Group charts by code, sorted by order
                const grouped = {}
                ;(faaCharts?.charts || []).forEach(c => {
                  const code = c.chart_code || 'OTHER'
                  if (!grouped[code]) grouped[code] = []
                  grouped[code].push(c)
                })
                const sortedCodes = Object.keys(grouped).sort((a, b) =>
                  (CHART_META[a]?.order ?? 99) - (CHART_META[b]?.order ?? 99)
                )
                const apd = grouped['APD']?.[0]
                return (
                  <div style={{ padding: '12px 12px 4px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>
                        FAA Official Charts
                      </div>
                      {faaCharts?.edition && (
                        <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>Cycle {faaCharts.edition}</div>
                      )}
                    </div>

                    {faaCharts?.charts.length === 0 && (
                      <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 10 }}>No charts found for this airport.</div>
                    )}

                    {apd && (
                      /* Airport Diagram — prominent hero card */
                      <a href={pdfBase + apd.pdf_name} target="_blank" rel="noreferrer" style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        background: 'var(--accent-light)', border: '0.5px solid var(--accent)',
                        borderRadius: 12, padding: '12px 14px', marginBottom: 10,
                        textDecoration: 'none',
                      }}>
                        <div style={{ width: 36, height: 36, flexShrink: 0,
                          display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <img src="/aeropuerto.png" alt="Airport Diagram"
                            style={{ width: '80%', height: '80%', objectFit: 'contain', filter: 'brightness(0) invert(1)' }} />
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)' }}>Airport Diagram</div>
                          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 1 }}>
                            {airport?.icaoId} · Official FAA · PDF
                          </div>
                        </div>
                        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" style={{ color: 'var(--accent)', flexShrink: 0 }}>
                          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                          <polyline points="15 3 21 3 21 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          <line x1="10" y1="14" x2="21" y2="3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                        </svg>
                      </a>
                    )}

                    {/* Other chart groups */}
                    {sortedCodes.filter(c => c !== 'APD').map(code => {
                      const charts = grouped[code]
                      const meta = CHART_META[code] || { label: code }
                      const isOpen = openGroup === code
                      return (
                        <div key={code} style={{ marginBottom: 4, borderRadius: 10, overflow: 'hidden' }}>
                          <button
                            onClick={() => setActive(s => ({ ...s, openGroup: isOpen ? null : code }))}
                            style={{
                              width: '100%', display: 'flex', alignItems: 'center',
                              justifyContent: 'space-between', padding: '10px 12px',
                              background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
                            }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>{meta.label}</span>
                              <span style={{ fontSize: 11, color: 'var(--text-tertiary)',
                                background: 'var(--bg-card-2)', borderRadius: 10, padding: '1px 7px' }}>
                                {charts.length}
                              </span>
                            </div>
                            <span style={{ fontSize: 12, color: 'var(--text-tertiary)', transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▾</span>
                          </button>
                          {isOpen && (
                            <div style={{}}>
                              {charts.map((c, i) => (
                                <a key={c.pdf_name} href={pdfBase + c.pdf_name} target="_blank" rel="noreferrer" style={{
                                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                  padding: '9px 12px',
                                  borderTop: i > 0 ? '0.5px solid var(--border)' : 'none',
                                  textDecoration: 'none', background: 'var(--bg-card-2)',
                                }}>
                                  <span style={{ fontSize: 12, color: 'var(--text)', fontWeight: 500, lineHeight: 1.4, paddingRight: 8 }}>
                                    {c.chart_name}
                                  </span>
                                  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" style={{ color: 'var(--text-tertiary)', flexShrink: 0 }}>
                                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                                    <polyline points="15 3 21 3 21 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                    <line x1="10" y1="14" x2="21" y2="3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                                  </svg>
                                </a>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                    <div style={{ height: 8 }} />
                  </div>
                )
              })()}

              {/* Open charts */}
              <div style={{ padding: '10px 12px 12px' }}>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 8 }}>Open charts</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {[
                    {
                      label: 'A/FD',
                      url: airport
                        ? `https://www.faa.gov/air_traffic/flight_info/aeronav/digital_products/dafd/search/advanced/?ident=${(airport.faaId || airport.icaoId || '').replace(/^K/, '')}`
                        : 'https://www.faa.gov/air_traffic/flight_info/aeronav/digital_products/dafd/search/advanced/',
                    },
                  ].map(cl => (
                    <a key={cl.label} href={cl.url} target="_blank" rel="noreferrer" style={{
                      flex: 1, textAlign: 'center', padding: '8px 0',
                      borderRadius: 9, background: 'var(--bg-card-2)', textDecoration: 'none',
                      fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)',
                    }}>{cl.label}</a>
                  ))}
                </div>
                {airport && (
                  <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 6, textAlign: 'center' }}>
                    A/FD opens pre-filled for {airport.icaoId}
                  </div>
                )}
              </div>
            </>
          )}

          <DoneButton isChecked={isChecked} onDone={() => { onToggle(item.id); setOpen(false) }} />
    </ExpandableCard>
  )
}
