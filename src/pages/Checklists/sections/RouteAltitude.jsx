import 'leaflet/dist/leaflet.css'
import { useState, useEffect, useRef, useMemo } from 'react'
import { MapContainer, TileLayer, Marker, Polyline, Polygon, CircleMarker, Popup, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import FAA_CHARTS_DATA from '../../../data/faa_charts.json'
import { get, put } from '../../../lib/db'
import { ExpandableCard, DoneButton, Bone } from '../shared/ui'
import { FAA_CHART_CYCLE } from '../shared/faaData'
import { awcUrl, proxyFetch, fetchAWC, lookupAirport, bearingDeg, haversineNm } from '../shared/awc'
import { resolveWaypoint, saveUserWaypoint } from '../../../lib/waypoints'

delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

const airportIcon = new L.DivIcon({
  className: '',
  html: `<div style="width:12px;height:12px;border-radius:50%;background:#fff;border:2.5px solid #333;box-shadow:0 1px 6px rgba(0,0,0,0.4)"></div>`,
  iconSize: [12, 12], iconAnchor: [6, 6],
})

function RouteFitter({ positions }) {
  const map = useMap()
  const fitted = useRef(false)
  useEffect(() => {
    // Fit ONCE when the map opens. Never re-fit on waypoint edits — snapping
    // the view away right after the user adds/drags a waypoint is exactly the
    // "random zoom" ForeFlight never does. The user owns the camera.
    if (fitted.current) return
    if (positions.length >= 2) {
      fitted.current = true
      map.fitBounds(L.latLngBounds(positions), { padding: [36, 36] })
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

function SectionalZoomer({ active }) {
  const map = useMap()
  useEffect(() => {
    if (active && map.getZoom() < 7) map.setZoom(7)
  }, [active])
  // Keep enforcing min zoom while sectional is on (user may zoom out)
  useEffect(() => {
    if (!active) return
    const onZoom = () => { if (map.getZoom() < 6) map.setZoom(6) }
    map.on('zoomend', onZoom)
    return () => map.off('zoomend', onZoom)
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
    if (instant) map.setView([target.lat, target.lon], target.zoom ?? 10, { animate: false })
    else map.flyTo([target.lat, target.lon], target.zoom ?? 10, { duration: 1.2 })
  }, [target])
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
function DraggableWaypoint({ position, index, onMove, onRemove, name, kind }) {
  const markerRef = useRef(null)
  // touch-action:none is critical — prevents browser scroll from hijacking the drag
  // Waypoints look identical to the dep/dest airport dots (white, dark ring);
  // named ones show their identifier on a label underneath. The 28px box is an
  // invisible touch target around the 12px visual dot.
  const label = name
    ? `<div style="position:absolute;top:24px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.72);color:#fff;font:700 10px monospace;letter-spacing:0.5px;border-radius:5px;padding:1px 6px;white-space:nowrap;">${name}</div>`
    : ''
  const icon = L.divIcon({
    className: '', iconSize: [28, 28], iconAnchor: [14, 14],
    html: `<div style="position:relative;width:28px;height:28px;cursor:grab;touch-action:none;display:flex;align-items:center;justify-content:center;">
      <div style="width:12px;height:12px;border-radius:50%;background:#fff;border:2.5px solid #333;box-shadow:0 1px 6px rgba(0,0,0,0.4);box-sizing:border-box;"></div>${label}
    </div>`
  })
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
        drag:    (e) => onMove(index, e.target.getLatLng()),
        dragend: (e) => onMove(index, e.target.getLatLng()),
        click:   (e) => { L.DomEvent.stopPropagation(e) },
        contextmenu: () => onRemove(index),
      }}
    />
  )
}

// PolylineEditor — tap/click the route line to insert a waypoint + renders the line
function PolylineEditor({ waypoints, onInsert }) {
  const positions = waypoints.map(w => [w.lat, w.lon])
  return (<>
    {/* Thick invisible hit-area so tap is easy on mobile */}
    <Polyline
      positions={positions}
      pathOptions={{ color: 'transparent', weight: 20, opacity: 0 }}
      eventHandlers={{
        click: (e) => {
          L.DomEvent.stopPropagation(e)
          let bestSeg = 1, bestDist = Infinity
          for (let i = 0; i < waypoints.length - 1; i++) {
            const d = crossTrackNM(e.latlng.lat, e.latlng.lng, [waypoints[i].lat, waypoints[i].lon], [waypoints[i+1].lat, waypoints[i+1].lon])
            if (d < bestDist) { bestDist = d; bestSeg = i + 1 }
          }
          onInsert(bestSeg, e.latlng.lat, e.latlng.lng)
        }
      }}
    />
    {/* Visible line — ForeFlight-style magenta/purple course line, slightly translucent */}
    <Polyline positions={positions} pathOptions={{ color: '#a855f7', weight: 4, opacity: 0.65 }} />
  </>)
}

// LongPressAdd — ForeFlight-style: press-and-hold (or right-click) anywhere on
// the map to drop a point showing its aviation coordinates, with a button to
// insert it into the route at the nearest leg.
function LongPressAdd({ waypoints, onInsert }) {
  const [pt, setPt] = useState(null)
  useMapEvents({
    // Leaflet fires `contextmenu` for long-press on touch and right-click on
    // desktop — exactly the ForeFlight hold gesture.
    contextmenu(e) { setPt({ lat: e.latlng.lat, lon: e.latlng.lng }) },
    click() { setPt(null) },
    dragstart() { setPt(null) },
  })
  if (!pt) return null

  function addHere() {
    let bestSeg = 1, bestDist = Infinity
    for (let i = 0; i < waypoints.length - 1; i++) {
      const d = crossTrackNM(pt.lat, pt.lon, [waypoints[i].lat, waypoints[i].lon], [waypoints[i + 1].lat, waypoints[i + 1].lon])
      if (d < bestDist) { bestDist = d; bestSeg = i + 1 }
    }
    onInsert(bestSeg, pt.lat, pt.lon)
    setPt(null)
  }

  return (<>
    <CircleMarker center={[pt.lat, pt.lon]} radius={7}
      pathOptions={{ color: '#fff', weight: 2.5, fillColor: '#0a84ff', fillOpacity: 1 }} />
    <Popup position={[pt.lat, pt.lon]} offset={[0, -6]} closeButton={false} autoPan={false}>
      <div style={{ textAlign: 'center', minWidth: 168 }}>
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
      <span style={{ fontSize: 12, color: '#fff', fontWeight: 500 }}>Tap the route line to add a waypoint · drag to move</span>
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
function MapLayers({ fit, layers, openaipKey, tfrData, detectedSUAPolys, waypoints, insertWaypoint, moveWaypoint, removeWaypoint, depPos, destPos }) {
  return (<>
    <TileLayer url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png" />
    {layers.sectional && (
      <TileLayer url="https://vfrmap.com/20260319/tiles/vfrc/{z}/{y}/{x}.jpg"
        tms={true} opacity={0.9} maxZoom={12}
        className="sectional-layer"
        errorTileUrl="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
        attribution='&copy; <a href="https://vfrmap.com">VFRMap.com</a>' />
    )}
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
    {fit && <RouteFitter positions={waypoints.map(w => [w.lat, w.lon])} />}
    <AirspaceZoomer active={layers.airspace} />
    <SectionalZoomer active={layers.sectional} />
    <Marker position={waypoints[0] ? [waypoints[0].lat, waypoints[0].lon] : depPos} icon={airportIcon} />
    <Marker position={waypoints[waypoints.length-1] ? [waypoints[waypoints.length-1].lat, waypoints[waypoints.length-1].lon] : destPos} icon={airportIcon} />
    {waypoints.length >= 2 && <PolylineEditor waypoints={waypoints} onInsert={insertWaypoint} />}
    {waypoints.length >= 2 && <LongPressAdd waypoints={waypoints} onInsert={insertWaypoint} />}
    {waypoints.slice(1, -1).map((w, i) => (
      <DraggableWaypoint key={w.id} position={[w.lat, w.lon]} index={i + 1} onMove={moveWaypoint} onRemove={removeWaypoint} name={w.name} kind={w.kind} />
    ))}
  </>)
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

  useEffect(() => {
    get('aircraft', 'profile').then(profile => setIsHelicopter(profile?.category === 'helicopter'))
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
  const [layers, setLayers]         = useState({ sectional: false, airspace: false, tfr: false })
  const [mapFullscreen, setMapFS]   = useState(false)
  const [showRefs, setShowRefs]     = useState(false)
  const [activeChip, setActiveChip] = useState(null) // id of chip whose popup is open

  // Restore saved route on mount; fall back to homeAirport for the FROM field
  useEffect(() => {
    get('settings', 'route').then(r => {
      if (r?.depPos && r?.destPos) {
        if (r.dep) { setDep(r.dep); setDepVal(true) }
        if (r.dest) { setDest(r.dest); setDestVal(true) }
        setRoute(r)
        if (r.wpts?.length) {
          setWptRows(r.wpts.map((w, i) => ({
            id: `wr-restored-${i}`, text: w.name, resolved: w, error: null, creating: null,
          })))
        }
        if (r.mc != null) setCourse(String(r.mc))
        if (r.cruiseAlt != null) setSelectedAlt(r.cruiseAlt)
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

  // ── Named intermediate waypoints (Garmin/ForeFlight style) ──
  // Each row: { id, text, resolved: {kind,name,lat,lon,...}|null, error,
  //             creating: {lat,lon}|null } — `creating` holds the inline
  //             lat/lon form for defining a new USER waypoint.
  const [wptRows, setWptRows] = useState([])
  // Coordinate hint for disambiguating duplicate idents — nearest wins.
  const depPosHint = useRef(null)

  function addWptRow() {
    setWptRows(prev => [...prev, { id: `wr-${Date.now()}`, text: '', resolved: null, error: null, creating: null }])
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
  useEffect(() => {
    if (route?.depPos && route?.destPos) {
      setWaypoints([
        { id: 'dep',  lat: route.depPos[0],  lon: route.depPos[1],  name: dep },
        ...(route.wpts ?? []).map((w, i) => ({ id: `named-${i}-${w.name}`, lat: w.lat, lon: w.lon, name: w.name, kind: w.kind })),
        { id: 'dest', lat: route.destPos[0], lon: route.destPos[1], name: dest },
      ])
    }
  }, [route?.depPos?.[0], route?.depPos?.[1], route?.destPos?.[0], route?.destPos?.[1], JSON.stringify(route?.wpts)])

  function insertWaypoint(index, lat, lon) {
    setWaypoints(prev => {
      const next = [...prev]
      next.splice(index, 0, { id: `wp-${Date.now()}`, lat, lon, name: null })
      return next
    })
  }
  function moveWaypoint(index, latlng) {
    setWaypoints(prev => prev.map((w, i) => i === index ? { ...w, lat: latlng.lat, lon: latlng.lng } : w))
  }
  function removeWaypoint(index) {
    setWaypoints(prev => prev.filter((_, i) => i !== index))
  }

  // Route string for display — dep / intermediates in aviation coords / dest
  const routeString = useMemo(() => {
    if (waypoints.length < 2) return null
    return waypoints.map(w => w.name || fmtAvCoord(w.lat, w.lon)).join(' / ')
  }, [waypoints])

  // Real terrain detection via OpenTopoData elevation + FAA airport corridor check
  const [detectedTerrain, setDetectedTerrain] = useState([])
  const [detectedParkNames, setDetectedParkNames] = useState([])
  const [detectedSUANames, setDetectedSUANames]   = useState([])
  const [detectedSUAPolys, setDetectedSUAPolys]   = useState([]) // [{name, typeCode, poly:[lat,lon][]}]
  useEffect(() => {
    if (waypoints.length < 2) { setDetectedTerrain([]); return }
    let cancelled = false

    async function detect() {
      // Sample 15 points evenly along all segments
      const segs = waypoints.length - 1
      const ptsPerSeg = Math.ceil(15 / segs)
      const pts = []
      for (let s = 0; s < segs; s++) {
        const a = waypoints[s], b = waypoints[s + 1]
        for (let i = 0; i < ptsPerSeg; i++) {
          const t = i / ptsPerSeg
          pts.push([a.lat + (b.lat - a.lat) * t, a.lon + (b.lon - a.lon) * t])
        }
      }
      pts.push([waypoints[waypoints.length-1].lat, waypoints[waypoints.length-1].lon])

      // Open-Elevation API (SRTM data, free, CORS-enabled)
      let elevations = []
      try {
        const locations = pts.map(([la, lo]) => ({ latitude: parseFloat(la.toFixed(4)), longitude: parseFloat(lo.toFixed(4)) }))
        const res = await fetch('https://api.open-elevation.com/api/v1/lookup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({ locations }),
          signal: AbortSignal.timeout(8000),
        })
        if (res.ok) {
          const d = await res.json()
          elevations = (d.results || []).map(r => r.elevation ?? 0)
        }
      } catch { /* ignore */ }

      if (cancelled) return

      const det = []
      const ftElev = elevations.map(e => e * 3.28084) // metres → feet

      // Water: elevation at/near sea level (≤ 5m) — crude but catches ocean/coastal routes
      const hasWater = ftElev.some(e => e <= 15) || pts.some(([la, lo]) =>
        (la < 24.5 && la > 8 && lo > -90 && lo < -58)   // Caribbean
        || (lo < -130 && la < 55)                         // Pacific
        || (la < 30 && la > 17 && lo > -98 && lo < -80)  // Gulf of Mexico
      )
      // Mountains: any point above 5000 ft terrain, or pilot selected high altitude
      const hasMountains = ftElev.some(e => e > 5000) || (selectedAlt && selectedAlt > 9500)
      // High terrain: above 8000 ft
      const hasHighTerrain = ftElev.some(e => e > 8000)

      if (hasWater) det.push('water')
      if (hasMountains) det.push('mountains')

      // Aerodromes: query FAA ArcGIS for airports within route bounding box, then filter by corridor
      // FAA returns lat/lon as DMS strings e.g. "25-48-51.42N" / "080-17-24.42W"
      const parseDMS = str => {
        if (!str) return null
        const m = str.match(/^(\d+)-(\d+)-([\d.]+)([NSEW])$/)
        if (!m) return null
        const dec = +m[1] + +m[2]/60 + +m[3]/3600
        return (m[4] === 'S' || m[4] === 'W') ? -dec : dec
      }
      let hasAero = false
      try {
        const lats = pts.map(p => p[0]), lons = pts.map(p => p[1])
        const pad = 0.3 // ~18 NM buffer on bbox
        const bbox = `${Math.min(...lons)-pad},${Math.min(...lats)-pad},${Math.max(...lons)+pad},${Math.max(...lats)+pad}`
        const url = `https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/US_Airport/FeatureServer/0/query?where=1%3D1&geometry=${encodeURIComponent(bbox)}&geometryType=esriGeometryEnvelope&spatialRel=esriSpatialRelIntersects&outFields=LATITUDE,LONGITUDE&returnGeometry=false&f=json`
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
        if (res.ok) {
          const d = await res.json()
          const airports = (d.features || []).map(f => ({
            lat: parseDMS(f.attributes.LATITUDE),
            lon: parseDMS(f.attributes.LONGITUDE),
          })).filter(a => a.lat !== null && a.lon !== null)
          hasAero = airports.some(ap => {
            for (let s = 0; s < waypoints.length - 1; s++) {
              const dist = crossTrackNM(ap.lat, ap.lon, [waypoints[s].lat, waypoints[s].lon], [waypoints[s+1].lat, waypoints[s+1].lon])
              if (dist < 15) return true
            }
            return false
          })
        }
      } catch { /* ignore */ }

      if (hasAero) det.push('aero')
      if (hasAero) det.push('builtup')
      if (selectedAlt && selectedAlt > 10000) det.push('oxygen')

      // Bounding box for park + SUA queries
      const lats2 = pts.map(p => p[0]), lons2 = pts.map(p => p[1])
      const pad2 = 0.1
      const bbox2 = `${Math.min(...lons2)-pad2},${Math.min(...lats2)-pad2},${Math.max(...lons2)+pad2},${Math.max(...lats2)+pad2}`

      // Esri ring → [lat, lon][] polygon
      const ringToPoly = ring => ring.map(([x, y]) => [y, x])

      // National Parks (NPS ArcGIS)
      const [npsRes, suaRes] = await Promise.allSettled([
        fetch(`https://mapservices.nps.gov/arcgis/rest/services/LandResourcesDivisionTractAndBoundaryService/MapServer/1/query?where=1%3D1&geometry=${encodeURIComponent(bbox2)}&geometryType=esriGeometryEnvelope&spatialRel=esriSpatialRelIntersects&outFields=UNIT_NAME,UNIT_TYPE&returnGeometry=true&f=json`, { signal: AbortSignal.timeout(8000) }),
        fetch(`https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/Special_Use_Airspace/FeatureServer/0/query?where=1%3D1&geometry=${encodeURIComponent(bbox2)}&geometryType=esriGeometryEnvelope&spatialRel=esriSpatialRelIntersects&outFields=NAME,TYPE_CODE&returnGeometry=true&f=json`, { signal: AbortSignal.timeout(8000) }),
      ])

      if (cancelled) return

      // Parks
      const parkNames = []
      if (npsRes.status === 'fulfilled' && npsRes.value.ok) {
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
      if (suaRes.status === 'fulfilled' && suaRes.value.ok) {
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

      setDetectedTerrain(det)
    }

    detect()
    return () => { cancelled = true }
  }, [JSON.stringify(waypoints.map(w => [+w.lat.toFixed(3), +w.lon.toFixed(3)])), selectedAlt])

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
      if (name === 'tfr' && next.tfr && !tfrData) loadTFRs()
      return next
    })
  }

  async function loadTFRs() {
    setTfrLoad(true)
    setTfrData(null)

    // FAA GeoServer WFS — the actual endpoint tfr3 uses internally
    // No CORS headers, must proxy. corsproxy.io confirmed working.
    const WFS_URL = 'https://tfr.faa.gov/geoserver/TFR/ows?service=WFS&version=1.1.0&request=GetFeature&typeName=TFR:V_TFR_LOC&maxFeatures=300&outputFormat=application/json&srsname=EPSG:4326'
    try {
      const raw = await proxyFetch(WFS_URL, 15000)
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


  async function calcRoute() {
    if (!dep.trim() || !dest.trim()) return
    setRL(true); setRE(null); setRoute(null)
    try {
      const [da, dsta] = await Promise.all([
        fetchAWC(dep.trim().toUpperCase()),
        fetchAWC(dest.trim().toUpperCase()),
      ])
      if (!da?.lat || !dsta?.lat) throw new Error('Coordinates not found')

      const depLat = parseFloat(da.lat), depLon = parseFloat(da.lon)
      const dstLat = parseFloat(dsta.lat), dstLon = parseFloat(dsta.lon)

      // Full chain: dep → named waypoints → dest. Distance sums per leg;
      // course is the first leg's (what you'd fly off the departure).
      const wpts = wptRows.filter(r => r.resolved).map(r => ({
        kind: r.resolved.kind, name: r.resolved.name,
        lat: r.resolved.lat, lon: r.resolved.lon,
      }))
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
        dep: dep.trim().toUpperCase(),
        dest: dest.trim().toUpperCase(),
        wpts,
      }
      setRoute(routeObj)
      setLayers(prev => ({ ...prev, sectional: true }))
      setMapFlyTarget({ lat: depLat, lon: depLon, zoom: 10, _t: Date.now() })
      put('settings', { key: 'route', ...routeObj }).catch(() => {})
      setCourse(String(mcRounded))
      setSelectedAlt(null)
    } catch (e) {
      setRE('Could not calculate — check both ICAO codes')
    } finally {
      setRL(false)
    }
  }

  const c        = parseInt(course)
  const valid    = !isNaN(c) && c >= 0 && c <= 360
  const isEast   = valid && c <= 179
  const direction = valid ? (isEast ? 'Eastbound' : 'Westbound') : null
  const altitudes = valid
    ? (isEast ? [3500,5500,7500,9500,11500,13500,15500,17500]
              : [4500,6500,8500,10500,12500,14500,16500])
    : null

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
                    onClick={() => { setDep(''); setDepVal(false); setDepErr(null); setRoute(null); setRE(null) }}
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
                  onChange={e => { setDep(e.target.value.toUpperCase()); setDepErr(null); setRoute(null); setRE(null) }}
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
                    onClick={() => { setDest(''); setDestVal(false); setDestErr(null); setRoute(null); setRE(null) }}
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
                  onChange={e => { setDest(e.target.value.toUpperCase()); setDestErr(null); setRoute(null); setRE(null) }}
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
                        background: row.resolved.kind === 'VOR' ? 'rgba(139,92,246,0.18)' : row.resolved.kind === 'GPS' ? 'rgba(52,199,89,0.15)' : 'rgba(255,159,10,0.15)',
                        color:      row.resolved.kind === 'VOR' ? '#a78bfa' : row.resolved.kind === 'GPS' ? 'var(--ok)' : 'var(--warn)',
                      }}>
                        {row.resolved.kind}
                      </span>
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

        <button
          onClick={addWptRow}
          style={{
            width: '100%', padding: '7px 0', borderRadius: 9, marginBottom: 8,
            background: 'var(--bg-card-2)', color: 'var(--text-secondary)',
            fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none',
          }}>
          + Add waypoint
        </button>

        <button
          onClick={calcRoute}
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

        {/* Route result */}
        {route && (
          <div style={{ marginTop: 10, background: 'var(--bg-card-2)', borderRadius: 10, padding: '10px 12px' }}>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 8 }}>
              {route.depName} → {route.destName}
            </div>
            {route.wpts?.length > 0 && (
              <div style={{ fontSize: 11, fontFamily: 'monospace', fontWeight: 700, letterSpacing: '0.5px', color: 'var(--text-secondary)', marginBottom: 8, overflowX: 'auto', whiteSpace: 'nowrap' }}>
                {[route.dep, ...route.wpts.map(w => w.name), route.dest].join(' → ')}
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

            {/* Layer toggles */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
              {[
                { id: 'sectional', label: 'Sectional' },
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
              const mapLayerProps = { layers, openaipKey, tfrData, detectedSUAPolys, waypoints, insertWaypoint, moveWaypoint, removeWaypoint, depPos: route.depPos, destPos: route.destPos }

              return (<>
                {/* Inline map */}
                <div style={{ borderRadius: 10, overflow: 'hidden', height: 240, position: 'relative', cursor: 'pointer' }}
                  onClick={() => setMapFS(true)}>
                  <MapContainer center={route.depPos} zoom={10}
                    style={{ height: '100%', width: '100%' }}
                    zoomControl={false} attributionControl={false}
                    dragging={false} scrollWheelZoom={false} doubleClickZoom={false} touchZoom={false}>
                    <MapLayers fit={false} {...mapLayerProps} />
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
                {mapFullscreen && (() => {
                  const TERRAIN_DATA = {
                    water:     { label: 'Water',         items: ['Life jacket / flotation device aboard','Glide range reaches shore or vessel','Survival equipment for water temp','Filed flight plan with overwater leg'] },
                    mountains: { label: 'Mountains',     items: ['Terrain clearance — 1,000 ft above highest within 5 NM','Escape route identified for each leg','Turbulence / downdraft margins planned','Density altitude checked at cruise level'] },
                    builtup:   { label: 'Built-up Areas',items: ['Min 1,000 ft AGL above highest obstacle within 2,000 ft','Emergency landing area identified','Noise abatement procedures noted'] },
                    aero:      { label: 'Aerodromes',    items: ['Cross at min 500 ft above circuit altitude','Monitor CTAF / MF frequency','Note traffic pattern direction'] },
                    oxygen:    { label: 'Oxygen',        items: ['Above 10,000 ft MSL >30 min: O₂ required (crew)','Above 12,500 ft MSL: O₂ required','Passengers: O₂ available above 10,000 ft'] },
                    parks:     { label: 'Nat. Park',     items: ['Check NPS overflight rules — many parks have voluntary/mandatory altitude corridors','Noise-sensitive wildlife areas may have seasonal restrictions','Review park-specific SFAR or LOA if applicable'] },
                    sua:       { label: 'Spec. Use Airspace', items: ['Verify SUA active status via NOTAM / 1800wxbrief','MOA — contact controlling agency for advisories','Restricted / Prohibited — do not enter without clearance','Alert area — extra vigilance required'] },
                  }
                  const REFS = [
                    { label: 'FAA NOTAM Search', sub: 'Official FAA NOTAM system',          url: 'https://notams.aim.faa.gov/notamSearch/' },
                    { label: 'FAA TFR Map',       sub: 'Active TFRs plotted on a map',       url: 'https://tfr.faa.gov/tfr2/list.html' },
                    { label: '1800wxbrief.com',   sub: 'Leidos — full preflight briefing',   url: 'https://www.1800wxbrief.com' },
                    { label: 'SkyVector',         sub: 'NOTAMs and TFRs overlaid on chart',  url: 'https://skyvector.com' },
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
                          style={{ height: '100%', width: '100%' }}
                          zoomControl={true} attributionControl={false}>
                          <MapInvalidator />
                          <MapLayers fit={true} {...mapLayerProps} />
                          <MapFlyTo target={mapFlyTarget} />
                        </MapContainer>
                      </div>

                      {/* Route edit hint — fades after 4s */}
                      <RouteHint />

                      {/* Top bar — the map behind it extends under the status bar for a true
                          full-screen feel, but the controls themselves need the safe-area
                          inset or they'd sit right under (and look cut off by) the status bar */}
                      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10001,
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '14px 16px',
                        paddingTop: 'calc(14px + env(safe-area-inset-top))',
                        background: 'linear-gradient(to bottom, rgba(0,0,0,0.75) 0%, transparent 100%)',
                      }}>
                        {/* Layer toggles */}
                        <div style={{ display: 'flex', gap: 7 }}>
                          {[['sectional','SECT'],['airspace','ARSP'],['tfr','TFR']].map(([k,label]) => (
                            <button key={k} onClick={() => toggleLayer(k)} style={{
                              background: layers[k] ? 'rgba(255,255,255,0.95)' : 'rgba(10,10,10,0.75)',
                              backdropFilter: 'blur(12px)',
                              border: layers[k] ? 'none' : '0.5px solid rgba(255,255,255,0.18)',
                              borderRadius: 7, color: layers[k] ? '#000' : 'rgba(255,255,255,0.85)',
                              fontSize: 11, fontWeight: 700, letterSpacing: '0.5px',
                              padding: '7px 11px', cursor: 'pointer',
                            }}>{label}</button>
                          ))}
                        </div>
                        {/* Close */}
                        <button onClick={() => setMapFS(false)} style={{
                          background: 'rgba(10,10,10,0.75)', backdropFilter: 'blur(12px)',
                          border: '0.5px solid rgba(255,255,255,0.18)', borderRadius: 7,
                          color: 'rgba(255,255,255,0.85)', fontSize: 11, fontWeight: 700,
                          letterSpacing: '0.5px', padding: '7px 13px', cursor: 'pointer',
                        }}>✕ CLOSE</button>
                      </div>

                      {/* Bottom panel */}
                      <div style={{
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
                      }}>
                        {/* Route strip */}
                        <div style={{
                          padding: '10px 18px 8px',
                          borderBottom: '0.5px solid rgba(255,255,255,0.07)',
                          flexShrink: 0,
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            {/* ICAO pair */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                              <span style={{ fontSize: 15, fontWeight: 800, color: '#fff', fontFamily: 'monospace', letterSpacing: '1px' }}>{dep}</span>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                <div style={{ width: 18, height: 0.5, background: 'rgba(255,255,255,0.35)' }} />
                                <div style={{ width: 3, height: 3, borderRadius: '50%', background: 'rgba(255,255,255,0.35)' }} />
                                <div style={{ width: 18, height: 0.5, background: 'rgba(255,255,255,0.35)' }} />
                              </div>
                              <span style={{ fontSize: 15, fontWeight: 800, color: '#fff', fontFamily: 'monospace', letterSpacing: '1px' }}>{dest}</span>
                              {waypoints.length > 2 && (
                                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.08)', borderRadius: 4, padding: '2px 6px', fontWeight: 600 }}>
                                  +{waypoints.length - 2} WPT
                                </span>
                              )}
                            </div>
                            {/* Stats */}
                            <div style={{ display: 'flex', gap: 16 }}>
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
                          {waypoints.length > 2 && routeString && (
                            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.38)', fontFamily: 'monospace', letterSpacing: '0.3px', lineHeight: 1.4, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {routeString}
                            </div>
                          )}
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
                          {detectedTerrain.length > 0 && (() => {
                            const chipColor = id =>
                              id === 'parks' ? { bg: 'rgba(52,199,89,0.15)', fg: 'rgba(52,199,89,0.9)', activeBg: 'rgba(52,199,89,0.28)', border: 'rgba(52,199,89,0.4)' }
                              : id === 'sua' ? { bg: 'rgba(255,149,0,0.15)', fg: 'rgba(255,149,0,0.9)', activeBg: 'rgba(255,149,0,0.28)', border: 'rgba(255,149,0,0.4)' }
                              : { bg: 'rgba(255,255,255,0.08)', fg: 'rgba(255,255,255,0.65)', activeBg: 'rgba(255,255,255,0.16)', border: 'rgba(255,255,255,0.25)' }
                            const subNames = id =>
                              id === 'parks' ? detectedParkNames
                              : id === 'sua' ? detectedSUANames
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
                                          onClick={() => setActiveChip(isActive ? null : id)}
                                          onMouseEnter={() => setActiveChip(id)}
                                          onMouseLeave={() => setActiveChip(null)}
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
                                </div>
                              </div>
                            )
                          })()}

                          {/* Chip popup — rendered inside bottom panel, above it */}
                          {activeChip && TERRAIN_DATA[activeChip] && (() => {
                            const c = activeChip === 'parks' ? { accent: 'rgba(52,199,89,0.9)', border: 'rgba(52,199,89,0.25)' }
                              : activeChip === 'sua' ? { accent: 'rgba(255,149,0,0.9)', border: 'rgba(255,149,0,0.25)' }
                              : { accent: 'rgba(255,255,255,0.7)', border: 'rgba(255,255,255,0.15)' }
                            const names = activeChip === 'parks' ? detectedParkNames : activeChip === 'sua' ? detectedSUANames : []
                            const td = TERRAIN_DATA[activeChip]
                            return (
                              <div
                                onMouseEnter={() => setActiveChip(activeChip)}
                                onMouseLeave={() => setActiveChip(null)}
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
                                  <span onClick={() => setActiveChip(null)} style={{ fontSize: 16, color: 'rgba(255,255,255,0.3)', cursor: 'pointer', padding: '0 4px', lineHeight: 1 }}>✕</span>
                                </div>
                                {activeChip === 'sua' && (
                                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginBottom: 10, lineHeight: 1.4 }}>
                                    Your route passes through or crosses the boundary of the following airspaces. Each requires a specific action before flight.
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
                      {showRefs && (
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
                })()}
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
          </div>
        )}

        {altitudes && (
          <>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 8 }}>
              {isEast ? 'Odd thousands + 500 ft' : 'Even thousands + 500 ft'}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {altitudes.map(alt => {
                const selected = selectedAlt === alt
                return (
                  <button key={alt} onClick={() => {
                  const next = selected ? null : alt
                  setSelectedAlt(next)
                  get('settings', 'route').then(r => {
                    if (r) put('settings', { ...r, cruiseAlt: next }).catch(() => {})
                  })
                }} style={{
                    background: selected ? 'var(--text)' : 'var(--bg-card-2)',
                    border: `0.5px solid ${selected ? 'var(--text)' : 'var(--border)'}`,
                    borderRadius: 8, padding: '7px 0',
                    fontSize: 13, fontWeight: 600,
                    color: selected ? 'var(--bg)' : 'var(--text)',
                    cursor: 'pointer', transition: 'all 0.18s', textAlign: 'center',
                  }}>
                    {alt.toLocaleString()} ft
                  </button>
                )
              })}
            </div>
            {selectedAlt && (
              <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 9, background: 'var(--bg-card-2)' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                  Planned: {selectedAlt.toLocaleString()} ft MSL
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
                  {direction} · {isEast ? 'Odd' : 'Even'} thousands + 500 ft · §91.159
                </div>
              </div>
            )}
            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
              Above 18,000 ft MSL is Class A airspace, IFR only.
            </div>

            <a href="https://www.ecfr.gov/current/title-14/chapter-I/subchapter-F/part-91/subpart-B/section-91.159" target="_blank" rel="noreferrer" style={{
              display: 'block', marginTop: 10, textAlign: 'center', padding: '8px 0', borderRadius: 9,
              background: 'var(--bg-card-2)', textDecoration: 'none', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)',
            }}>
              14 CFR §91.159
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
  const svBase = lat && lon ? `?ll=${lat},${lon}` : ''
  const svPage = airport ? `https://skyvector.com/airport/${airport.icaoId}` : 'https://skyvector.com'

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
                  <a href={svPage} target="_blank" rel="noreferrer" style={{
                    fontSize: 11, fontWeight: 600, color: 'var(--accent)',
                    textDecoration: 'none',
                  }}>SkyVector ↗</a>
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
                    { label: 'Sectional', url: `https://skyvector.com/${svBase}&chart=301&zoom=2` },
                    { label: 'IFR',       url: `https://skyvector.com/${svBase}&chart=302&zoom=2` },
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
