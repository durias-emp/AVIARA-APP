import { useState } from 'react'
import { conv, FUEL, pressureAltitude, densityAltitude, vRef, weightShift } from '../../lib/calculators'
import { BackButton } from '../../components/Shell'
import FuelConverter from '../../components/FuelConverter'

const TABS = ['Conversions', 'Performance']

export default function Calculators() {
  const [tab, setTab] = useState(0)

  return (
    <div>
      {/* Page title */}
      <div style={{ padding: '20px 20px 0', display: 'flex', alignItems: 'center', gap: 12 }}>
        <BackButton />
        <h2 style={{
          fontSize: 28,
          fontWeight: 700,
          letterSpacing: '-0.4px',
          color: 'var(--text)',
          fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
        }}>Calculators</h2>
      </div>

      {/* Segmented control */}
      <div style={{ padding: '16px 20px 20px' }}>
        <div style={{
          display: 'flex',
          background: 'var(--bg-card-2)',
          borderRadius: 10,
          padding: 2,
          gap: 2,
        }}>
          {TABS.map((t, i) => (
            <button key={t} onClick={() => setTab(i)} style={{
              flex: 1,
              padding: '7px 0',
              borderRadius: 8,
              border: 'none',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: 13,
              letterSpacing: '-0.1px',
              transition: 'all 0.2s',
              background: tab === i ? 'var(--bg-card)' : 'transparent',
              color: tab === i ? 'var(--text)' : 'var(--text-secondary)',
              boxShadow: tab === i ? 'var(--shadow-sm)' : 'none',
            }}>{t}</button>
          ))}
        </div>
      </div>

      <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 12, paddingBottom: 12 }}>
        {tab === 0 ? <Conversions /> : <Performance />}
      </div>
    </div>
  )
}

/* ── Conversions ─────────────────────────────────────── */
function Conversions() {
  const [refOpen, setRefOpen] = useState(false)

  return (
    <>
      <CX3Button />
      <SectionCard title="Distance">
        <NmConverter />
      </SectionCard>

      <SectionCard title="Fuel Conversion" headerRight={<ChipButton onClick={() => setRefOpen(true)}>Reference</ChipButton>}>
        <FuelConverter />
      </SectionCard>

      <SectionCard title="Volume">
        <UnitConverter placeholder="Volume" units={VOLUME_UNITS} />
      </SectionCard>

      <SectionCard title="Mass">
        <UnitConverter placeholder="Mass" units={MASS_UNITS} />
      </SectionCard>

      <SectionCard title="Temperature">
        <UnitConverter placeholder="Temperature" units={TEMP_UNITS} />
      </SectionCard>

      <SectionCard title="Pressure">
        <UnitConverter placeholder="Pressure" units={PRESSURE_UNITS} />
      </SectionCard>

      {refOpen && <FuelReferenceModal onClose={() => setRefOpen(false)} />}
    </>
  )
}

function ChipButton({ onClick, children }) {
  return (
    <button onClick={onClick} style={{
      fontSize: 10, fontWeight: 600, color: 'var(--text-tertiary)',
      background: 'var(--bg-card-2)',
      borderRadius: 20, padding: '3px 10px', cursor: 'pointer',
      fontFamily: 'inherit', flexShrink: 0,
    }}>{children}</button>
  )
}

function FuelReferenceModal({ onClose }) {
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 600,
      background: 'rgba(0,0,0,0.55)',
      backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 20px',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 360,
        background: 'var(--bg-card)', borderRadius: 16,
        padding: 16, boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <span style={{ fontSize: 17, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.2px' }}>Fuel Weight Reference</span>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: 4,
            color: 'var(--text-tertiary)', display: 'flex',
          }}>
            <svg width={18} height={18} viewBox="0 0 24 24" fill="none">
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
        <FuelTable />
      </div>
    </div>
  )
}

// Each list defines every unit's conversion to/from a shared base unit
// (liters, kg, °C, or millibars) so any one field can drive all the others —
// same interaction pattern as the Distance and Fuel Conversion cards.
const VOLUME_UNITS = [
  { key: 'usg',    label: 'US Gallons',     toBase: v => conv.usgToL(v),   fromBase: v => conv.lToUsg(v) },
  { key: 'l',      label: 'Litres',         toBase: v => v,                fromBase: v => v },
  { key: 'impgal', label: 'Imperial Gallons', toBase: v => v * 4.546,       fromBase: v => v / 4.546 },
]

const MASS_UNITS = [
  { key: 'lbs', label: 'Pounds',    toBase: v => conv.lbsToKg(v), fromBase: v => conv.kgToLbs(v) },
  { key: 'kg',  label: 'Kilograms', toBase: v => v,               fromBase: v => v },
]

const TEMP_UNITS = [
  { key: 'c', label: 'Celsius',    toBase: v => v,                 fromBase: v => v },
  { key: 'f', label: 'Fahrenheit', toBase: v => conv.fToC(v),      fromBase: v => conv.cToF(v) },
  { key: 'k', label: 'Kelvin',     toBase: v => v - 273.15,        fromBase: v => v + 273.15 },
]

const PRESSURE_UNITS = [
  { key: 'mb',  label: 'Millibars', toBase: v => v,                  fromBase: v => v },
  { key: 'inhg', label: 'inHg',     toBase: v => conv.inhgToMb(v),    fromBase: v => conv.mbToInhg(v) },
  { key: 'psi', label: 'PSI',       toBase: v => v * 68.9476,        fromBase: v => v / 68.9476 },
]

function UnitConverter({ units, placeholder }) {
  const [value, setValue] = useState('')
  const [unitKey, setUnitKey] = useState(units[0].key)

  const n = parseFloat(value)
  const valid = !isNaN(n)
  const activeUnit = units.find(u => u.key === unitKey)
  const baseVal = valid ? activeUnit.toBase(n) : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flexShrink: 0 }}>
          <select
            value={unitKey}
            onChange={e => setUnitKey(e.target.value)}
            style={{
              width: 152, boxSizing: 'border-box',
              height: 46, padding: '0 32px 0 12px', borderRadius: 'var(--r-sm)',
              background: 'var(--bg-card-2)',
              color: 'var(--text)', fontSize: 14, fontWeight: 500, cursor: 'pointer',
              appearance: 'none', outline: 'none',
              backgroundImage: `url("data:image/svg+xml,%3Csvg width='12' height='12' viewBox='0 0 16 16' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpolyline points='3,6 8,11 13,6' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
              backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center',
            }}
          >
            {units.map(u => <option key={u.key} value={u.key}>{u.label}</option>)}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <input
            type="number" inputMode="decimal" step="any"
            placeholder={placeholder}
            value={value} onChange={e => setValue(e.target.value)}
            style={{ width: '100%', height: 46, padding: '0 13px', borderRadius: 'var(--r-sm)', background: 'var(--bg-card-2)', color: 'var(--text)', fontSize: 17, outline: 'none' }}
          />
        </div>
      </div>

      {valid && baseVal !== null && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0, borderRadius: 10, overflow: 'hidden', background: 'var(--bg-card)' }}>
          {units.filter(u => u.key !== unitKey).map(u => (
            <div key={u.key} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '7px 14px', background: 'var(--bg-card)',
            }}>
              <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{u.label}</span>
              <span style={{ fontSize: 15, fontWeight: 500, color: 'var(--text)', fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.2px' }}>
                {fmt(u.fromBase(baseVal))}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const DIST_UNITS = [
  { key: 'nm',  label: 'Nautical Miles',  toNm: v => v,               fromNm: v => v               },
  { key: 'km',  label: 'Kilometres',      toNm: v => v / 1.852,       fromNm: v => v * 1.852       },
  { key: 'sm',  label: 'Statute Miles',   toNm: v => v / 1.15078,     fromNm: v => v * 1.15078     },
  { key: 'ft',  label: 'Feet',            toNm: v => v / 6076,        fromNm: v => v * 6076        },
  { key: 'm',   label: 'Meters',          toNm: v => v / 1852,        fromNm: v => v * 1852        },
]

function NmConverter() {
  const [value, setValue] = useState('')
  const [unitKey, setUnitKey] = useState('nm')

  const n = parseFloat(value)
  const valid = !isNaN(n) && n >= 0
  const activeUnit = DIST_UNITS.find(u => u.key === unitKey)
  const nmVal = valid ? activeUnit.toNm(n) : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flexShrink: 0 }}>
          <select
            value={unitKey}
            onChange={e => setUnitKey(e.target.value)}
            style={{
              width: 152, boxSizing: 'border-box',
              height: 46, padding: '0 32px 0 12px', borderRadius: 'var(--r-sm)',
              background: 'var(--bg-card-2)',
              color: 'var(--text)', fontSize: 14, fontWeight: 500, cursor: 'pointer',
              appearance: 'none', outline: 'none',
              backgroundImage: `url("data:image/svg+xml,%3Csvg width='12' height='12' viewBox='0 0 16 16' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpolyline points='3,6 8,11 13,6' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
              backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center',
            }}
          >
            {DIST_UNITS.map(u => <option key={u.key} value={u.key}>{u.label}</option>)}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <input
            type="number" inputMode="decimal" step="any"
            placeholder="Distance"
            value={value} onChange={e => setValue(e.target.value)}
            style={{ width: '100%', height: 46, padding: '0 13px', borderRadius: 'var(--r-sm)', background: 'var(--bg-card-2)', color: 'var(--text)', fontSize: 17, outline: 'none' }}
          />
        </div>
      </div>

      {valid && nmVal !== null && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0, borderRadius: 10, overflow: 'hidden', background: 'var(--bg-card)' }}>
          {DIST_UNITS.filter(u => u.key !== unitKey).map(u => (
            <ResultRow key={u.key} label={u.label} value={fmt(u.fromNm(nmVal))} noBorder />
          ))}
        </div>
      )}
    </div>
  )
}

function FuelTable() {
  const rows = [
    ['AVGAS 100LL', `${FUEL.avgas.lbPerUsg} lb/USG`, `${FUEL.avgas.kgPerL} kg/L`],
    ['JET-A',       `${FUEL.jetA.lbPerUsg} lb/USG`,  `${FUEL.jetA.kgPerL} kg/L`],
    ['Oil',         `${FUEL.oil.lbPerUsg} lb/USG`,   `${FUEL.oil.lbPerQt} lb/qt`],
  ]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, borderRadius: 10, overflow: 'hidden', background: 'var(--bg-card)' }}>
      {rows.map(([name, a, b]) => (
        <div key={name} style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '11px 14px',
          background: 'var(--bg-card)',
          borderBottom: 'none',
        }}>
          <span style={{ fontSize: 15, fontWeight: 500, color: 'var(--text)' }}>{name}</span>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>{a} · {b}</span>
        </div>
      ))}
    </div>
  )
}

/* ── Performance ─────────────────────────────────────── */
function Performance() {
  return (
    <>
      <CX3Button />
      <DensityAltCalc />
      <GlideRatioCalc />
      <VRefCalc />
      <WeightShiftCalc />
      <SectionCard title="Standard References">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, borderRadius: 10, overflow: 'hidden', background: 'var(--bg-card-2)' }}>
          <ResultRow label="Standard Lapse Rate" value="2 °C / 1,000 ft" />
          <ResultRow label="Pressure Drop" value="−1 inHg / 1,000 ft" />
        </div>
      </SectionCard>
    </>
  )
}

function CX3Button() {
  return (
    <a
      href="https://prepware.com/cx3e/index.html"
      target="_blank"
      rel="noreferrer"
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        padding: '13px 0', borderRadius: 12,
        background: 'var(--text)', textDecoration: 'none',
      }}
    >
      <img src="/E6B CALC.svg" width={18} height={18}
        style={{ objectFit: 'contain', filter: 'brightness(0)' }} />
      <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--bg)', letterSpacing: '-0.1px' }}>
        CX-3 Calculator
      </span>
    </a>
  )
}

function DensityAltCalc() {
  const [alt, setAlt] = useState('')
  const [elev, setElev] = useState('')
  const [oat, setOat] = useState('')

  const a = parseFloat(alt), e = parseFloat(elev), o = parseFloat(oat)
  const ready = !isNaN(a) && !isNaN(e) && !isNaN(o)
  const pa = ready ? Math.round(pressureAltitude(a, e)) : null
  const da = ready ? Math.round(densityAltitude(a, e, o)) : null
  const isa = ready ? +(15 - 2 * pa / 1000).toFixed(1) : null

  return (
    <SectionCard title="Density Altitude" formula="PA = (29.92 − ALT) × 1,000 + Elev  ·  DA = PA + 120 × (OAT − ISA)">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <NumField label="Altimeter Setting (inHg)" value={alt} onChange={setAlt} step="0.01" placeholder="29.92" />
        <NumField label="Field Elevation (ft)" value={elev} onChange={setElev} step="1" placeholder="0" />
        <NumField label="OAT (°C)" value={oat} onChange={setOat} step="0.5" placeholder="15" />
      </div>
      {ready && (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 1, borderRadius: 10, overflow: 'hidden', background: 'var(--bg-card-2)' }}>
          <ResultRow label="Pressure Altitude" value={`${pa.toLocaleString()} ft`} />
          <ResultRow label="ISA Temp at PA" value={`${isa} °C`} />
          <ResultRow label="Density Altitude" value={`${da.toLocaleString()} ft`} accent />
        </div>
      )}
    </SectionCard>
  )
}

function VRefCalc() {
  const [vso, setVso] = useState('')
  const n = parseFloat(vso)
  const result = !isNaN(n) && n > 0 ? vRef(n) : null

  return (
    <SectionCard title="V-REF" formula="V_REF = 1.3 × Vso">
      <NumField label="Vso (knots)" value={vso} onChange={setVso} step="1" placeholder="0" />
      {result !== null && (
        <div style={{ marginTop: 12, borderRadius: 10, overflow: 'hidden', background: 'var(--bg-card-2)' }}>
          <ResultRow label="V-REF" value={`${fmt(result)} kt`} accent />
        </div>
      )}
    </SectionCard>
  )
}

function WeightShiftCalc() {
  const [w, setW] = useState('')
  const [W, setWW] = useState('')
  const [D, setD] = useState('')
  const [d, setDd] = useState('')

  const vals = {
    w: w === '' ? null : parseFloat(w),
    W: W === '' ? null : parseFloat(W),
    D: D === '' ? null : parseFloat(D),
    d: d === '' ? null : parseFloat(d),
  }
  const blanks = Object.values(vals).filter(v => v === null).length
  const result = blanks === 1 ? weightShift(vals) : null

  return (
    <SectionCard title="Weight Shift" formula="w/W = D/d — leave one field blank to solve">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <NumField label="w — weight moved (lb)" value={w} onChange={setW} step="1" />
        <NumField label="W — total weight (lb)" value={W} onChange={setWW} step="1" />
        <NumField label="D — CG shift (in)" value={D} onChange={setD} step="0.1" />
        <NumField label="d — station dist (in)" value={d} onChange={setDd} step="0.1" />
      </div>
      {result !== null && (
        <div style={{ marginTop: 12, borderRadius: 10, overflow: 'hidden', background: 'var(--bg-card-2)' }}>
          <ResultRow label="Result" value={fmt(result)} accent />
        </div>
      )}
    </SectionCard>
  )
}

function GlideRatioCalc() {
  const [dist, setDist] = useState('')
  const [ratio, setRatio] = useState('')
  const [showTable, setShowTable] = useState(false)

  const d = parseFloat(dist)
  const r = parseFloat(ratio)
  const result = !isNaN(d) && d > 0 && !isNaN(r) && r > 0
    ? Math.round((d * 6076) / r)
    : null

  const TABLE_RATIOS = [7, 8, 9, 10, 11, 12, 13, 14, 15, 17, 20]
  const TABLE_DISTS  = [1, 2, 3, 5, 10, 15, 20]

  return (
    <SectionCard title="Glide Ratio" formula="Altitude (ft AGL) = [Distance (NM) × 6076] / Glide Ratio">
      <div style={{ display: 'flex', gap: 10 }}>
        <NumField label="Distance (NM)" value={dist} onChange={setDist} step="0.5" placeholder="e.g. 10" />
        <NumField label="Glide Ratio" value={ratio} onChange={v => setRatio(v ? String(Math.round(Math.abs(parseFloat(v) || 0))) : '')} step="1" placeholder="7, 9, 12…" />
      </div>

      {result !== null && (
        <div style={{ marginTop: 12, borderRadius: 10, overflow: 'hidden', background: 'var(--bg-card-2)' }}>
          <ResultRow label="Required Altitude" value={`${result.toLocaleString()} ft AGL`} accent />
        </div>
      )}

      {/* Quick-ref table toggle */}
      <button
        onClick={() => setShowTable(v => !v)}
        style={{
          marginTop: 14, width: '100%',
          padding: '9px 0',
          borderRadius: 'var(--r-sm)',
          border: '0.5px solid var(--border)',
          background: 'var(--bg-card-2)',
          color: 'var(--text-secondary)',
          fontSize: 13, fontWeight: 500, cursor: 'pointer',
        }}>
        {showTable ? 'Hide' : 'Show'} Reference Table
      </button>

      {showTable && (
        <div style={{ marginTop: 12, overflowX: 'auto', borderRadius: 10, border: '0.5px solid var(--border)' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 11, width: '100%', minWidth: 480 }}>
            <thead>
              <tr style={{ background: 'var(--bg-card-2)' }}>
                <th style={{ padding: '7px 8px', textAlign: 'left', color: 'var(--text)', fontWeight: 600, borderRight: '0.5px solid var(--border)', whiteSpace: 'nowrap' }}>NM \ Ratio</th>
                {TABLE_RATIOS.map(r => (
                  <th key={r} style={{ padding: '7px 6px', textAlign: 'center', color: 'var(--text)', fontWeight: 600, borderRight: '0.5px solid var(--border)', whiteSpace: 'nowrap' }}>{r}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {TABLE_DISTS.map((d, di) => (
                <tr key={d} style={{ background: di % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-card-2)' }}>
                  <td style={{ padding: '7px 8px', fontWeight: 600, color: 'var(--text)', borderRight: '0.5px solid var(--border)', whiteSpace: 'nowrap' }}>{d} NM</td>
                  {TABLE_RATIOS.map(r => (
                    <td key={r} style={{ padding: '7px 6px', textAlign: 'center', color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums', borderRight: '0.5px solid var(--border)', whiteSpace: 'nowrap' }}>
                      {Math.round((d * 6076) / r).toLocaleString()}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  )
}

/* ── Shared atoms ────────────────────────────────────── */
function SectionCard({ title, formula, children, headerRight }) {
  const [refOpen, setRefOpen] = useState(false)
  return (
    <div style={{
      background: 'var(--bg-card)',
      borderRadius: 'var(--r-lg)',
      padding: 16,
      boxShadow: 'var(--shadow-sm)',
    }}>
      <div style={{ marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 17, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.2px' }}>{title}</span>
        {formula ? <ChipButton onClick={() => setRefOpen(true)}>Reference</ChipButton> : headerRight}
      </div>
      {children}
      {refOpen && <FormulaModal title={title} formula={formula} onClose={() => setRefOpen(false)} />}
    </div>
  )
}

// Same interaction as Fuel Conversion's "Reference" chip — the formula is
// tucked behind a modal instead of always sitting under the title, so the
// card stays compact and the formula is available on demand.
function FormulaModal({ title, formula, onClose }) {
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 600,
      background: 'rgba(0,0,0,0.55)',
      backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 20px',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 360,
        background: 'var(--bg-card)', borderRadius: 16,
        padding: 16, boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <span style={{ fontSize: 17, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.2px' }}>{title} Reference</span>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: 4,
            color: 'var(--text-tertiary)', display: 'flex',
          }}>
            <svg width={18} height={18} viewBox="0 0 24 24" fill="none">
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', fontFamily: 'monospace', lineHeight: 1.6, margin: 0 }}>
          {formula}
        </p>
      </div>
    </div>
  )
}

function NumField({ label, value, onChange, step = '1', placeholder = '', noLabel = false }) {
  return (
    <div style={{ flex: 1 }}>
      {!noLabel && (
        <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 5, letterSpacing: '-0.1px' }}>
          {label}
        </label>
      )}
      <input
        type="number"
        inputMode="decimal"
        step={step}
        placeholder={placeholder || (noLabel ? label : '')}
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          width: '100%',
          padding: '11px 13px',
          borderRadius: 'var(--r-sm)',
          background: 'var(--bg-card-2)',
          color: 'var(--text)',
          fontSize: 17,
          fontVariantNumeric: 'tabular-nums',
          outline: 'none',
        }}
      />
    </div>
  )
}

function ResultRow({ label, value, accent, noBorder }) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: noBorder ? '7px 14px' : '11px 14px',
      background: accent ? 'var(--accent-light)' : 'var(--bg-card)',
      borderBottom: noBorder ? 'none' : '0.5px solid var(--border)',
    }}>
      <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{
        fontSize: accent ? 17 : 15,
        fontWeight: accent ? 700 : 500,
        color: accent ? 'var(--accent)' : 'var(--text)',
        fontVariantNumeric: 'tabular-nums',
        letterSpacing: '-0.2px',
      }}>{value}</span>
    </div>
  )
}

function fmt(n, decimals = 2) {
  return +n.toFixed(decimals)
}
