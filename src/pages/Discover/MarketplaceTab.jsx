import { useState } from 'react'

// Layout only — the `listings` table (supabase/migrations/0002_social.sql)
// exists but nothing writes to it yet, so there's nothing real to filter or
// list. Filter chips are visually interactive (so the shape is judgeable)
// but don't do anything; listing cards are skeletons, not real data.

const ENGINE_TYPES = ['Piston', 'Turboprop', 'Jet']
const PRICE_RANGES = ['Any price', 'Under $100k', '$100k–$500k', '$500k+']

function SkeletonListing() {
  return (
    <div style={{
      borderRadius: 16, overflow: 'hidden', background: 'var(--bg-card)',
      boxShadow: 'var(--shadow-sm)', marginBottom: 14,
    }}>
      <div style={{ width: '100%', aspectRatio: '16 / 10', background: 'var(--bg-card-2)' }} />
      <div style={{ padding: '12px 14px' }}>
        <div style={{ width: '55%', height: 13, borderRadius: 6, background: 'var(--bg-card-2)', marginBottom: 8 }} />
        <div style={{ width: '35%', height: 11, borderRadius: 6, background: 'var(--bg-card-2)' }} />
      </div>
    </div>
  )
}

function Chip({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '7px 13px', borderRadius: 20, flexShrink: 0, whiteSpace: 'nowrap',
        border: active ? 'none' : '1px solid var(--border)',
        background: active ? 'var(--text)' : 'transparent',
        color: active ? 'var(--bg)' : 'var(--text-secondary)',
        fontSize: 12, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      {label}
    </button>
  )
}

export default function MarketplaceTab() {
  const [price, setPrice] = useState(PRICE_RANGES[0])
  const [engine, setEngine] = useState(null)

  return (
    <div style={{ paddingTop: 12 }}>
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '0 16px 10px' }}>
        {PRICE_RANGES.map(p => (
          <Chip key={p} label={p} active={price === p} onClick={() => setPrice(p)} />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '0 16px 16px' }}>
        {ENGINE_TYPES.map(e => (
          <Chip key={e} label={e} active={engine === e} onClick={() => setEngine(x => x === e ? null : e)} />
        ))}
      </div>

      <div style={{ padding: '0 16px 8px', fontSize: 12, color: 'var(--text-tertiary)', textAlign: 'center' }}>
        No listings yet — this is what the layout will look like.
      </div>
      <div style={{ padding: '8px 16px 0' }}>
        <SkeletonListing />
        <SkeletonListing />
      </div>
    </div>
  )
}
