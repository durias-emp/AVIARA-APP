import { useState } from 'react'
import { conv, FUEL } from '../lib/calculators'

// Jet-A gal/lbs/kg/liters converter — enter any one unit, the other three
// recompute from Jet-A density (6.7 lb/USG, 0.80 kg/L). Same component is
// used standalone in Calculators and embedded inside Weight & Balance.
const FUEL_UNITS = [
  { key: 'gal', label: 'US Gallons', toGal: v => v,                                          fromGal: v => v },
  { key: 'lbs', label: 'Pounds',     toGal: v => v / FUEL.jetA.lbPerUsg,                      fromGal: v => v * FUEL.jetA.lbPerUsg },
  { key: 'l',   label: 'Liters',     toGal: v => conv.lToUsg(v),                              fromGal: v => conv.usgToL(v) },
  { key: 'kg',  label: 'Kilograms',  toGal: v => conv.lToUsg(v / FUEL.jetA.kgPerL),            fromGal: v => conv.usgToL(v) * FUEL.jetA.kgPerL },
]

function fmt(n, decimals = 2) {
  return +n.toFixed(decimals)
}

export default function FuelConverter() {
  const [value, setValue] = useState('')
  const [unitKey, setUnitKey] = useState('gal')

  const n = parseFloat(value)
  const valid = !isNaN(n) && n >= 0
  const activeUnit = FUEL_UNITS.find(u => u.key === unitKey)
  const galVal = valid ? activeUnit.toGal(n) : null

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
              border: '0.5px solid var(--border)', background: 'var(--bg-card-2)',
              color: 'var(--text)', fontSize: 14, fontWeight: 500, cursor: 'pointer',
              appearance: 'none', outline: 'none',
              backgroundImage: `url("data:image/svg+xml,%3Csvg width='12' height='12' viewBox='0 0 16 16' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpolyline points='3,6 8,11 13,6' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
              backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center',
            }}
          >
            {FUEL_UNITS.map(u => <option key={u.key} value={u.key}>{u.label}</option>)}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <input
            type="number" inputMode="decimal" step="any"
            placeholder="Jet-A Quantity"
            value={value} onChange={e => setValue(e.target.value)}
            style={{ width: '100%', height: 46, padding: '0 13px', borderRadius: 'var(--r-sm)', border: '0.5px solid var(--border)', background: 'var(--bg-card-2)', color: 'var(--text)', fontSize: 17, outline: 'none' }}
          />
        </div>
      </div>

      {valid && galVal !== null && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0, borderRadius: 10, overflow: 'hidden', background: 'var(--bg-card)' }}>
          {FUEL_UNITS.filter(u => u.key !== unitKey).map(u => (
            <div key={u.key} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '7px 14px', background: 'var(--bg-card)',
            }}>
              <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{u.label}</span>
              <span style={{ fontSize: 15, fontWeight: 500, color: 'var(--text)', fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.2px' }}>
                {fmt(u.fromGal(galVal))}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
