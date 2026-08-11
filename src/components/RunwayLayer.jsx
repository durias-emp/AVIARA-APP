// The pavement, drawn where the pavement is.
//
// Every other aerodrome layer in this app is a marker: a dot or a disc saying
// "a field is here". That is the right answer from ten miles up and the wrong
// one from a thousand feet, where the question stops being where the airport
// is and becomes which way the runway points, which end you are looking at,
// and whether the strip is long enough. So below a zoom floor this draws
// nothing at all, and above it the marker gives way to the runway itself: the
// real outline, at the real width, with the designators painted on it the way
// they are painted on the ground.
//
// It is not a chip. A pilot who has zoomed down onto one aerodrome has already
// said what they want to look at, and making them find a toggle to see the
// runway they are pointing at would be a menu standing in for an answer. The
// zoom floor is the switch.
//
// What it may not do is invent geometry. The coordinates come from
// runway_geometry.json, which carries surveyed thresholds where the FAA
// publishes them and community ones elsewhere, and refuses to ship a runway
// whose two thresholds disagree with its published length. A field with no
// usable geometry simply keeps its marker; nothing is drawn from a heading and
// a guess, because a runway drawn a few hundred feet off the real one is worse
// than no runway drawn at all. Which of the two sources a field came from
// travels with it, into the popup and into the plate above the map.

import { Fragment, memo, useEffect, useRef, useState } from 'react'
import { Polygon, Polyline, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import { getRunwayGeometry } from '../lib/aerodromes'
import { runwayCorners, runwayEnds, crossBar, metresPerPixel, runwayFrame } from '../lib/runwayShape'
import PopupActions from './PopupActions'

// Both a level earlier than they were, so the aerodrome arrives as one thing.
//
// The taxiway letters now start at 12 (see aerowayStyle.js), and a screen with
// lettered taxiways and no runway on it is not an airport, it is a puzzle. At
// 12 a 7,000 ft runway is about 60 px, which is short but unmistakably a
// runway once it has shoulders. The markings still wait a level, because the
// centreline and the threshold bars inside a three-pixel-wide strip are mud.
const RUNWAY_MIN_ZOOM = 12
const MARKING_MIN_ZOOM = 13

// Pavement dark enough to read against the light basemap and light enough to
// read against the dark one, which is the same trick a printed chart uses.
const PAVEMENT = '#3b4048'
const PAVEMENT_EDGE = '#14171c'
const MARKING = '#f4f6f9'

// The shoulders: the paved strip either side of the runway proper.
//
// They are drawn because without them a runway at chart zoom is a thin dark
// line among other thin dark lines, and the one thing on an aerodrome that has
// to be unmistakable is the thing you land on. Real shoulders run about a
// third of the runway's width either side; this draws the pair as one wider
// band underneath, lighter than the runway so the runway still reads as the
// darkest mark on the field.
const SHOULDER = '#5b6472'
const SHOULDER_FACTOR = 1.7

const FT_PER_M = 3.280839895

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v))
}

// The designator, rotated to the direction it is painted in. A div rather than
// a path so it stays crisp at every zoom, and unclickable so it never steals a
// tap from the pavement underneath it.
//
// Cached, the same way aerodromeLayers caches its airport discs and for the
// same reason. A fresh L.divIcon is a fresh object, and handing Leaflet a new
// icon for a marker it already has makes it tear the marker's element out of
// the DOM and build another one. This is called once per runway END, so a
// large field is eight of them and a pan across a metro area is many more,
// every time the layer renders.
//
// Keyed on the markup rather than on the three arguments. That is deliberate:
// a key built from inputs goes stale the moment someone adds a value to the
// template and forgets to add it to the key, and a stale designator is a
// number painted on the wrong runway, which is far worse than a slow one.
// Identical markup is identical output, by definition.
const designatorCache = new Map()
// Cleared wholesale rather than evicted one at a time. The working set is
// whatever is on screen, so anything past this is history, and a flat clear
// costs one render of the labels currently in view.
const DESIGNATOR_CACHE_MAX = 600

function designatorIcon(ident, bearing, fontPx) {
  const html = `<div style="
      position:absolute; left:0; top:0; transform:translate(-50%,-50%) rotate(${bearing.toFixed(1)}deg);
      font:800 ${fontPx.toFixed(1)}px/1 ui-monospace,SFMono-Regular,Menlo,monospace;
      letter-spacing:${(fontPx * 0.06).toFixed(2)}px; color:${MARKING};
      text-shadow:0 0 3px rgba(0,0,0,0.85); white-space:nowrap; pointer-events:none;
    ">${ident}</div>`
  const hit = designatorCache.get(html)
  if (hit) return hit

  if (designatorCache.size >= DESIGNATOR_CACHE_MAX) designatorCache.clear()
  const icon = L.divIcon({
    className: '',
    iconSize: [0, 0],
    iconAnchor: [0, 0],
    html,
  })
  designatorCache.set(html, icon)
  return icon
}

// Flattened once, on load: 12,000 fields as an object is fine to hold and
// miserable to scan on every pan. One array of runway rows with their field's
// ident attached is what the bbox test actually wants.
function flatten(pack) {
  const rows = []
  for (const [ident, entry] of Object.entries(pack)) {
    if (ident === '_meta' || !entry?.r) continue
    for (const r of entry.r) {
      rows.push({ ident, source: entry.s, elevFt: entry.e ?? null, r })
    }
  }
  return rows
}

function facts(r, source, cycles) {
  const [le, he, , , , , lengthFt, widthFt, lit] = r
  const size = lengthFt
    ? `${lengthFt.toLocaleString()}${widthFt ? ` x ${widthFt.toLocaleString()}` : ''} ft`
    : null
  return {
    title: `RWY ${le}/${he}`,
    size,
    lit: lit === 1 ? 'Lighted' : lit === 0 ? 'Unlighted' : null,
    source: source === 'FAA'
      ? `FAA NASR ${cycles?.FAA ?? ''}`.trim() + ', surveyed thresholds'
      : 'OurAirports, community data',
  }
}

function RunwayLayer({ onFocusField, onDrawnFields, onSetDestination, onAddWaypoint }) {
  const map = useMap()
  const [rows, setRows] = useState(null)
  const [cycles, setCycles] = useState(null)
  const [visible, setVisible] = useState([])
  const [zoom, setZoom] = useState(() => map.getZoom())
  const timer = useRef(null)
  const asked = useRef(false)

  // The parent re-renders on every map move, so this callback arrives with a
  // new identity constantly. Held in a ref for the same reason VectorBasemap
  // holds its own: nothing that changes every frame may reach a dependency
  // list that controls loading.
  const focusRef = useRef(onFocusField)
  const drawnRef = useRef(onDrawnFields)
  useEffect(() => { focusRef.current = onFocusField }, [onFocusField])
  useEffect(() => { drawnRef.current = onDrawnFields }, [onDrawnFields])

  useEffect(() => {
    function scan() {
      const z = map.getZoom()
      setZoom(z)
      if (z < RUNWAY_MIN_ZOOM) {
        setVisible([])
        focusRef.current?.(null)
        drawnRef.current?.(null)
        return
      }
      // The 1.3 MB pack is fetched the first time a pilot zooms this far in
      // and never before. Someone who flies the app at chart zoom all day
      // never downloads it.
      if (!rows) {
        if (!asked.current) {
          asked.current = true
          getRunwayGeometry().then(pack => {
            setCycles(pack._meta?.cycles ?? null)
            setRows(flatten(pack))
          }).catch(() => { asked.current = false })
        }
        return
      }
      // Leaflet's own getBounds throws "Invalid LatLng object: (NaN, NaN)"
      // when it is asked before the container has been laid out, which on this
      // screen is the ordinary first pass: the map is mounted inside a fixed
      // box that the drawer is still sizing. There is nothing to recover, and
      // nothing to report either, because a resize fires another moveend a
      // frame later and this runs again with real numbers. Skipping the pass is
      // the whole fix.
      let b
      try { b = map.getBounds().pad(0.25) } catch { return }
      const south = b.getSouth(), north = b.getNorth(), west = b.getWest(), east = b.getEast()
      if (![south, north, west, east].every(Number.isFinite)) return
      const hits = []
      for (const row of rows) {
        const [, , aLat, aLon, bLat, bLon] = row.r
        // Either threshold inside the view is enough: a runway running off the
        // edge of the screen still has to be drawn to the edge.
        const aIn = aLat >= south && aLat <= north && aLon >= west && aLon <= east
        const bIn = bLat >= south && bLat <= north && bLon >= west && bLon <= east
        if (aIn || bIn) hits.push(row)
      }
      setVisible(hits)

      // Which fields ended up with real pavement on screen, so the marker
      // layer can stand its own discs down for exactly those and no others.
      // A strip with no bundled geometry keeps its marker at every zoom: it is
      // the only mark it has, and a field that disappears as you approach it
      // is worse than a field drawn as a dot.
      drawnRef.current?.(z >= MARKING_MIN_ZOOM ? new Set(hits.map(h => h.ident)) : null)

      // Which field the pilot is actually over: the one with a runway nearest
      // the middle of the screen. With several aerodromes in view (Los Angeles
      // has half a dozen) picking the nearest is the only reading of "the one
      // you are looking at" that does not flicker between them on a pan.
      const c = map.getCenter()
      let best = null, bestD = Infinity
      for (const row of hits) {
        const [, , aLat, aLon, bLat, bLon] = row.r
        const d = (aLat + bLat) / 2 - c.lat
        const e = (aLon + bLon) / 2 - c.lng
        const dist = d * d + e * e
        if (dist < bestD) { bestD = dist; best = row }
      }
      focusRef.current?.(best ? {
        ident: best.ident,
        source: best.source,
        elevFt: best.elevFt,
        runways: hits.filter(h => h.ident === best.ident).map(h => h.r),
        cycles: cycles ?? null,
      } : null)
    }
    scan()
    function onMove() {
      clearTimeout(timer.current)
      timer.current = setTimeout(scan, 250)
    }
    map.on('moveend', onMove)
    map.on('zoomend', onMove)
    return () => {
      map.off('moveend', onMove)
      map.off('zoomend', onMove)
      clearTimeout(timer.current)
    }
  }, [map, rows, cycles])

  if (zoom < RUNWAY_MIN_ZOOM || !visible.length) return null

  const showMarkings = zoom >= MARKING_MIN_ZOOM

  return visible.map(({ ident, source, r }, i) => {
    const [le, he, aLat, aLon, bLat, bLon, , widthFt] = r
    const a = [aLat, aLon]
    const b = [bLat, bLon]
    const corners = runwayCorners(a, b, widthFt)
    if (!corners) return null
    const shoulders = runwayCorners(a, b, (widthFt || 75) * SHOULDER_FACTOR)
    const f = runwayFrame(a, b)
    const key = `${ident}-${le}-${he}-${i}`
    const info = facts(r, source, cycles)

    // Everything inside the pavement is sized off the pavement, so the
    // markings stay in proportion at every zoom instead of swelling into the
    // grass as you come down.
    const mpp = metresPerPixel(aLat, zoom)
    const widthPx = ((widthFt || 75) / FT_PER_M) / mpp
    // The designator is the one marking allowed to break the proportion rule.
    // Sized strictly to the pavement it was 9px at the zoom a pilot actually
    // looks at a field from, which is a speck: the number a runway is called
    // by has to be readable before it is in proportion, and the halo carries
    // whatever overhangs onto the grass.
    const font = clamp(widthPx * 1.15, 14, 36)
    const centreWeight = clamp(widthPx * 0.045, 0.8, 2.4)
    const barWeight = clamp(widthPx * 0.09, 1.2, 4)

    return (
      <Fragment key={key}>
        {/* Shoulders first, so the runway lies on them. Not interactive: the
            tap target is the runway, and a band of shoulder either side would
            make the popup fire from the grass. */}
        {shoulders && (
          <Polygon positions={shoulders} interactive={false}
            pathOptions={{
              color: SHOULDER, weight: 0, opacity: 0,
              fillColor: SHOULDER, fillOpacity: 0.55,
            }} />
        )}
        <Polygon positions={corners}
          pathOptions={{
            color: PAVEMENT_EDGE, weight: 1, opacity: 0.9,
            fillColor: PAVEMENT, fillOpacity: 0.94,
          }}>
          <Popup>
            <div style={{ minWidth: 172 }}>
              <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.3px', color: 'var(--map-ink)' }}>
                {info.title}
              </div>
              <div style={{ fontSize: 12, color: 'var(--map-ink-dim)', marginTop: 2 }}>{ident}</div>
              <div style={{ marginTop: 7, display: 'flex', flexDirection: 'column', gap: 2 }}>
                {[info.size, info.lit].filter(Boolean).map((t, n) => (
                  <div key={n} style={{ fontSize: 12, color: 'var(--map-ink)' }}>{t}</div>
                ))}
                {f && (
                  <div style={{ fontSize: 12, color: 'var(--map-ink)' }}>
                    {Math.round(f.bearing)}&deg; / {Math.round((f.bearing + 180) % 360)}&deg; true
                  </div>
                )}
              </div>
              <div style={{ marginTop: 7, fontSize: 10.5, color: 'var(--map-ink-faint)', lineHeight: 1.35 }}>
                {info.source}
              </div>
              {/* The airport marker steps aside at this zoom, so its two
                  actions have to live here or they would simply stop existing
                  the moment a pilot zoomed in far enough to want them. The
                  point sent is the middle of the runway, which is as close to
                  the field as this pack can speak for. */}
              <PopupActions onSetDestination={onSetDestination} onAddWaypoint={onAddWaypoint}
                ident={ident} name={null}
                lat={(aLat + bLat) / 2} lon={(aLon + bLon) / 2} />
            </div>
          </Popup>
        </Polygon>

        {showMarkings && (() => {
          // Centreline, threshold bars and numbers. Drawn as separate paths
          // rather than one shape because Leaflet has no notion of a fill
          // pattern, and because each wants its own weight.
          const dash = clamp(widthPx * 0.5, 4, 22)
          const barIn = Math.min(30, f.spanM * 0.08)
          const inner = crossBar(a, b, barIn, widthFt, { frac: 0.78 })
          const innerB = crossBar(a, b, barIn, widthFt, { fromB: true, frac: 0.78 })
          return (
            <>
              <Polyline positions={[a, b]} interactive={false}
                pathOptions={{
                  color: MARKING, weight: centreWeight, opacity: 0.8,
                  dashArray: `${dash} ${dash * 1.4}`, lineCap: 'butt',
                }} />
              {inner && (
                <Polyline positions={inner} interactive={false}
                  pathOptions={{ color: MARKING, weight: barWeight, opacity: 0.9, lineCap: 'butt' }} />
              )}
              {innerB && (
                <Polyline positions={innerB} interactive={false}
                  pathOptions={{ color: MARKING, weight: barWeight, opacity: 0.9, lineCap: 'butt' }} />
              )}
              {runwayEnds(r).map(end => end.at && (
                <Marker key={end.ident} position={end.at} interactive={false}
                  icon={designatorIcon(end.ident, end.bearing, font)} />
              ))}
            </>
          )
        })()}
      </Fragment>
    )
  })
}

// Memoized. This is the most expensive layer on the map: at the zoom it draws
// at it is building threshold-to-corner polygons, centrelines, bar markings
// and a rotated label for every runway end in view, and none of that changes
// because a GPS fix arrived. Its four props are all stable by construction
// (see MapHome, where every one of them is a useCallback or a setState), and
// what it actually redraws for, a pan or a zoom, it hears from the map itself
// on moveend and zoomend rather than from its parent.
export default memo(RunwayLayer)

export { RUNWAY_MIN_ZOOM }
