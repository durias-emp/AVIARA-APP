import { useState, useEffect, useMemo } from 'react'
import { get, put } from '../../lib/db'
import { getWBConfig, calculateWB } from '../../lib/aircraftWB'
import { scopedSettingsKey } from '../../lib/aircraft'
import { useActiveAircraft } from '../../context/ActiveAircraft'
import { DoneButton } from './shared/ui'
import FuelConverter from '../../components/FuelConverter'

// ── Unit helpers ──────────────────────────────────────────────────────────────
const LBS_TO_KG = 0.453592
const IN_TO_CM  = 2.54

function toDisplay(val, type, metric) {
  if (val == null || isNaN(val) || !isFinite(val)) return '—'
  if (!metric) return val.toFixed(type === 'arm' || type === 'cg' ? 2 : 1)
  if (type === 'weight') return (val * LBS_TO_KG).toFixed(1)
  if (type === 'arm' || type === 'cg') return (val * IN_TO_CM).toFixed(2)
  return val.toFixed(2)
}

function unitLabel(type, metric) {
  if (metric) return { weight: 'kg', arm: 'cm', cg: 'cm' }[type] ?? ''
  return { weight: 'lbs', arm: 'in', cg: 'in' }[type] ?? ''
}

// ── Number input ──────────────────────────────────────────────────────────────
function NumberInput({ value, onChange, unit, max }) {
  return (
    <div style={{ position: 'relative', width: 90 }}>
      <input
        type="number" inputMode="decimal" min={0} max={max}
        placeholder="0" value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          width: '100%', padding: '7px 28px 7px 8px', borderRadius: 8,
          background: 'var(--bg-card-2)',
          color: 'var(--text)', fontSize: 16, textAlign: 'right',
          outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
        }}
      />
      <span style={{
        position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
        fontSize: 9, color: 'var(--text-tertiary)', pointerEvents: 'none',
      }}>{unit}</span>
    </div>
  )
}

// ── Table rows ────────────────────────────────────────────────────────────────
function TableRow({ label, sub, weight, longArm, latArm, highlight, dim, showLat = true }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: showLat ? '1fr 56px 56px 56px' : '1fr 56px 56px', padding: '7px 12px',
      opacity: dim ? 0.5 : 1,
      background: highlight ? 'var(--bg-card-2)' : 'transparent',
    }}>
      <div>
        <div style={{ fontSize: 10, fontWeight: highlight ? 700 : 600, color: 'var(--text-secondary)' }}>{label}</div>
        {sub && <div style={{ fontSize: 9, color: 'var(--text-tertiary)', marginTop: 1 }}>{sub}</div>}
      </div>
      <div style={{ fontSize: 10, textAlign: 'right', alignSelf: 'center', color: 'var(--text-secondary)' }}>{weight}</div>
      <div style={{ fontSize: 10, textAlign: 'right', alignSelf: 'center', color: 'var(--text-tertiary)' }}>{longArm}</div>
      {showLat && <div style={{ fontSize: 10, textAlign: 'right', alignSelf: 'center', color: 'var(--text-tertiary)' }}>{latArm}</div>}
    </div>
  )
}

function SummaryRow({ label, weight, longCG, latCG, longOK, latOK, overweight, isAllUp, unit, showLat = true }) {
  const cgOK = longOK && (showLat ? latOK : true) && !overweight
  const cols = [
    { label: 'Weight', value: weight, unit: unit.w, ok: !overweight },
    { label: 'Long CG', value: longCG, unit: unit.a, ok: longOK },
  ]
  if (showLat) cols.push({ label: 'Lat CG', value: latCG, unit: unit.a, ok: latOK })
  return (
    <div style={{
      padding: '9px 12px',
      background: isAllUp ? 'var(--bg-card-2)' : 'transparent',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text)' }}>{label}</div>
        <span style={{
          fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 8,
          background: cgOK ? 'var(--ok-light)' : 'var(--danger-light)',
          color: cgOK ? 'var(--ok)' : 'var(--danger)',
        }}>
          {cgOK ? 'OK' : overweight ? 'OVERWEIGHT' : 'OUT OF LIMITS'}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: cols.map(() => '1fr').join(' '), gap: 6 }}>
        {cols.map(col => (
          <div key={col.label}>
            <div style={{ fontSize: 8, color: 'var(--text-tertiary)', marginBottom: 1 }}>{col.label}</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: col.ok ? 'var(--text)' : 'var(--danger)' }}>
              {col.value} <span style={{ fontSize: 8, fontWeight: 400, color: 'var(--text-tertiary)' }}>{col.unit}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function Legend({ color, label, isRect }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <div style={{ width: isRect ? 10 : 8, height: isRect ? 6 : 8, borderRadius: isRect ? 2 : '50%', background: color, flexShrink: 0 }} />
      <span style={{ fontSize: 8, color: 'var(--text-tertiary)' }}>{label}</span>
    </div>
  )
}

// ── SVG Charts ────────────────────────────────────────────────────────────────
function LongCGChart({ cfg, result, ok }) {
  const { longChart, longEnvelope, maxTOW } = cfg
  const { cgMin, cgMax, wtMin, wtMax } = longChart
  const VW = 300, VH = 190
  const P = { t: 12, r: 16, b: 30, l: 44 }
  const CW = VW - P.l - P.r, CH = VH - P.t - P.b
  const px = cg => P.l + (cg - cgMin) / (cgMax - cgMin) * CW
  const py = w  => P.t + CH * (1 - (w - wtMin) / (wtMax - wtMin))

  const envPts = longEnvelope(cfg).map(([cg, w]) => `${px(cg).toFixed(1)},${py(w).toFixed(1)}`).join(' ')
  const cgTicks = []; for (let c = Math.ceil(cgMin); c <= cgMax; c++) cgTicks.push(c)
  const wtTicks = []; for (let w = Math.ceil(wtMin / 200) * 200; w <= wtMax; w += 200) wtTicks.push(w)

  const { zeroFuel, allUp, status } = result
  const hasZF = isFinite(zeroFuel.longCG) && zeroFuel.weight > 0
  const hasAU = isFinite(allUp.longCG) && allUp.weight > 0

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} style={{ width: '100%' }}>
      {cgTicks.map(cg => <line key={cg} x1={px(cg).toFixed(1)} y1={P.t} x2={px(cg).toFixed(1)} y2={P.t+CH} stroke="rgba(128,128,128,0.12)" strokeWidth={0.8} />)}
      {wtTicks.map(w  => <line key={w}  x1={P.l} y1={py(w).toFixed(1)} x2={P.l+CW} y2={py(w).toFixed(1)} stroke="rgba(128,128,128,0.12)" strokeWidth={0.8} />)}
      <polygon points={envPts} fill={ok ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)'} stroke={ok ? 'rgba(34,197,94,0.55)' : 'rgba(239,68,68,0.55)'} strokeWidth={1.5} strokeLinejoin="round" />
      <line x1={P.l} y1={py(maxTOW).toFixed(1)} x2={P.l+CW} y2={py(maxTOW).toFixed(1)} stroke="rgba(239,68,68,0.4)" strokeWidth={1} strokeDasharray="4,3" />
      <text x={P.l+CW-2} y={py(maxTOW)-3} textAnchor="end" fontSize={6} fill="rgba(239,68,68,0.6)">MAX TOW</text>
      <line x1={P.l} y1={P.t} x2={P.l} y2={P.t+CH+1} stroke="rgba(128,128,128,0.25)" strokeWidth={1} />
      <line x1={P.l-1} y1={P.t+CH} x2={P.l+CW} y2={P.t+CH} stroke="rgba(128,128,128,0.25)" strokeWidth={1} />
      {cgTicks.filter(cg => cg % 2 === 0).map(cg => <text key={cg} x={px(cg).toFixed(1)} y={P.t+CH+10} textAnchor="middle" fontSize={6.5} fill="var(--text-tertiary)">{cg}</text>)}
      {wtTicks.filter(w => w % 400 === 0).map(w => <text key={w} x={P.l-4} y={(py(w)+2.5).toFixed(1)} textAnchor="end" fontSize={6} fill="var(--text-tertiary)">{w}</text>)}
      <text x={P.l+CW/2} y={VH-1} textAnchor="middle" fontSize={6.5} fill="var(--text-tertiary)">Longitudinal CG (in)</text>
      <text x={8} y={P.t+CH/2} textAnchor="middle" fontSize={6.5} fill="var(--text-tertiary)" transform={`rotate(-90,8,${(P.t+CH/2).toFixed(1)})`}>Weight (lbs)</text>
      {hasZF && hasAU && <line x1={px(zeroFuel.longCG).toFixed(1)} y1={py(zeroFuel.weight).toFixed(1)} x2={px(allUp.longCG).toFixed(1)} y2={py(allUp.weight).toFixed(1)} stroke="rgba(128,128,128,0.25)" strokeWidth={1} strokeDasharray="3,2" />}
      {hasZF && <g><circle cx={px(zeroFuel.longCG).toFixed(1)} cy={py(zeroFuel.weight).toFixed(1)} r={4.5} fill={status.zfLongOK ? '#60a5fa' : '#ef4444'} stroke="var(--bg-card)" strokeWidth={0.8} /><text x={(px(zeroFuel.longCG)+7).toFixed(1)} y={(py(zeroFuel.weight)+2.5).toFixed(1)} fontSize={6.5} fill="var(--text-secondary)">ZF</text></g>}
      {hasAU  && <g><circle cx={px(allUp.longCG).toFixed(1)}    cy={py(allUp.weight).toFixed(1)}    r={4.5} fill={status.auLongOK ? '#a78bfa' : '#ef4444'} stroke="var(--bg-card)" strokeWidth={0.8} /><text x={(px(allUp.longCG)+7).toFixed(1)}    y={(py(allUp.weight)+2.5).toFixed(1)}    fontSize={6.5} fill="var(--text-secondary)">AU</text></g>}
    </svg>
  )
}

function LatCGChart({ cfg, result, ok }) {
  const { latChart, latEnvelope } = cfg
  const { longMin, longMax, latMin, latMax } = latChart
  const VW = 300, VH = 270
  const P = { t: 20, r: 22, b: 26, l: 44 }
  const CW = VW - P.l - P.r, CH = VH - P.t - P.b
  const py = longCG => P.t + (longCG - longMin) / (longMax - longMin) * CH
  const px = latCG  => P.l + (latCG  - latMin)  / (latMax  - latMin)  * CW

  const envPts = latEnvelope.map(([lat, longCG]) => `${px(lat).toFixed(1)},${py(longCG).toFixed(1)}`).join(' ')
  const longTicks = []; for (let v = Math.ceil(longMin); v <= longMax; v++) longTicks.push(v)
  const latTicks  = []; for (let v = Math.ceil(latMin);  v < latMax;   v++) latTicks.push(v)
  const LAT_AFT = latEnvelope[latEnvelope.length - 2][1]

  const { zeroFuel, allUp, status } = result
  const hasZF = isFinite(zeroFuel.longCG) && zeroFuel.weight > 0
  const hasAU = isFinite(allUp.longCG) && allUp.weight > 0

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} style={{ width: '100%' }}>
      {longTicks.map(v => <line key={v} x1={P.l} y1={py(v).toFixed(1)} x2={P.l+CW} y2={py(v).toFixed(1)} stroke="rgba(128,128,128,0.12)" strokeWidth={0.8} />)}
      {latTicks.map(v  => <line key={v} x1={px(v).toFixed(1)} y1={P.t} x2={px(v).toFixed(1)} y2={P.t+CH} stroke="rgba(128,128,128,0.12)" strokeWidth={0.8} />)}
      <line x1={px(0).toFixed(1)} y1={P.t} x2={px(0).toFixed(1)} y2={P.t+CH} stroke="rgba(128,128,128,0.18)" strokeWidth={0.8} strokeDasharray="4,3" />
      <polygon points={envPts} fill={ok ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)'} stroke={ok ? 'rgba(34,197,94,0.55)' : 'rgba(239,68,68,0.55)'} strokeWidth={1.5} strokeLinejoin="round" />
      <line x1={P.l} y1={P.t} x2={P.l} y2={P.t+CH+1} stroke="rgba(128,128,128,0.25)" strokeWidth={1} />
      <line x1={P.l-1} y1={P.t+CH} x2={P.l+CW} y2={P.t+CH} stroke="rgba(128,128,128,0.25)" strokeWidth={1} />
      {longTicks.filter(v => v % 2 === 0).map(v => <text key={v} x={P.l-4} y={(py(v)+2.5).toFixed(1)} textAnchor="end" fontSize={6} fill="var(--text-tertiary)">{v}</text>)}
      {latTicks.map(v => <text key={v} x={px(v).toFixed(1)} y={P.t+CH+10} textAnchor="middle" fontSize={6.5} fill="var(--text-tertiary)">{v}</text>)}
      <text x={P.l+CW/2} y={VH-1} textAnchor="middle" fontSize={6.5} fill="var(--text-tertiary)">Lateral CG (in)</text>
      <text x={8} y={P.t+CH/2} textAnchor="middle" fontSize={6.5} fill="var(--text-tertiary)" transform={`rotate(-90,8,${(P.t+CH/2).toFixed(1)})`}>Long CG (in)</text>
      <text x={P.l+CW/2} y={py(longMin)-4} textAnchor="middle" fontSize={7} fontWeight="600" fill="var(--text-tertiary)">Fwd</text>
      <text x={P.l+CW/2} y={py(LAT_AFT)+12} textAnchor="middle" fontSize={7} fontWeight="600" fill="var(--text-tertiary)">Aft</text>
      <text x={px(latMin+0.4)} y={P.t+CH/2+3} textAnchor="middle" fontSize={10} fontWeight="700" fill="rgba(128,128,128,0.12)">L</text>
      <text x={px(latMax-0.5)} y={P.t+CH/2+3} textAnchor="middle" fontSize={10} fontWeight="700" fill="rgba(128,128,128,0.12)">R</text>
      {hasZF && hasAU && <line x1={px(zeroFuel.latCG).toFixed(1)} y1={py(zeroFuel.longCG).toFixed(1)} x2={px(allUp.latCG).toFixed(1)} y2={py(allUp.longCG).toFixed(1)} stroke="rgba(128,128,128,0.25)" strokeWidth={1} strokeDasharray="3,2" />}
      {hasZF && <g><circle cx={px(zeroFuel.latCG).toFixed(1)} cy={py(zeroFuel.longCG).toFixed(1)} r={4.5} fill={status.zfLatOK && status.zfLongOK ? '#60a5fa' : '#ef4444'} stroke="var(--bg-card)" strokeWidth={0.8} /><text x={(px(zeroFuel.latCG)+7).toFixed(1)} y={(py(zeroFuel.longCG)+2.5).toFixed(1)} fontSize={6.5} fill="var(--text-secondary)">ZF</text></g>}
      {hasAU  && <g><circle cx={px(allUp.latCG).toFixed(1)}    cy={py(allUp.longCG).toFixed(1)}    r={4.5} fill={status.auLatOK && status.auLongOK ? '#a78bfa' : '#ef4444'} stroke="var(--bg-card)" strokeWidth={0.8} /><text x={(px(allUp.latCG)+7).toFixed(1)}    y={(py(allUp.longCG)+2.5).toFixed(1)}    fontSize={6.5} fill="var(--text-secondary)">AU</text></g>}
    </svg>
  )
}

// ── Main W&B checklist card ───────────────────────────────────────────────────
export default function WBChecklistItem({ item, isChecked, onToggle, ExpandableCard }) {
  const { aircraftId } = useActiveAircraft()
  const [open, setOpen]       = useState(false)
  const [metric, setMetric]   = useState(false)
  const [cfg, setCfg]         = useState(null)
  const [doors, setDoors]     = useState({ frontLeft: true, frontRight: true, rearLeft: true, rearRight: true })
  const [weights, setWeights] = useState({})
  const [showFuelConv, setShowFuelConv] = useState(false)

  useEffect(() => {
    if (!aircraftId) { setCfg(null); return }
    get('aircraft', aircraftId).then(p => {
      const config = p ? getWBConfig(p) : null
      setCfg(config)
      if (config) {
        const blank = {}
        config.stations.forEach(s => { blank[s.id] = '' })
        blank.fuel = ''
        setWeights(blank)
      }
    })
  }, [aircraftId])

  const result = useMemo(() => {
    if (!cfg) return null
    return calculateWB(cfg, weights, doors)
  }, [cfg, weights, doors])

  function setW(id, val) { setWeights(p => ({ ...p, [id]: val })) }
  function toggleDoor(key) { setDoors(p => ({ ...p, [key]: !p[key] })) }

  const wU = unitLabel('weight', metric)
  const aU = unitLabel('arm', metric)
  const overallOK = result && !result.status.overweight
    && result.status.zfLongOK && result.status.zfLatOK
    && result.status.auLongOK && result.status.auLatOK

  // Souls on board: pilot-entered headcount, not derivable from station
  // weights alone (a station can be loaded with baggage, not a person).
  const [souls, setSouls] = useState('')
  useEffect(() => {
    get('settings', scopedSettingsKey('lastWB', aircraftId)).then(saved => { if (saved?.souls != null) setSouls(String(saved.souls)) })
  }, [aircraftId])

  // Expose the computed takeoff weight, CG, and envelope status so the
  // Performance section's distance calculator and the Flight Plan one-pager
  // can both read the pilot's actual current numbers instead of recomputing.
  useEffect(() => {
    if (result?.allUp?.weight > 0) {
      put('settings', {
        key: scopedSettingsKey('lastWB', aircraftId),
        weight: result.allUp.weight,
        maxTOW: cfg?.maxTOW ?? null,
        longCG: isFinite(result.allUp.longCG) ? result.allUp.longCG : null,
        latCG: isFinite(result.allUp.latCG) ? result.allUp.latCG : null,
        withinEnvelope: overallOK,
        souls: souls !== '' ? parseInt(souls, 10) : null,
      }).catch(() => {})
    }
  }, [result, cfg, overallOK, souls, aircraftId])

  return (
    <ExpandableCard item={item} isChecked={isChecked} onToggle={onToggle} open={open} setOpen={setOpen}>
      <div style={{ padding: '0 0 12px' }}>

        {/* No config state */}
        {!cfg && (
          <div style={{ padding: '20px 14px', textAlign: 'center' }}>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Weight &amp; Balance is not configured for this aircraft.
            </div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)', marginTop: 8 }}>
              Set up Weight &amp; Balance in Aircraft Profile.
            </div>
          </div>
        )}

        {cfg && (
          <>
            {/* Aircraft banner + unit toggle */}
            <div style={{ padding: '10px 14px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>{cfg.name}</div>
                <div style={{ fontSize: 9, color: 'var(--text-tertiary)', marginTop: 1 }}>
                  BEW {toDisplay(cfg.bew.weight, 'weight', metric)} {wU} · Max TOW {toDisplay(cfg.maxTOW, 'weight', metric)} {wU}
                </div>
              </div>
              <button onClick={() => setMetric(m => !m)} style={{
                padding: '4px 8px', borderRadius: 8, fontSize: 9, fontWeight: 700,
                background: metric ? 'var(--accent-light)' : 'var(--bg-card-2)',
                color: metric ? 'var(--accent)' : 'var(--text-tertiary)',
                cursor: 'pointer', fontFamily: 'inherit',
              }}>
                {metric ? 'kg · cm' : 'lbs · in'}
              </button>
            </div>

            {/* Divider */}
            <div style={{ height: '0.5px', background: 'var(--border)', margin: '0 14px 10px' }} />

            {/* Door configuration */}
            {cfg.hasDoors && (
              <div style={{ padding: '0 14px 10px' }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>
                  Door Configuration
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  {Object.entries(cfg.doors).map(([key, d]) => {
                    const on = doors[key] !== false
                    return (
                      <button key={key} onClick={() => toggleDoor(key)} style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '7px 10px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit',
                        background: on ? 'var(--bg-card-2)' : 'rgba(239,68,68,0.06)',
                        border: `0.5px solid ${on ? 'var(--border)' : 'rgba(239,68,68,0.3)'}`,
                      }}>
                        <span style={{ fontSize: 11, fontWeight: 600, color: on ? 'var(--text-secondary)' : '#f87171' }}>
                          {d.label}
                        </span>
                        <span style={{
                          fontSize: 8, fontWeight: 700, padding: '1px 5px', borderRadius: 5,
                          background: on ? 'var(--ok-light)' : 'rgba(239,68,68,0.15)',
                          color: on ? 'var(--ok)' : '#f87171',
                        }}>
                          {on ? 'ON' : 'OFF'}
                        </span>
                      </button>
                    )
                  })}
                </div>
                {result?.limits.anyFrontDoorOff && (
                  <div style={{ fontSize: 9, color: 'var(--warn)', marginTop: 6 }}>
                    Forward door(s) off. Fwd CG limit changes to 111.6 in
                  </div>
                )}
                <div style={{ height: '0.5px', background: 'var(--border)', marginTop: 10 }} />
              </div>
            )}

            {/* Occupants & payload */}
            <div style={{ padding: '0 14px 10px' }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>
                Occupants & Payload
              </div>
              {cfg.stations.map(s => (
                <div key={s.id} style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0',
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{s.label}</div>
                    <div style={{ fontSize: 9, color: 'var(--text-tertiary)', marginTop: 1 }}>
                      {s.sub}{s.maxWeight ? ` · max ${s.maxWeight} lbs` : ''}
                    </div>
                  </div>
                  <NumberInput value={weights[s.id] ?? ''} onChange={v => setW(s.id, v)} unit={metric ? 'kg' : 'lbs'} max={s.maxWeight} />
                </div>
              ))}
              {/* Fuel */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', marginTop: 2 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>Fuel</div>
                  <div style={{ fontSize: 9, color: 'var(--text-tertiary)', marginTop: 1 }}>{cfg.fuel.label}</div>
                </div>
                <NumberInput value={weights.fuel ?? ''} onChange={v => setW('fuel', v)} unit={cfg.fuel.unit} max={cfg.fuel.maxGal} />
              </div>
              <button
                onClick={() => setShowFuelConv(v => !v)}
                style={{
                  width: '100%', padding: '7px 0', marginTop: 4,
                  borderRadius: 'var(--r-sm)',
                  background: 'var(--bg-card-2)', color: 'var(--text-secondary)',
                  fontSize: 11, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
                }}>
                {showFuelConv ? 'Hide' : 'Show'} Fuel Unit Converter (Jet-A)
              </button>
              {showFuelConv && (
                <div style={{ marginTop: 8 }}>
                  <FuelConverter />
                </div>
              )}
            </div>

            {/* Results */}
            {result?.status.hasData && (
              <>
                {/* Summary table */}
                <div style={{ padding: '10px 14px 10px' }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>
                    Weight & Moment Summary
                  </div>
                  <div style={{ borderRadius: 12, overflow: 'hidden' }}>
                    {/* Header */}
                    <div style={{ display: 'grid', gridTemplateColumns: cfg.hasLateral ? '1fr 56px 56px 56px' : '1fr 56px 56px', padding: '5px 12px', background: 'var(--bg-card-2)' }}>
                      {(cfg.hasLateral ? ['Item', wU, `Arm ${aU}`, `Lat ${aU}`] : ['Item', wU, `Arm ${aU}`]).map((h, i) => (
                        <div key={h} style={{ fontSize: 8, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: i > 0 ? 'right' : 'left' }}>{h}</div>
                      ))}
                    </div>
                    <TableRow label="Basic Empty Wt" sub={`Long CG ${toDisplay(cfg.bew.longArm, 'arm', metric)} ${aU}`}
                      weight={toDisplay(result.adjBEW.weight, 'weight', metric)}
                      longArm={toDisplay(cfg.bew.longArm, 'arm', metric)}
                      latArm={toDisplay(cfg.bew.latArm, 'arm', metric)} highlight showLat={cfg.hasLateral} />
                    {result.removedDoors.map(d => (
                      <TableRow key={d.label} label={`− ${d.label}`} sub="Door off"
                        weight={toDisplay(d.weight, 'weight', metric)}
                        longArm={toDisplay(d.longArm, 'arm', metric)}
                        latArm={toDisplay(d.latArm, 'arm', metric)} dim showLat={cfg.hasLateral} />
                    ))}
                    {result.items.map(item => (
                      <TableRow key={item.label} label={item.label} sub={item.sub}
                        weight={toDisplay(item.weight, 'weight', metric)}
                        longArm={toDisplay(item.longArm, 'arm', metric)}
                        latArm={toDisplay(item.latArm, 'arm', metric)} showLat={cfg.hasLateral} />
                    ))}
                    <SummaryRow label="Zero Fuel Weight"
                      weight={toDisplay(result.zeroFuel.weight, 'weight', metric)}
                      longCG={toDisplay(result.zeroFuel.longCG, 'cg', metric)}
                      latCG={toDisplay(result.zeroFuel.latCG, 'cg', metric)}
                      longOK={result.status.zfLongOK} latOK={result.status.zfLatOK}
                      unit={{ w: wU, a: aU }} showLat={cfg.hasLateral} />
                    {result.fuel && (
                      <TableRow label={result.fuel.label} sub="Main tank"
                        weight={toDisplay(result.fuel.weight, 'weight', metric)}
                        longArm={toDisplay(result.fuel.longArm, 'arm', metric)}
                        latArm={toDisplay(result.fuel.latArm, 'arm', metric)} showLat={cfg.hasLateral} />
                    )}
                    <SummaryRow label="All Up Weight" isAllUp
                      weight={toDisplay(result.allUp.weight, 'weight', metric)}
                      longCG={toDisplay(result.allUp.longCG, 'cg', metric)}
                      latCG={toDisplay(result.allUp.latCG, 'cg', metric)}
                      longOK={result.status.auLongOK} latOK={result.status.auLatOK}
                      overweight={result.status.overweight}
                      unit={{ w: wU, a: aU }} showLat={cfg.hasLateral} />
                  </div>
                </div>

                {/* Longitudinal chart */}
                <div style={{ padding: '0 14px 10px' }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>
                    CG Envelope Longitudinal
                  </div>
                  <div style={{ borderRadius: 12, padding: 10 }}>
                    <LongCGChart cfg={cfg} result={result} ok={overallOK} />
                    <div style={{ display: 'flex', gap: 12, marginTop: 6, paddingLeft: 2 }}>
                      <Legend color="#60a5fa" label="Zero Fuel" />
                      <Legend color="#a78bfa" label="All Up" />
                      <Legend color={overallOK ? 'rgba(34,197,94,0.6)' : 'rgba(239,68,68,0.6)'} label="Envelope" isRect />
                    </div>
                  </div>
                </div>

                {/* Lateral chart, only for aircraft with lateral CG data */}
                {cfg.hasLateral && (
                  <div style={{ padding: '0 14px 10px' }}>
                    <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>
                      CG Envelope Lateral vs Longitudinal
                    </div>
                    <div style={{ borderRadius: 12, padding: 10 }}>
                      <LatCGChart cfg={cfg} result={result} ok={overallOK} />
                      <div style={{ display: 'flex', gap: 12, marginTop: 6, paddingLeft: 2 }}>
                        <Legend color="#60a5fa" label="Zero Fuel" />
                        <Legend color="#a78bfa" label="All Up" />
                        <Legend color={overallOK ? 'rgba(34,197,94,0.6)' : 'rgba(239,68,68,0.6)'} label="Envelope" isRect />
                      </div>
                    </div>
                  </div>
                )}

                {/* Status banner: bottom, charcoal card, only checkmark is colored */}
                <div style={{ margin: '0 14px 10px' }}>
                  <div style={{
                    background: 'var(--bg-card-2)',
                    borderRadius: 12, padding: '10px 12px',
                    display: 'flex', alignItems: 'center', gap: 10,
                  }}>
                    <div style={{
                      width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                      background: overallOK ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.12)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {overallOK ? (
                        <svg viewBox="0 0 24 24" fill="none" stroke="var(--ok)" strokeWidth={2.5} strokeLinecap="round" width={13} height={13}><path d="M20 6L9 17l-5-5" /></svg>
                      ) : (
                        <svg viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth={2.5} strokeLinecap="round" width={13} height={13}><path d="M18 6L6 18M6 6l12 12" /></svg>
                      )}
                    </div>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>
                        {overallOK ? 'Weight & Balance OK' : 'Out of Limits'}
                      </div>
                      <div style={{ fontSize: 10, marginTop: 1, color: 'var(--text-secondary)' }}>
                        {result.status.overweight
                          ? `Overweight by ${toDisplay(result.allUp.weight - cfg.maxTOW, 'weight', metric)} ${wU}`
                          : overallOK ? 'CG within all limits' : 'Review CG. Check charts above'}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Souls on board. Used by the Flight Plan one-pager and, if filing,
                    matches the ICAO flight-plan "persons on board" item. */}
                <div style={{ margin: '0 14px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  background: 'var(--bg-card-2)', borderRadius: 12, padding: '10px 12px' }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>Souls on Board</span>
                  <input
                    type="number" inputMode="numeric" min={1} value={souls}
                    onChange={e => setSouls(e.target.value)}
                    placeholder="—"
                    style={{
                      width: 56, textAlign: 'center', fontSize: 16, fontWeight: 700,
                      color: 'var(--text)', background: 'var(--bg-card)', borderRadius: 8, padding: '5px 0', outline: 'none', fontFamily: 'inherit',
                    }}
                  />
                </div>

                <div style={{ padding: '0 14px', fontSize: 8, color: 'var(--text-tertiary)', textAlign: 'center', lineHeight: 1.6 }}>
                  {cfg.ref} · For planning purposes only. PIC is responsible for verifying W&amp;B against
                  the aircraft POH/AFM and latest W&amp;B report. Use actual aircraft values, not generic model values.
                </div>
              </>
            )}

            {!result?.status.hasData && !isChecked && (
              <div style={{ padding: '12px 14px', textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Enter weights above to calculate</div>
              </div>
            )}

            {(result?.status.hasData || isChecked) && (
              <DoneButton isChecked={isChecked} onDone={() => { if (!isChecked) onToggle(item.id); setOpen(false) }}
                autoCheck onAutoComplete={() => onToggle(item.id)} />
            )}
          </>
        )}
      </div>
    </ExpandableCard>
  )
}
