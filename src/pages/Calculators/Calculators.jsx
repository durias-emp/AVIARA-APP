import { useState } from 'react'
import { conv, FUEL, pressureAltitude, densityAltitude, vRef, weightShift } from '../../lib/calculators'
import { BackButton } from '../../components/Shell'

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
  return (
    <>
      <SectionCard title="Volume" formula="1 USG = 3.785 L">
        <BidirCalc aLabel="USG" bLabel="Litres" aToB={conv.usgToL} bToA={conv.lToUsg} aStep="0.1" bStep="0.1" />
      </SectionCard>

      <SectionCard title="Mass" formula="1 lb = 0.454 kg">
        <BidirCalc aLabel="Pounds" bLabel="Kilograms" aToB={conv.lbsToKg} bToA={conv.kgToLbs} />
      </SectionCard>

      <SectionCard title="Temperature" formula="°F = (°C × 1.8) + 32">
        <BidirCalc aLabel="Celsius" bLabel="Fahrenheit" aToB={conv.cToF} bToA={conv.fToC} aStep="0.5" bStep="0.5" />
      </SectionCard>

      <SectionCard title="Pressure" formula="inHg = mb ÷ 33.8639">
        <BidirCalc aLabel="Millibars" bLabel="inHg" aToB={conv.mbToInhg} bToA={conv.inhgToMb} aStep="0.1" bStep="0.01" />
      </SectionCard>

      <SectionCard title="Distance from NM">
        <NmConverter />
      </SectionCard>

      <CX3Button />

      <SectionCard title="Fuel Weight Reference">
        <FuelTable />
      </SectionCard>
    </>
  )
}

function BidirCalc({ aLabel, bLabel, aToB, bToA, aStep = '1', bStep = '1' }) {
  const [a, setA] = useState('')
  const [b, setB] = useState('')

  function handleA(v) { setA(v); const n = parseFloat(v); setB(isNaN(n) ? '' : fmt(aToB(n))) }
  function handleB(v) { setB(v); const n = parseFloat(v); setA(isNaN(n) ? '' : fmt(bToA(n))) }

  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
      <NumField label={aLabel} value={a} onChange={handleA} step={aStep} />
      <div style={{ color: 'var(--text-tertiary)', fontSize: 18, flexShrink: 0, paddingTop: 18 }}>⇄</div>
      <NumField label={bLabel} value={b} onChange={handleB} step={bStep} />
    </div>
  )
}

function NmConverter() {
  const [nm, setNm] = useState('')
  const n = parseFloat(nm)
  const valid = !isNaN(n) && n >= 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <NumField label="Nautical Miles" value={nm} onChange={setNm} />
      {valid && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, borderRadius: 10, overflow: 'hidden', background: 'var(--bg-card-2)' }}>
          <ResultRow label="Feet" value={fmt(conv.nmToFt(n))} />
          <ResultRow label="Statute Miles" value={fmt(conv.nmToSm(n))} />
          <ResultRow label="Kilometres" value={fmt(conv.nmToKm(n))} />
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1, borderRadius: 10, overflow: 'hidden', background: 'var(--bg-card-2)' }}>
      {rows.map(([name, a, b], i) => (
        <div key={name} style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '11px 14px',
          background: 'var(--bg-card)',
          borderBottom: i < rows.length - 1 ? '0.5px solid var(--border)' : 'none',
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
      <DensityAltCalc />
      <GlideRatioCalc />
      <VRefCalc />
      <WeightShiftCalc />
      <CX3Button />
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
    <SectionCard title="V-REF" formula="V_REF = 1.3 × V_SO">
      <NumField label="V_SO (knots)" value={vso} onChange={setVso} step="1" placeholder="0" />
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
              <tr style={{ background: 'var(--accent)' }}>
                <th style={{ padding: '7px 8px', textAlign: 'left', color: '#fff', fontWeight: 600, borderRight: '0.5px solid rgba(255,255,255,0.2)', whiteSpace: 'nowrap' }}>NM \ Ratio</th>
                {TABLE_RATIOS.map(r => (
                  <th key={r} style={{ padding: '7px 6px', textAlign: 'center', color: '#fff', fontWeight: 600, borderRight: '0.5px solid rgba(255,255,255,0.2)', whiteSpace: 'nowrap' }}>{r}</th>
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
function SectionCard({ title, formula, children }) {
  return (
    <div style={{
      background: 'var(--bg-card)',
      borderRadius: 'var(--r-lg)',
      padding: 16,
      boxShadow: 'var(--shadow-sm)',
    }}>
      <div style={{ marginBottom: formula ? 2 : 14 }}>
        <span style={{ fontSize: 17, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.2px' }}>{title}</span>
      </div>
      {formula && (
        <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 14, fontFamily: 'monospace', lineHeight: 1.5 }}>
          {formula}
        </p>
      )}
      {children}
    </div>
  )
}

function NumField({ label, value, onChange, step = '1', placeholder = '' }) {
  return (
    <div style={{ flex: 1 }}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 5, letterSpacing: '-0.1px' }}>
        {label}
      </label>
      <input
        type="number"
        inputMode="decimal"
        step={step}
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          width: '100%',
          padding: '11px 13px',
          borderRadius: 'var(--r-sm)',
          border: '0.5px solid var(--border)',
          background: 'var(--bg-card-2)',
          color: 'var(--text)',
          fontSize: 17,
          fontVariantNumeric: 'tabular-nums',
          outline: 'none',
          transition: 'border-color 0.15s',
        }}
        onFocus={e => e.target.style.borderColor = 'var(--accent)'}
        onBlur={e => e.target.style.borderColor = 'var(--border)'}
      />
    </div>
  )
}

function ResultRow({ label, value, accent }) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '11px 14px',
      background: accent ? 'var(--accent-light)' : 'var(--bg-card)',
      borderBottom: '0.5px solid var(--border)',
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
