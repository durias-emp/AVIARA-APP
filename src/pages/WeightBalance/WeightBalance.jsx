import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { get } from '../../lib/db'
import { getWBConfig } from '../../lib/aircraftWB'
import { BackButton } from '../../components/Shell'

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

// ── Calculation ───────────────────────────────────────────────────────────────
function calculate(cfg, weights, doors) {
  const { bew, fuel: fuelCfg, stations, doors: doorDefs, cgLimits, maxTOW } = cfg

  let adjW  = bew.weight
  let adjLM = bew.weight * bew.longArm
  let adjLaM = bew.weight * bew.latArm

  const removedDoors = []
  if (cfg.hasDoors) {
    Object.entries(doors).forEach(([key, isOn]) => {
      if (!isOn) {
        const d = doorDefs[key]
        adjW  -= d.weight
        adjLM -= d.weight * d.longArm
        adjLaM -= d.weight * d.latArm
        removedDoors.push({ label: d.label, weight: -d.weight, longArm: d.longArm, latArm: d.latArm })
      }
    })
  }

  const items = []
  let zfW = adjW, zfLM = adjLM, zfLaM = adjLaM
  stations.forEach(s => {
    const w = parseFloat(weights[s.id]) || 0
    if (w === 0) return
    items.push({ label: s.label, sub: s.sub, weight: w, longArm: s.longArm, latArm: s.latArm })
    zfW += w; zfLM += w * s.longArm; zfLaM += w * s.latArm
  })

  const zfLongCG = zfW > 0 ? zfLM / zfW : NaN
  const zfLatCG  = zfW > 0 ? zfLaM / zfW : NaN

  const fuelGal  = parseFloat(weights.fuel) || 0
  const fuelLbs  = fuelGal * fuelCfg.lbPerGal
  const auW      = zfW + fuelLbs
  const auLM     = zfLM + fuelLbs * fuelCfg.longArm
  const auLaM    = zfLaM + fuelLbs * fuelCfg.latArm
  const auLongCG = auW > 0 ? auLM / auW : NaN
  const auLatCG  = auW > 0 ? auLaM / auW : NaN

  const anyFrontDoorOff = cfg.hasFrontDoorEffect && (!doors.frontLeft || !doors.frontRight)
  const fwdLim  = cgLimits.longFwd(anyFrontDoorOff)
  const zfAft   = cgLimits.longAft(zfW)
  const auAft   = cgLimits.longAft(auW)
  const hasData = items.length > 0 || fuelLbs > 0

  return {
    adjBEW: { weight: adjW, longArm: bew.longArm, latArm: bew.latArm },
    removedDoors,
    items,
    fuel: fuelLbs > 0 ? { label: `Fuel (${fuelGal} ${fuelCfg.unit})`, weight: fuelLbs, longArm: fuelCfg.longArm, latArm: fuelCfg.latArm } : null,
    zeroFuel: { weight: zfW, longCG: zfLongCG, latCG: zfLatCG },
    allUp:    { weight: auW, longCG: auLongCG, latCG: auLatCG },
    limits:   { fwdLim, zfAft, auAft, anyFrontDoorOff },
    status: {
      hasData,
      overweight: auW > maxTOW,
      zfLongOK: isFinite(zfLongCG) && zfLongCG >= fwdLim && zfLongCG <= zfAft,
      zfLatOK:  isFinite(zfLatCG)  && zfLatCG  >= cgLimits.latLeft && zfLatCG <= cgLimits.latRight,
      auLongOK: isFinite(auLongCG) && auLongCG >= fwdLim && auLongCG <= auAft,
      auLatOK:  isFinite(auLatCG)  && auLatCG  >= cgLimits.latLeft && auLatCG <= cgLimits.latRight,
    },
  }
}

// ── Longitudinal CG chart ─────────────────────────────────────────────────────
function LongCGChart({ cfg, result }) {
  const { longChart, longEnvelope, maxTOW } = cfg
  const { cgMin, cgMax, wtMin, wtMax } = longChart

  const VW = 320, VH = 210
  const P = { t: 14, r: 18, b: 32, l: 46 }
  const CW = VW - P.l - P.r
  const CH = VH - P.t - P.b

  const px = cg => P.l + (cg - cgMin) / (cgMax - cgMin) * CW
  const py = w  => P.t + CH * (1 - (w - wtMin) / (wtMax - wtMin))

  const envPts = longEnvelope(cfg)
    .map(([cg, w]) => `${px(cg).toFixed(1)},${py(w).toFixed(1)}`).join(' ')

  const cgTicks = []
  for (let c = Math.ceil(cgMin); c <= cgMax; c++) cgTicks.push(c)
  const wtTicks = []
  for (let w = Math.ceil(wtMin / 200) * 200; w <= wtMax; w += 200) wtTicks.push(w)

  const { zeroFuel, allUp, status } = result
  const hasZF = isFinite(zeroFuel.longCG) && zeroFuel.weight > 0
  const hasAU = isFinite(allUp.longCG) && allUp.weight > 0

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} style={{ width: '100%' }}>
      {cgTicks.map(cg => (
        <line key={cg} x1={px(cg).toFixed(1)} y1={P.t} x2={px(cg).toFixed(1)} y2={P.t + CH}
          stroke="rgba(128,128,128,0.15)" strokeWidth={0.8} />
      ))}
      {wtTicks.map(w => (
        <line key={w} x1={P.l} y1={py(w).toFixed(1)} x2={P.l + CW} y2={py(w).toFixed(1)}
          stroke="rgba(128,128,128,0.15)" strokeWidth={0.8} />
      ))}

      <polygon points={envPts} fill="rgba(34,197,94,0.1)" stroke="rgba(34,197,94,0.55)"
        strokeWidth={1.5} strokeLinejoin="round" />

      <line x1={P.l} y1={py(maxTOW).toFixed(1)} x2={P.l + CW} y2={py(maxTOW).toFixed(1)}
        stroke="rgba(239,68,68,0.4)" strokeWidth={1} strokeDasharray="4,3" />
      <text x={P.l + CW - 2} y={py(maxTOW) - 3} textAnchor="end" fontSize={6.5}
        fill="rgba(239,68,68,0.6)">MAX TOW</text>

      <line x1={P.l} y1={P.t} x2={P.l} y2={P.t + CH + 1} stroke="rgba(128,128,128,0.3)" strokeWidth={1} />
      <line x1={P.l - 1} y1={P.t + CH} x2={P.l + CW} y2={P.t + CH} stroke="rgba(128,128,128,0.3)" strokeWidth={1} />

      {cgTicks.filter(cg => cg % 2 === 0).map(cg => (
        <text key={cg} x={px(cg).toFixed(1)} y={P.t + CH + 11} textAnchor="middle" fontSize={7}
          fill="var(--text-tertiary)">{cg}</text>
      ))}
      {wtTicks.filter(w => w % 400 === 0).map(w => (
        <text key={w} x={P.l - 5} y={(py(w) + 3).toFixed(1)} textAnchor="end" fontSize={6.5}
          fill="var(--text-tertiary)">{w}</text>
      ))}

      <text x={P.l + CW / 2} y={VH - 2} textAnchor="middle" fontSize={7} fill="var(--text-tertiary)">
        Longitudinal CG (in)
      </text>
      <text x={9} y={P.t + CH / 2} textAnchor="middle" fontSize={7} fill="var(--text-tertiary)"
        transform={`rotate(-90,9,${(P.t + CH / 2).toFixed(1)})`}>Weight (lbs)</text>

      {hasZF && hasAU && (
        <line x1={px(zeroFuel.longCG).toFixed(1)} y1={py(zeroFuel.weight).toFixed(1)}
              x2={px(allUp.longCG).toFixed(1)}    y2={py(allUp.weight).toFixed(1)}
          stroke="rgba(128,128,128,0.3)" strokeWidth={1} strokeDasharray="3,2" />
      )}
      {hasZF && (
        <g>
          <circle cx={px(zeroFuel.longCG).toFixed(1)} cy={py(zeroFuel.weight).toFixed(1)} r={5}
            fill={status.zfLongOK ? '#60a5fa' : '#ef4444'} stroke="var(--bg)" strokeWidth={0.8} />
          <text x={(px(zeroFuel.longCG) + 8).toFixed(1)} y={(py(zeroFuel.weight) + 3).toFixed(1)}
            fontSize={7} fill="var(--text-secondary)">ZF</text>
        </g>
      )}
      {hasAU && (
        <g>
          <circle cx={px(allUp.longCG).toFixed(1)} cy={py(allUp.weight).toFixed(1)} r={5}
            fill={status.auLongOK ? '#a78bfa' : '#ef4444'} stroke="var(--bg)" strokeWidth={0.8} />
          <text x={(px(allUp.longCG) + 8).toFixed(1)} y={(py(allUp.weight) + 3).toFixed(1)}
            fontSize={7} fill="var(--text-secondary)">AU</text>
        </g>
      )}
    </svg>
  )
}

// ── Lateral CG chart ──────────────────────────────────────────────────────────
function LatCGChart({ cfg, result }) {
  const { latChart, latEnvelope } = cfg
  const { longMin, longMax, latMin, latMax } = latChart

  const VW = 320, VH = 290
  const P = { t: 22, r: 24, b: 28, l: 46 }
  const CW = VW - P.l - P.r
  const CH = VH - P.t - P.b

  const py = longCG => P.t + (longCG - longMin) / (longMax - longMin) * CH
  const px = latCG  => P.l + (latCG - latMin)   / (latMax  - latMin)  * CW

  const envPts = latEnvelope
    .map(([lat, longCG]) => `${px(lat).toFixed(1)},${py(longCG).toFixed(1)}`).join(' ')

  const longTicks = []
  for (let v = Math.ceil(longMin); v <= longMax; v++) longTicks.push(v)
  const latTicks = []
  for (let v = Math.ceil(latMin); v < latMax; v++) latTicks.push(v)

  const { zeroFuel, allUp, status } = result
  const hasZF = isFinite(zeroFuel.longCG) && zeroFuel.weight > 0
  const hasAU = isFinite(allUp.longCG) && allUp.weight > 0
  const LAT_AFT = latEnvelope[latEnvelope.length - 2][1]

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} style={{ width: '100%' }}>
      {longTicks.map(v => (
        <line key={v} x1={P.l} y1={py(v).toFixed(1)} x2={P.l + CW} y2={py(v).toFixed(1)}
          stroke="rgba(128,128,128,0.15)" strokeWidth={0.8} />
      ))}
      {latTicks.map(v => (
        <line key={v} x1={px(v).toFixed(1)} y1={P.t} x2={px(v).toFixed(1)} y2={P.t + CH}
          stroke="rgba(128,128,128,0.15)" strokeWidth={0.8} />
      ))}

      <line x1={px(0).toFixed(1)} y1={P.t} x2={px(0).toFixed(1)} y2={P.t + CH}
        stroke="rgba(128,128,128,0.2)" strokeWidth={0.8} strokeDasharray="4,3" />

      <polygon points={envPts} fill="rgba(34,197,94,0.1)" stroke="rgba(34,197,94,0.55)"
        strokeWidth={1.5} strokeLinejoin="round" />

      <line x1={P.l} y1={P.t} x2={P.l} y2={P.t + CH + 1} stroke="rgba(128,128,128,0.3)" strokeWidth={1} />
      <line x1={P.l - 1} y1={P.t + CH} x2={P.l + CW} y2={P.t + CH} stroke="rgba(128,128,128,0.3)" strokeWidth={1} />

      {longTicks.filter(v => v % 2 === 0).map(v => (
        <text key={v} x={P.l - 4} y={(py(v) + 2.5).toFixed(1)} textAnchor="end" fontSize={6.5}
          fill="var(--text-tertiary)">{v}</text>
      ))}
      {latTicks.map(v => (
        <text key={v} x={px(v).toFixed(1)} y={P.t + CH + 10} textAnchor="middle" fontSize={7}
          fill="var(--text-tertiary)">{v}</text>
      ))}

      <text x={P.l + CW / 2} y={VH - 2} textAnchor="middle" fontSize={7} fill="var(--text-tertiary)">
        Lateral CG (in)
      </text>
      <text x={9} y={P.t + CH / 2} textAnchor="middle" fontSize={7} fill="var(--text-tertiary)"
        transform={`rotate(-90,9,${(P.t + CH / 2).toFixed(1)})`}>Long CG (in)</text>

      <text x={P.l + CW / 2} y={py(longMin) - 5} textAnchor="middle" fontSize={8} fontWeight="600"
        fill="var(--text-tertiary)">Fwd</text>
      <text x={P.l + CW / 2} y={py(LAT_AFT) + 13} textAnchor="middle" fontSize={8} fontWeight="600"
        fill="var(--text-tertiary)">Aft</text>
      <text x={px(latMin + 0.4)} y={P.t + CH / 2 + 4} textAnchor="middle" fontSize={11} fontWeight="700"
        fill="rgba(128,128,128,0.15)">L</text>
      <text x={px(latMax - 0.5)} y={P.t + CH / 2 + 4} textAnchor="middle" fontSize={11} fontWeight="700"
        fill="rgba(128,128,128,0.15)">R</text>

      {hasZF && hasAU && (
        <line x1={px(zeroFuel.latCG).toFixed(1)} y1={py(zeroFuel.longCG).toFixed(1)}
              x2={px(allUp.latCG).toFixed(1)}    y2={py(allUp.longCG).toFixed(1)}
          stroke="rgba(128,128,128,0.3)" strokeWidth={1} strokeDasharray="3,2" />
      )}
      {hasZF && (
        <g>
          <circle cx={px(zeroFuel.latCG).toFixed(1)} cy={py(zeroFuel.longCG).toFixed(1)} r={5}
            fill={status.zfLatOK && status.zfLongOK ? '#60a5fa' : '#ef4444'} stroke="var(--bg)" strokeWidth={0.8} />
          <text x={(px(zeroFuel.latCG) + 8).toFixed(1)} y={(py(zeroFuel.longCG) + 3).toFixed(1)}
            fontSize={7} fill="var(--text-secondary)">ZF</text>
        </g>
      )}
      {hasAU && (
        <g>
          <circle cx={px(allUp.latCG).toFixed(1)} cy={py(allUp.longCG).toFixed(1)} r={5}
            fill={status.auLatOK && status.auLongOK ? '#a78bfa' : '#ef4444'} stroke="var(--bg)" strokeWidth={0.8} />
          <text x={(px(allUp.latCG) + 8).toFixed(1)} y={(py(allUp.longCG) + 3).toFixed(1)}
            fontSize={7} fill="var(--text-secondary)">AU</text>
        </g>
      )}
    </svg>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────
function TableRow({ label, sub, weight, longArm, latArm, highlight, dim }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '1fr 60px 60px 60px', padding: '8px 14px',
      borderBottom: '0.5px solid var(--border)',
      opacity: dim ? 0.5 : 1,
      background: highlight ? 'var(--bg-card-2)' : 'transparent',
    }}>
      <div>
        <div style={{ fontSize: 11, fontWeight: highlight ? 700 : 600, color: 'var(--text-secondary)' }}>{label}</div>
        {sub && <div style={{ fontSize: 9, color: 'var(--text-tertiary)', marginTop: 1 }}>{sub}</div>}
      </div>
      <div style={{ fontSize: 11, textAlign: 'right', alignSelf: 'center', color: 'var(--text-secondary)' }}>{weight}</div>
      <div style={{ fontSize: 11, textAlign: 'right', alignSelf: 'center', color: 'var(--text-tertiary)' }}>{longArm}</div>
      <div style={{ fontSize: 11, textAlign: 'right', alignSelf: 'center', color: 'var(--text-tertiary)' }}>{latArm}</div>
    </div>
  )
}

function SummaryRow({ label, weight, longCG, latCG, longOK, latOK, overweight, isAllUp, unit }) {
  const cgOK = longOK && latOK && !overweight
  return (
    <div style={{
      padding: '10px 14px',
      background: isAllUp ? 'var(--bg-card-2)' : 'transparent',
      borderTop: '0.5px solid var(--border)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>{label}</div>
        <span style={{
          fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
          background: cgOK ? 'var(--ok-light)' : 'var(--danger-light)',
          color: cgOK ? 'var(--ok)' : 'var(--danger)',
        }}>
          {cgOK ? 'OK' : overweight ? 'OVERWEIGHT' : 'OUT OF LIMITS'}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        {[
          { label: 'Weight', value: weight, unit: unit.w, ok: !overweight },
          { label: 'Long CG', value: longCG, unit: unit.a, ok: longOK },
          { label: 'Lat CG',  value: latCG,  unit: unit.a, ok: latOK },
        ].map(col => (
          <div key={col.label}>
            <div style={{ fontSize: 9, color: 'var(--text-tertiary)', marginBottom: 2 }}>{col.label}</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: col.ok ? 'var(--text)' : 'var(--danger)' }}>
              {col.value} <span style={{ fontSize: 9, fontWeight: 400, color: 'var(--text-tertiary)' }}>{col.unit}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function Legend({ color, label, isRect }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{
        width: isRect ? 12 : 10, height: isRect ? 8 : 10,
        borderRadius: isRect ? 2 : '50%',
        background: color,
        flexShrink: 0,
      }} />
      <span style={{ fontSize: 9, color: 'var(--text-tertiary)' }}>{label}</span>
    </div>
  )
}

function NumberInput({ value, onChange, placeholder, unit, max }) {
  return (
    <div style={{ position: 'relative', width: 100 }}>
      <input
        type="number"
        inputMode="decimal"
        min={0}
        max={max}
        placeholder={placeholder ?? '0'}
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          width: '100%', padding: '9px 32px 9px 10px', borderRadius: 10,
          border: '0.5px solid var(--border)', background: 'var(--bg-card-2)',
          color: 'var(--text)', fontSize: 14, textAlign: 'right',
          outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
        }}
      />
      <span style={{
        position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
        fontSize: 9, color: 'var(--text-tertiary)', pointerEvents: 'none',
      }}>{unit}</span>
    </div>
  )
}

// ── Not-available state ───────────────────────────────────────────────────────
function NoConfig({ aircraftLabel }) {
  return (
    <div style={{ padding: '40px 24px', textAlign: 'center' }}>
      <div style={{ fontSize: 32, marginBottom: 12 }}>
        <svg width={40} height={40} viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)"
          strokeWidth={1.5} strokeLinecap="round" style={{ margin: '0 auto', display: 'block' }}>
          <path d="M12 2a10 10 0 100 20A10 10 0 0012 2zM12 8v4M12 16h.01" />
        </svg>
      </div>
      <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>
        W&B not available
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 4 }}>
        No weight & balance data configured for{aircraftLabel ? ` "${aircraftLabel}"` : ' this aircraft'}.
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
        Currently supported: Bell 206B-3 JetRanger.
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function WeightBalance() {
  const navigate = useNavigate()
  const [aircraftProfile, setAircraftProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [metric, setMetric] = useState(false)
  const [doors, setDoors] = useState({ frontLeft: true, frontRight: true, rearLeft: true, rearRight: true })
  const [weights, setWeights] = useState({})

  useEffect(() => {
    get('aircraft', 'profile').then(p => {
      setAircraftProfile(p ?? {})
      setLoading(false)
    })
  }, [])

  const cfg = aircraftProfile ? getWBConfig(aircraftProfile.label) : null

  // Reset weight inputs when aircraft changes
  useEffect(() => {
    if (!cfg) return
    const blank = {}
    cfg.stations.forEach(s => { blank[s.id] = '' })
    blank.fuel = ''
    setWeights(blank)
    if (!cfg.hasDoors) setDoors({})
  }, [cfg?.name])

  const result = useMemo(() => {
    if (!cfg) return null
    return calculate(cfg, weights, doors)
  }, [cfg, weights, doors])

  function setW(id, val) { setWeights(p => ({ ...p, [id]: val })) }
  function toggleDoor(key) { setDoors(p => ({ ...p, [key]: !p[key] })) }

  if (loading) return null

  const wU = unitLabel('weight', metric)
  const aU = unitLabel('arm', metric)

  const overallOK = result && !result.status.overweight
    && result.status.zfLongOK && result.status.zfLatOK
    && result.status.auLongOK && result.status.auLatOK

  return (
    <div style={{ padding: '0 0 40px' }}>
      {/* Header */}
      <div style={{
        padding: '18px 18px 14px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <BackButton />
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.4px' }}>
            Weight & Balance
          </div>
        </div>
        {cfg && (
          <button
            onClick={() => setMetric(m => !m)}
            style={{
              padding: '5px 10px', borderRadius: 10, fontSize: 10, fontWeight: 700,
              border: '0.5px solid var(--border)',
              background: metric ? 'var(--accent-light)' : 'var(--bg-card)',
              color: metric ? 'var(--accent)' : 'var(--text-tertiary)',
              cursor: 'pointer', fontFamily: 'inherit',
            }}>
            {metric ? 'kg · cm' : 'lbs · in'}
          </button>
        )}
      </div>

      {!cfg ? (
        <NoConfig aircraftLabel={aircraftProfile?.label} />
      ) : (
        <div style={{ padding: '0 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Aircraft info card */}
          <div style={{
            background: 'var(--bg-card)', border: '0.5px solid var(--border)', borderRadius: 16,
            padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{cfg.name}</div>
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
                BEW {toDisplay(cfg.bew.weight, 'weight', metric)} {wU}
                {' · '} Max TOW {toDisplay(cfg.maxTOW, 'weight', metric)} {wU}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 9, color: 'var(--text-tertiary)' }}>BEW Long CG</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>
                {toDisplay(cfg.bew.longArm, 'arm', metric)} {aU}
              </div>
            </div>
          </div>

          {/* Doors (if applicable) */}
          {cfg.hasDoors && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>
                Door Configuration
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {Object.entries(cfg.doors).map(([key, d]) => {
                  const on = doors[key] !== false
                  return (
                    <button key={key} onClick={() => toggleDoor(key)} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '10px 12px', borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit',
                      background: on ? 'var(--bg-card)' : 'rgba(239,68,68,0.06)',
                      border: `0.5px solid ${on ? 'var(--border)' : 'rgba(239,68,68,0.3)'}`,
                    }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: on ? 'var(--text-secondary)' : '#f87171' }}>
                        {d.label}
                      </span>
                      <span style={{
                        fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 6,
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
                <div style={{ fontSize: 10, color: 'var(--warn)', marginTop: 8, paddingLeft: 4 }}>
                  Forward door(s) off — fwd CG limit changes to 111.6 in
                </div>
              )}
            </div>
          )}

          {/* Occupants & Payload */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>
              Occupants & Payload
            </div>
            <div style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)', borderRadius: 16, overflow: 'hidden' }}>
              {cfg.stations.map((s, i) => (
                <div key={s.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
                  borderBottom: i < cfg.stations.length - 1 ? '0.5px solid var(--border)' : 'none',
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{s.label}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 1 }}>
                      {s.sub}{s.maxWeight ? ` · max ${s.maxWeight} lbs` : ''}
                    </div>
                  </div>
                  <NumberInput
                    value={weights[s.id] ?? ''}
                    onChange={v => setW(s.id, v)}
                    unit={metric ? 'kg' : 'lbs'}
                    max={s.maxWeight}
                  />
                </div>
              ))}

              {/* Fuel row */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
                borderTop: '0.5px solid var(--border)',
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Fuel</div>
                  <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 1 }}>{cfg.fuel.label}</div>
                </div>
                <NumberInput
                  value={weights.fuel ?? ''}
                  onChange={v => setW('fuel', v)}
                  unit={cfg.fuel.unit}
                  max={cfg.fuel.maxGal}
                />
              </div>
            </div>
          </div>

          {/* Results */}
          {result?.status.hasData && (
            <>
              {/* Summary table */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>
                  Weight & Moment Summary
                </div>
                <div style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)', borderRadius: 16, overflow: 'hidden' }}>
                  {/* Table header */}
                  <div style={{
                    display: 'grid', gridTemplateColumns: '1fr 60px 60px 60px',
                    padding: '6px 14px', background: 'var(--bg-card-2)',
                    borderBottom: '0.5px solid var(--border)',
                  }}>
                    {['Item', wU, `L.Arm ${aU}`, `Lat ${aU}`].map((h, i) => (
                      <div key={h} style={{
                        fontSize: 9, fontWeight: 700, color: 'var(--text-tertiary)',
                        textTransform: 'uppercase', letterSpacing: '0.06em',
                        textAlign: i > 0 ? 'right' : 'left',
                      }}>{h}</div>
                    ))}
                  </div>

                  <TableRow label="Basic Empty Wt" sub={`Long CG ${toDisplay(cfg.bew.longArm, 'arm', metric)} ${aU}`}
                    weight={toDisplay(result.adjBEW.weight, 'weight', metric)}
                    longArm={toDisplay(cfg.bew.longArm, 'arm', metric)}
                    latArm={toDisplay(cfg.bew.latArm, 'arm', metric)} highlight />

                  {result.removedDoors.map(d => (
                    <TableRow key={d.label} label={`− ${d.label} (removed)`} sub="Door off"
                      weight={toDisplay(d.weight, 'weight', metric)}
                      longArm={toDisplay(d.longArm, 'arm', metric)}
                      latArm={toDisplay(d.latArm, 'arm', metric)} dim />
                  ))}

                  {result.items.map(item => (
                    <TableRow key={item.label} label={item.label} sub={item.sub}
                      weight={toDisplay(item.weight, 'weight', metric)}
                      longArm={toDisplay(item.longArm, 'arm', metric)}
                      latArm={toDisplay(item.latArm, 'arm', metric)} />
                  ))}

                  <SummaryRow label="Zero Fuel Weight"
                    weight={toDisplay(result.zeroFuel.weight, 'weight', metric)}
                    longCG={toDisplay(result.zeroFuel.longCG, 'cg', metric)}
                    latCG={toDisplay(result.zeroFuel.latCG, 'cg', metric)}
                    longOK={result.status.zfLongOK} latOK={result.status.zfLatOK}
                    unit={{ w: wU, a: aU }} />

                  {result.fuel && (
                    <TableRow label={result.fuel.label} sub="Main tank"
                      weight={toDisplay(result.fuel.weight, 'weight', metric)}
                      longArm={toDisplay(result.fuel.longArm, 'arm', metric)}
                      latArm={toDisplay(result.fuel.latArm, 'arm', metric)} />
                  )}

                  <SummaryRow label="All Up Weight" isAllUp
                    weight={toDisplay(result.allUp.weight, 'weight', metric)}
                    longCG={toDisplay(result.allUp.longCG, 'cg', metric)}
                    latCG={toDisplay(result.allUp.latCG, 'cg', metric)}
                    longOK={result.status.auLongOK} latOK={result.status.auLatOK}
                    overweight={result.status.overweight}
                    unit={{ w: wU, a: aU }} />
                </div>
              </div>

              {/* Overall status banner */}
              <div style={{
                background: overallOK ? 'var(--ok-light)' : 'var(--danger-light)',
                border: `0.5px solid ${overallOK ? 'var(--ok)' : 'var(--danger)'}`,
                borderRadius: 16, padding: '12px 16px',
                display: 'flex', alignItems: 'center', gap: 12,
              }}>
                <div style={{
                  width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                  background: overallOK ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {overallOK ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="var(--ok)" strokeWidth={2.5}
                      strokeLinecap="round" width={16} height={16}>
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth={2.5}
                      strokeLinecap="round" width={16} height={16}>
                      <path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                    </svg>
                  )}
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: overallOK ? 'var(--ok)' : 'var(--danger)' }}>
                    {overallOK ? 'Weight & Balance OK' : 'Out of Limits'}
                  </div>
                  <div style={{ fontSize: 11, marginTop: 2, color: overallOK ? 'var(--ok)' : 'var(--danger)', opacity: 0.7 }}>
                    {result.status.overweight
                      ? `Overweight by ${toDisplay(result.allUp.weight - cfg.maxTOW, 'weight', metric)} ${wU}`
                      : overallOK
                        ? 'CG within all limits for current configuration'
                        : 'Review CG — check charts below'}
                  </div>
                </div>
              </div>

              {/* Longitudinal chart */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>
                  CG Envelope — Longitudinal
                </div>
                <div style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)', borderRadius: 16, padding: 12 }}>
                  <LongCGChart cfg={cfg} result={result} />
                  <div style={{ display: 'flex', gap: 16, marginTop: 8, paddingLeft: 4 }}>
                    <Legend color="#60a5fa" label="Zero Fuel" />
                    <Legend color="#a78bfa" label="All Up" />
                    <Legend color="rgba(34,197,94,0.6)" label="Envelope" isRect />
                  </div>
                </div>
              </div>

              {/* Lateral chart */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>
                  CG Envelope — Lateral vs Longitudinal
                </div>
                <div style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)', borderRadius: 16, padding: 12 }}>
                  <LatCGChart cfg={cfg} result={result} />
                  <div style={{ display: 'flex', gap: 16, marginTop: 8, paddingLeft: 4 }}>
                    <Legend color="#60a5fa" label="Zero Fuel" />
                    <Legend color="#a78bfa" label="All Up" />
                    <Legend color="rgba(34,197,94,0.6)" label="Envelope" isRect />
                  </div>
                </div>
              </div>

              <div style={{ fontSize: 9, color: 'var(--text-tertiary)', textAlign: 'center', lineHeight: 1.5 }}>
                {cfg.ref} · For planning purposes only · PIC is responsible for W&B verification
              </div>
            </>
          )}

          {!result?.status.hasData && (
            <div style={{
              background: 'var(--bg-card)', border: '0.5px solid var(--border)',
              borderRadius: 16, padding: '32px 16px', textAlign: 'center',
            }}>
              <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>Enter weights above to calculate</div>
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4, opacity: 0.6 }}>
                CG envelope charts will appear here
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
