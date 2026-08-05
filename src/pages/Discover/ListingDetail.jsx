import { useEffect, useState } from 'react'
import { IconChevronLeft, IconSend } from '../../components/Icons'
import {
  getListing, priceLabel, title as listingTitle, hoursLabel,
  updateListingStatus, deleteListing, STATUSES,
} from '../../lib/listings'
import { groupSpecs, specValue } from '../../lib/listingSpecs'
import { timeAgo } from '../../lib/posts'
import { listingUrl } from '../../lib/share'
import ShareSheet from './ShareSheet'

// One listing, in full.
//
// Fetched fresh rather than handed down from the card: the card carries only
// what a card needs, and a buyer opening a listing wants the description and
// the whole spec sheet — which is most of the row's weight and exactly what
// you don't want multiplied across forty cards in a scrolling list.

const STATUS_STYLE = {
  active: null,
  pending: { label: 'Sale pending', color: '#FF9F0A', bg: 'rgba(255,159,10,0.14)' },
  sold: { label: 'Sold', color: 'var(--text-secondary)', bg: 'rgba(120,120,128,0.16)' },
  withdrawn: { label: 'Withdrawn', color: 'var(--text-secondary)', bg: 'rgba(120,120,128,0.16)' },
}

function Gallery({ media }) {
  if (!media?.length) {
    return (
      <div style={{
        width: '100%', aspectRatio: '16 / 10', background: 'var(--bg-card-2)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--text-tertiary)', fontSize: 13,
      }}>No photos</div>
    )
  }
  return (
    <div style={{
      display: 'flex', overflowX: 'auto', scrollSnapType: 'x mandatory',
      WebkitOverflowScrolling: 'touch', background: 'var(--bg-card-2)',
    }}>
      {media.map(m => (
        <img key={m.url} src={m.url} alt=""
          style={{
            width: '100%', flex: '0 0 100%', scrollSnapAlign: 'center',
            aspectRatio: '16 / 10', objectFit: 'cover', display: 'block',
          }} />
      ))}
    </div>
  )
}

function Row({ label, value }) {
  if (value == null || value === '') return null
  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
      gap: 14, padding: '9px 0', borderTop: '0.5px solid var(--border)',
    }}>
      <span style={{ fontSize: 13, color: 'var(--text-secondary)', flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', textAlign: 'right' }}>{value}</span>
    </div>
  )
}

export default function ListingDetail({ listingId, myId, onBack, onMessageSeller, onChanged }) {
  const [listing, setListing] = useState(undefined)
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [sharing, setSharing] = useState(false)

  useEffect(() => {
    let cancelled = false
    getListing(listingId).then(({ data }) => { if (!cancelled) setListing(data) })
    return () => { cancelled = true }
  }, [listingId])

  if (listing === undefined) {
    return <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>Loading…</div>
  }
  if (!listing) {
    return (
      <div style={{ padding: '40px 20px', textAlign: 'center' }}>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 14 }}>
          This listing is no longer available.
        </div>
        <button onClick={onBack} style={{
          border: 'none', background: 'var(--bg-card-2)', color: 'var(--text)', fontFamily: 'inherit',
          fontSize: 14, fontWeight: 700, padding: '10px 20px', borderRadius: 20, cursor: 'pointer',
        }}>Back</button>
      </div>
    )
  }

  const mine = listing.seller_id === myId
  const status = STATUS_STYLE[listing.status]
  const groups = groupSpecs(listing.specs)

  async function setStatus(s) {
    setBusy(true)
    await updateListingStatus(listing.id, s)
    setBusy(false)
    setListing(l => ({ ...l, status: s }))
    onChanged?.()
  }

  async function remove() {
    setBusy(true)
    await deleteListing(listing)
    setBusy(false)
    onChanged?.()
    onBack()
  }

  return (
    <div style={{ paddingBottom: 30 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 14px 12px' }}>
        <button onClick={onBack} aria-label="Back" style={{
          width: 34, height: 34, borderRadius: '50%', border: 'none', background: 'var(--bg-card-2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', color: 'var(--text)', WebkitTapHighlightColor: 'transparent',
        }}>
          <IconChevronLeft size={18} />
        </button>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', flex: 1, minWidth: 0 }}>
          {listingTitle(listing)}
        </div>
        {/* Sharing a listing is the one share in this app that reaches
            people who don't have it — the link opens for anyone. */}
        <button onClick={() => setSharing(true)} aria-label="Share listing" style={{
          width: 34, height: 34, borderRadius: '50%', border: 'none', background: 'var(--bg-card-2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          cursor: 'pointer', color: 'var(--text)', fontSize: 17, fontFamily: 'inherit',
          WebkitTapHighlightColor: 'transparent',
        }}>↗</button>
      </div>

      <Gallery media={listing.listing_media} />

      <div style={{ padding: '16px 18px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
          <span style={{ fontSize: 24, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.4px' }}>
            {priceLabel(listing)}
          </span>
          {status && (
            <span style={{
              fontSize: 11, fontWeight: 700, color: status.color, background: status.bg,
              padding: '3px 9px', borderRadius: 9, textTransform: 'uppercase', letterSpacing: '0.04em',
            }}>{status.label}</span>
          )}
        </div>
        <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 2 }}>
          {listingTitle(listing)}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
          {[listing.location, timeAgo(listing.created_at) && `listed ${timeAgo(listing.created_at)}`]
            .filter(Boolean).join(' · ')}
        </div>

        {listing.description && (
          <p style={{
            margin: '16px 0 0', fontSize: 14, color: 'var(--text)', lineHeight: 1.6,
            whiteSpace: 'pre-wrap',
          }}>{listing.description}</p>
        )}

        <div style={{ marginTop: 20 }}>
          <div style={{
            fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
            color: 'var(--text-tertiary)', marginBottom: 2,
          }}>At a glance</div>
          <Row label="Registration" value={listing.registration} />
          <Row label="Total time" value={hoursLabel(listing.total_time_hours)} />
          <Row label="Engine time" value={hoursLabel(listing.engine_time_hours)} />
          <Row label="Engine type" value={listing.engine_type
            ? listing.engine_type[0].toUpperCase() + listing.engine_type.slice(1)
            : null} />
        </div>

        {groups.map(g => (
          <div key={g.title} style={{ marginTop: 20 }}>
            <div style={{
              fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
              color: 'var(--text-tertiary)', marginBottom: 2,
            }}>{g.title}</div>
            {g.items.map(item => (
              <Row key={item.key} label={item.label} value={specValue(item)} />
            ))}
          </div>
        ))}

        {/* Seller actions vs buyer actions — never both, and never a
            "message yourself" button. */}
        {mine ? (
          <div style={{ marginTop: 26 }}>
            <div style={{
              fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
              color: 'var(--text-tertiary)', marginBottom: 8,
            }}>Your listing</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {STATUSES.filter(s => s !== listing.status).map(s => (
                <button key={s} onClick={() => setStatus(s)} disabled={busy} style={{
                  padding: '9px 14px', borderRadius: 18, border: '1px solid var(--border)',
                  background: 'transparent', color: 'var(--text-secondary)', fontFamily: 'inherit',
                  fontSize: 12, fontWeight: 700, cursor: 'pointer', textTransform: 'capitalize',
                }}>Mark {s}</button>
              ))}
            </div>
            <div style={{ marginTop: 12 }}>
              {confirming ? (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={remove} disabled={busy} style={{
                    flex: 1, padding: '11px 0', borderRadius: 12, border: 'none',
                    background: 'var(--danger)', color: '#fff', fontFamily: 'inherit',
                    fontSize: 14, fontWeight: 700, cursor: 'pointer',
                  }}>{busy ? 'Deleting…' : 'Delete permanently'}</button>
                  <button onClick={() => setConfirming(false)} style={{
                    flex: 1, padding: '11px 0', borderRadius: 12, border: 'none',
                    background: 'var(--bg-card-2)', color: 'var(--text-secondary)',
                    fontFamily: 'inherit', fontSize: 14, fontWeight: 700, cursor: 'pointer',
                  }}>Keep</button>
                </div>
              ) : (
                <button onClick={() => setConfirming(true)} style={{
                  border: 'none', background: 'transparent', color: 'var(--danger)',
                  fontFamily: 'inherit', fontSize: 13, fontWeight: 700, cursor: 'pointer', padding: 0,
                }}>Delete listing</button>
              )}
            </div>
          </div>
        ) : (
          <button
            onClick={() => onMessageSeller?.(listing.seller)}
            disabled={!listing.seller}
            style={{
              width: '100%', marginTop: 26, padding: '14px 0', borderRadius: 14, border: 'none',
              background: listing.seller ? 'var(--text)' : 'var(--bg-card-2)',
              color: listing.seller ? 'var(--bg)' : 'var(--text-tertiary)',
              fontFamily: 'inherit', fontSize: 15, fontWeight: 700,
              cursor: listing.seller ? 'pointer' : 'default',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}>
            <IconSend size={16} />
            {listing.seller ? `Message @${listing.seller.username}` : 'Seller unavailable'}
          </button>
        )}
      </div>

      {sharing && (
        <ShareSheet
          url={listingUrl(listing.id)}
          title={`${listingTitle(listing)} — ${priceLabel(listing)}`}
          text={listing.description ?? ''}
          myId={myId}
          onClose={() => setSharing(false)}
        />
      )}
    </div>
  )
}
