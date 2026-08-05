import { useCallback, useEffect, useState } from 'react'
import {
  listListings, PRICE_BANDS, ENGINE_TYPES,
  priceLabel, title as listingTitle, hoursLabel,
} from '../../lib/listings'
import ListingForm from './ListingForm'
import ListingDetail from './ListingDetail'

// The marketplace, with real listings.
//
// The filter chips were decorative until now — they existed in the right
// shape with nothing behind them. They query for real here, and the price
// bands come from listings.js rather than being duplicated as labels, so the
// chip you tap and the range it filters cannot drift apart.

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

const STATUS_BADGE = {
  pending: { label: 'Pending', color: '#FF9F0A', bg: 'rgba(255,159,10,0.16)' },
  sold: { label: 'Sold', color: '#fff', bg: 'rgba(0,0,0,0.6)' },
}

function ListingCard({ listing, onOpen }) {
  const cover = listing.listing_media?.[0]?.url
  const badge = STATUS_BADGE[listing.status]
  const line = [
    hoursLabel(listing.total_time_hours),
    listing.location,
  ].filter(Boolean).join(' · ')

  return (
    <button
      onClick={() => onOpen(listing.id)}
      style={{
        display: 'block', width: '100%', textAlign: 'left', padding: 0, border: 'none',
        borderRadius: 16, overflow: 'hidden', background: 'var(--bg-card)',
        boxShadow: 'var(--shadow-sm)', marginBottom: 14, cursor: 'pointer',
        fontFamily: 'inherit', WebkitTapHighlightColor: 'transparent',
      }}>
      <div style={{ position: 'relative', width: '100%', aspectRatio: '16 / 10', background: 'var(--bg-card-2)' }}>
        {cover ? (
          <img src={cover} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        ) : (
          <span style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-tertiary)', fontSize: 12,
          }}>No photo</span>
        )}
        {badge && (
          <span style={{
            position: 'absolute', top: 10, left: 10, background: badge.bg, color: badge.color,
            fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 8,
            textTransform: 'uppercase', letterSpacing: '0.04em',
          }}>{badge.label}</span>
        )}
        {listing.listing_media?.length > 1 && (
          <span style={{
            position: 'absolute', top: 10, right: 10, background: 'rgba(0,0,0,0.55)', color: '#fff',
            fontSize: 10, fontWeight: 700, padding: '3px 7px', borderRadius: 8,
          }}>{listing.listing_media.length} photos</span>
        )}
      </div>
      <div style={{ padding: '12px 14px' }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.2px' }}>
          {priceLabel(listing)}
        </div>
        <div style={{
          fontSize: 13, color: 'var(--text)', marginTop: 2,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{listingTitle(listing)}</div>
        {line && (
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 3 }}>{line}</div>
        )}
      </div>
    </button>
  )
}

export default function MarketplaceTab({ myId, onMessageSeller }) {
  const [priceBand, setPriceBand] = useState('any')
  const [engine, setEngine] = useState(null)
  const [listings, setListings] = useState(null)
  const [composing, setComposing] = useState(false)
  const [openId, setOpenId] = useState(null)

  const load = useCallback(async () => {
    const { data } = await listListings({ priceBand, engineType: engine })
    setListings(data)
  }, [priceBand, engine])

  useEffect(() => { load() }, [load])

  if (openId) {
    return (
      <ListingDetail
        listingId={openId}
        myId={myId}
        onBack={() => setOpenId(null)}
        onMessageSeller={onMessageSeller}
        onChanged={load}
      />
    )
  }

  const filtered = priceBand !== 'any' || engine

  return (
    <div style={{ paddingTop: 12 }}>
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '0 16px 10px' }}>
        {PRICE_BANDS.map(b => (
          <Chip key={b.key} label={b.label} active={priceBand === b.key} onClick={() => setPriceBand(b.key)} />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '0 16px 14px' }}>
        {ENGINE_TYPES.map(e => (
          <Chip
            key={e.key}
            label={e.label}
            active={engine === e.key}
            onClick={() => setEngine(x => (x === e.key ? null : e.key))}
          />
        ))}
      </div>

      <div style={{ padding: '0 16px 14px' }}>
        <button
          onClick={() => setComposing(true)}
          style={{
            width: '100%', padding: '12px 0', borderRadius: 22, border: 'none',
            background: 'var(--accent)', color: 'var(--accent-fg)', fontFamily: 'inherit',
            fontSize: 14, fontWeight: 700, cursor: 'pointer',
            WebkitTapHighlightColor: 'transparent',
          }}>+ List an aircraft</button>
      </div>

      {listings === null && (
        <div style={{ padding: '26px 20px', textAlign: 'center', fontSize: 13, color: 'var(--text-tertiary)' }}>
          Loading…
        </div>
      )}

      {listings?.length === 0 && (
        <div style={{ padding: '26px 32px', textAlign: 'center' }}>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            {/* "Nothing matches your filter" and "nothing for sale" are
                different problems with different fixes, so they get
                different sentences. */}
            {filtered
              ? 'Nothing matches those filters yet. Try widening them.'
              : 'No aircraft listed yet. If you have one for sale, yours would be the first.'}
          </div>
        </div>
      )}

      <div style={{ padding: '0 16px' }}>
        {listings?.map(l => (
          <ListingCard key={l.id} listing={l} onOpen={setOpenId} />
        ))}
      </div>

      {composing && (
        <ListingForm
          sellerId={myId}
          onClose={() => setComposing(false)}
          onCreated={load}
        />
      )}
    </div>
  )
}
