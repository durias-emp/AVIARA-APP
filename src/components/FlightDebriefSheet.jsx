import { useEffect, useMemo, useState } from 'react'
import { MapContainer, Polyline, CircleMarker, useMap } from 'react-leaflet'
import { MapLayers } from './MapView'
import { useMapLayer } from '../hooks/useMapLayer'
import { analyseFlight, toGpx, PHASES, PHASE_CSS, PHASE_CSS_DARK } from '../lib/flightAnalysis'
import { formatClock } from '../lib/flightTime'

const fmtTime = t => (t == null ? '—' : new Date(t).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }))
const fmtNum = (v, digits = 0, unit = '') => (v == null ? '—' : `${v.toFixed(digits)}${unit}`)

// Leaflet measures its container once, at construction. This map is built
// inside a sheet that is still animating in, so it measures 0x0 — and a map
// that believes it has no size loads no tiles and fits bounds to nothing. The
// symptom is a grey box with a fragment of track in it.
//
// invalidateSize() after paint is the fix, and the fit has to wait for it:
// fitting before the map knows its size just computes the wrong zoom.
function FitTrack({ positions }) {
  const map = useMap()
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      map.invalidateSize()
      if (positions.length > 1) map.fitBounds(positions, { padding: [24, 24] })
    })
    return () => cancelAnimationFrame(id)
  }, [map, positions])
  return null
}

/* ── One measure over time ─────────────────────────────────
   Deliberately its own chart. Altitude and groundspeed have unrelated scales,
   and putting them on one plot with two y-axes is the single most misleading
   thing a chart can do — the crossing point is an artefact of the scaling, and
   a pilot reading "speed overtook altitude here" would be reading nothing.
   Two charts, one axis each, sharing an x. ── */
function Series({ values, times, label, unit, color, scrubIndex, onScrub, digits = 0 }) {
  const W = 320, H = 84, PAD = 4
  const clean = values.map(v => (Number.isFinite(v) ? v : null))
  const present = clean.filter(v => v != null)
  if (present.length < 2) return null

  const min = Math.min(...present), max = Math.max(...present)
  const span = max - min || 1
  const x = i => PAD + (i / Math.max(1, clean.length - 1)) * (W - PAD * 2)
  const y = v => H - PAD - ((v - min) / span) * (H - PAD * 2)

  let d = '', pen = false
  clean.forEach((v, i) => {
    if (v == null) { pen = false; return }
    d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)} `
    pen = true
  })

  const at = clean[scrubIndex]

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        {/* One series, so the title names it and no legend box is needed. */}
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>{label}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
          {at == null ? '—' : `${at.toFixed(digits)} ${unit}`}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none"
        onPointerDown={e => {
          const r = e.currentTarget.getBoundingClientRect()
          onScrub(Math.round(((e.clientX - r.left) / r.width) * (clean.length - 1)))
        }}
        style={{ display: 'block', touchAction: 'none', cursor: 'crosshair' }}>
        {/* Recessive baseline — present for reference, never competing with the data. */}
        <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="var(--border)" strokeWidth="1" />
        <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {at != null && (
          <>
            <line x1={x(scrubIndex)} y1={PAD} x2={x(scrubIndex)} y2={H - PAD} stroke="var(--text-tertiary)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            {/* 2px surface ring, so the marker reads over the line it sits on. */}
            <circle cx={x(scrubIndex)} cy={y(at)} r="4.5" fill={color} stroke="var(--bg-card)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          </>
        )}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-tertiary)', fontVariantNumeric: 'tabular-nums' }}>
        <span>{fmtTime(times[0])}</span>
        <span>{fmtTime(times[times.length - 1])}</span>
      </div>
    </div>
  )
}

/* ── The flight, phase by phase ─────────────────────────────
   Proportional to time, and labelled. The palette validator flagged three of
   the phase colours below 3:1 against a light surface, which obliges relief —
   so identity is carried by the text beneath, and the colour only reinforces
   it. Colour alone would fail anyone reading this in sunlight. ── */
function PhaseTimeline({ segments, totalMs, startedAt, scrubTime, onScrubTime }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>Phases</div>
      <div
        onPointerDown={e => {
          const r = e.currentTarget.getBoundingClientRect()
          onScrubTime(startedAt + ((e.clientX - r.left) / r.width) * totalMs)
        }}
        style={{ display: 'flex', height: 16, borderRadius: 8, overflow: 'hidden', cursor: 'crosshair', touchAction: 'none', position: 'relative' }}>
        {segments.map((s, i) => (
          <div
            key={i}
            title={`${PHASES[s.phase].label} · ${formatClock(s.durationMs)}`}
            style={{
              width: `${Math.max(0.4, (s.durationMs / totalMs) * 100)}%`,
              background: `var(--phase-${s.phase})`,
              // A 2px surface gap between adjacent fills, so segments read as
              // separate rather than as one smeared bar.
              borderRight: i === segments.length - 1 ? 'none' : '2px solid var(--bg-card)',
            }}
          />
        ))}
        <div style={{
          position: 'absolute', top: 0, bottom: 0,
          left: `${Math.min(100, Math.max(0, ((scrubTime - startedAt) / totalMs) * 100))}%`,
          width: 2, background: 'var(--text)', pointerEvents: 'none',
        }} />
      </div>
      {/* Identity in text, never colour alone. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', marginTop: 8 }}>
        {[...new Set(segments.map(s => s.phase))].map(p => (
          <span key={p} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-secondary)' }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: `var(--phase-${p})`, flexShrink: 0 }} />
            {PHASES[p].label}
          </span>
        ))}
      </div>
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 1 }}>{label}</div>
    </div>
  )
}

export default function FlightDebriefSheet({ entry, onClose }) {
  const { layer } = useMapLayer()
  const a = useMemo(() => analyseFlight(entry), [entry])
  const [scrubIndex, setScrubIndex] = useState(0)

  if (!a) {
    return (
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg)', borderRadius: 16, padding: 24, fontSize: 13, color: 'var(--text-secondary)' }}>
          This flight has no track to debrief.
        </div>
      </div>
    )
  }

  const positions = a.track.map(p => [p.lat, p.lon])
  const times = a.track.map(p => p.t)
  const scrubbed = a.track[Math.min(scrubIndex, a.track.length - 1)]

  function scrubToTime(t) {
    let best = 0, bestD = Infinity
    times.forEach((v, i) => { const d = Math.abs(v - t); if (d < bestD) { bestD = d; best = i } })
    setScrubIndex(best)
  }

  function downloadGpx() {
    const gpx = toGpx(entry, { name: `AVIARA ${entry.date ?? 'flight'}` })
    if (!gpx) return
    const url = URL.createObjectURL(new Blob([gpx], { type: 'application/gpx+xml' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `aviara-${entry.date ?? 'flight'}.gpx`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 560, background: 'var(--bg)',
        borderTopLeftRadius: 22, borderTopRightRadius: 22,
        padding: '16px 16px calc(var(--safe-bottom) + 16px)',
        maxHeight: '94dvh', overflowY: 'auto', boxSizing: 'border-box',
      }}>
        <style>{`
          .debrief { ${PHASE_CSS} }
          [data-theme="dark"] .debrief { ${PHASE_CSS_DARK} }
          @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .debrief { ${PHASE_CSS_DARK} } }
        `}</style>

        <div className="debrief">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ fontSize: 17, fontWeight: 800, color: 'var(--text)' }}>Debrief</span>
            <button onClick={onClose} aria-label="Close" style={{
              width: 30, height: 30, borderRadius: '50%', border: 'none',
              background: 'var(--bg-card-2)', color: 'var(--text)', cursor: 'pointer', fontSize: 16,
            }}>×</button>
          </div>

          <div style={{ height: 220, borderRadius: 14, overflow: 'hidden', marginBottom: 12 }}>
            <MapContainer center={positions[0]} zoom={11} style={{ width: '100%', height: '100%' }}
              attributionControl={false} zoomControl={false} dragging={false} scrollWheelZoom={false} doubleClickZoom={false} touchZoom={false}>
              <MapLayers layer={layer} />
              <FitTrack positions={positions} />
              {/* One polyline per phase run, so the ground track carries the
                  same encoding the timeline does. */}
              {a.segments.map((s, i) => (
                <Polyline key={i} positions={positions.slice(s.from, s.to + 2)}
                  pathOptions={{ color: PHASES[s.phase].color, weight: 4, opacity: 0.95, lineCap: 'round' }} />
              ))}
              <CircleMarker center={[scrubbed.lat, scrubbed.lon]} radius={6}
                pathOptions={{ color: '#fff', weight: 3, fillColor: 'var(--text)', fillOpacity: 1 }} />
            </MapContainer>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 14 }}>
            <Stat label="Air time" value={a.airTimeMs != null ? formatClock(a.airTimeMs) : '—'} />
            <Stat label="Distance" value={fmtNum(a.distanceNm, 1, ' NM')} />
            <Stat label="Max alt" value={fmtNum(a.maxAltFt, 0, ' ft')} />
            <Stat label="Max GS" value={fmtNum(a.maxSpeedKt, 0, ' kt')} />
            <Stat label="Wheels up" value={fmtTime(a.wheelsUp)} />
            <Stat label="Wheels down" value={fmtTime(a.wheelsDown)} />
            <Stat label="Max climb" value={fmtNum(a.maxClimbFpm, 0, ' fpm')} />
            <Stat label="Max desc" value={fmtNum(a.maxDescentFpm, 0, ' fpm')} />
          </div>

          <PhaseTimeline
            segments={a.segments} totalMs={a.recordedMs || 1}
            startedAt={a.track[0].t} scrubTime={scrubbed.t} onScrubTime={scrubToTime}
          />

          <Series label="Altitude" unit="ft" digits={0} color="var(--phase-climb)"
            values={a.track.map(p => p.altFt)} times={times} scrubIndex={scrubIndex} onScrub={setScrubIndex} />
          <Series label="Groundspeed" unit="kt" digits={0} color="var(--phase-cruise)"
            values={a.track.map(p => p.speedKt)} times={times} scrubIndex={scrubIndex} onScrub={setScrubIndex} />

          {/* Said plainly rather than implied. GPS altitude is the weakest
              number on this screen and a debrief that presented it as surveyed
              would be overselling what a phone knows. */}
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 12, lineHeight: 1.5 }}>
            Altitude and speed are from the phone's GPS, not the aircraft's instruments.
            Treat them as indicative{a.altitudeConfidence === 'partial' ? '; altitude was unavailable for part of this flight' : ''}.
          </div>

          <button onClick={downloadGpx} style={{
            width: '100%', padding: '12px', borderRadius: 'var(--r-sm)',
            border: '0.5px solid var(--border)', background: 'var(--bg-card-2)',
            color: 'var(--text)', fontSize: 14, fontWeight: 700, cursor: 'pointer',
          }}>Export GPX</button>
        </div>
      </div>
    </div>
  )
}
