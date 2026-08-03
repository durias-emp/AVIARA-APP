// Marketplace listings, against `listings` / `listing_media` in
// supabase/migrations/0002_social.sql, extended by 0005.
//
// Same shape as posts.js and for the same reasons — plain functions, a
// second query for seller details because listings.seller_id references
// auth.users rather than profiles, and media created after the row so a
// failure leaves something visible and deletable rather than orphaned bytes.
//
// One difference that matters: listings are readable by anyone, signed in or
// not (`using (true)` in 0002). A marketplace only works if buyers can browse
// it, so none of the read paths here assume a session.

import { supabase } from './supabase'
import { uploadImages, removeByUrls } from './media'

export const ENGINE_TYPES = [
  { key: 'piston', label: 'Piston' },
  { key: 'turboprop', label: 'Turboprop' },
  { key: 'jet', label: 'Jet' },
  { key: 'other', label: 'Other' },
]

export const CURRENCIES = ['USD', 'CAD', 'EUR', 'GBP']

export const STATUSES = ['active', 'pending', 'sold', 'withdrawn']

const CARD_FIELDS =
  'id, seller_id, make, model, year, price_usd, currency, location, engine_type, ' +
  'total_time_hours, status, created_at, listing_media(url, position)'

const FULL_FIELDS = CARD_FIELDS +
  ', registration, engine_time_hours, description, specs, updated_at'

function sortMedia(row) {
  return { ...row, listing_media: [...(row.listing_media ?? [])].sort((a, b) => a.position - b.position) }
}

async function withSellers(rows) {
  if (!rows.length) return rows
  const ids = [...new Set(rows.map(r => r.seller_id))]
  const { data } = await supabase
    .from('profiles').select('id, username, display_name, avatar_url').in('id', ids)
  const by = new Map((data ?? []).map(p => [p.id, p]))
  return rows.map(r => ({ ...r, seller: by.get(r.seller_id) ?? null }))
}

// Price bands, as the marketplace chips express them. Kept here rather than
// in the component so the filter and the label can never drift apart.
export const PRICE_BANDS = [
  { key: 'any', label: 'Any price', min: null, max: null },
  { key: 'lt100', label: 'Under $100k', min: null, max: 100000 },
  { key: '100-500', label: '$100k–$500k', min: 100000, max: 500000 },
  { key: 'gt500', label: '$500k+', min: 500000, max: null },
]

// Browsing. Withdrawn listings are never returned — the seller has said they
// don't want it seen — but sold and pending ones are, because "what did this
// actually go for" is half of why anyone watches a market.
export async function listListings({ priceBand = 'any', engineType = null, limit = 40 } = {}) {
  let q = supabase
    .from('listings')
    .select(CARD_FIELDS)
    .neq('status', 'withdrawn')
    .order('created_at', { ascending: false })
    .limit(limit)

  const band = PRICE_BANDS.find(b => b.key === priceBand)
  if (band?.min != null) q = q.gte('price_usd', band.min)
  if (band?.max != null) q = q.lt('price_usd', band.max)
  if (engineType) q = q.eq('engine_type', engineType)

  const { data, error } = await q
  if (error) return { data: [], error }
  return { data: await withSellers((data ?? []).map(sortMedia)), error: null }
}

export async function getListing(id) {
  const { data, error } = await supabase.from('listings').select(FULL_FIELDS).eq('id', id).maybeSingle()
  if (error || !data) return { data: null, error }
  const [withSeller] = await withSellers([sortMedia(data)])
  return { data: withSeller, error: null }
}

export async function listMyListings(sellerId) {
  const { data, error } = await supabase
    .from('listings')
    .select(CARD_FIELDS)
    .eq('seller_id', sellerId)
    .order('created_at', { ascending: false })
  return { data: (data ?? []).map(sortMedia), error }
}

// Strips empty values so the stored spec sheet holds only what the seller
// actually filled in — an empty string in jsonb reads as "they said it was
// blank" rather than "they didn't say".
function cleanSpecs(specs) {
  const out = {}
  for (const [k, v] of Object.entries(specs ?? {})) {
    const val = typeof v === 'string' ? v.trim() : v
    if (val !== '' && val != null) out[k] = val
  }
  return out
}

const numeric = v => {
  if (v === '' || v == null) return null
  const n = Number(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

// Row first, then photos — same order and same rollback as createPost, for
// the same reason: a listing with no pictures is fixable by its seller, and
// uploads with no row are invisible to everyone including them.
export async function createListing({ sellerId, fields, specs, files = [], onProgress }) {
  if (!sellerId) return { error: new Error('Not signed in') }
  if (!fields?.make?.trim() && !fields?.model?.trim()) {
    return { error: new Error('Give the aircraft at least a make or a model') }
  }

  let uploaded = []
  try {
    if (files.length) {
      uploaded = await uploadImages(files, { kind: 'listings', userId: sellerId, onProgress })
    }
  } catch (err) {
    return { error: err }
  }

  const row = {
    seller_id: sellerId,
    make: fields.make?.trim() || null,
    model: fields.model?.trim() || null,
    year: numeric(fields.year),
    registration: fields.registration?.trim() || null,
    total_time_hours: numeric(fields.total_time_hours),
    engine_time_hours: numeric(fields.engine_time_hours),
    price_usd: numeric(fields.price_usd),
    currency: CURRENCIES.includes(fields.currency) ? fields.currency : 'USD',
    location: fields.location?.trim() || null,
    description: fields.description?.trim() || null,
    engine_type: fields.engine_type || null,
    status: STATUSES.includes(fields.status) ? fields.status : 'active',
    specs: cleanSpecs(specs),
    updated_at: new Date().toISOString(),
  }

  const { data: listing, error } = await supabase.from('listings').insert(row).select('id').single()
  if (error) {
    await removeByUrls(uploaded.map(u => u.url))
    return { error }
  }

  if (uploaded.length) {
    const { error: mediaError } = await supabase.from('listing_media').insert(
      uploaded.map((u, i) => ({ listing_id: listing.id, url: u.url, position: i }))
    )
    if (mediaError) {
      await supabase.from('listings').delete().eq('id', listing.id)
      await removeByUrls(uploaded.map(u => u.url))
      return { error: mediaError }
    }
  }

  return { data: listing }
}

// updated_at is maintained here rather than by a trigger — same convention
// 0002 documents for conversations.last_message_at.
export async function updateListingStatus(id, status) {
  if (!STATUSES.includes(status)) return { error: new Error('Unknown status') }
  return supabase.from('listings')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id)
}

export async function deleteListing(listing) {
  const urls = (listing.listing_media ?? []).map(m => m.url)
  const { error } = await supabase.from('listings').delete().eq('id', listing.id)
  if (error) return { error }
  await removeByUrls(urls)
  return { error: null }
}

// ── Formatting ───────────────────────────────────────────────

const SYMBOL = { USD: '$', CAD: 'C$', EUR: '€', GBP: '£' }

export function priceLabel(listing) {
  const n = listing?.price_usd
  if (n == null) return 'Price on request'
  const sym = SYMBOL[listing.currency] ?? '$'
  return `${sym}${Math.round(n).toLocaleString()}`
}

// "2004 Cessna 172S" — year first, the way every aircraft ad is written.
export function title(listing) {
  return [listing?.year, listing?.make, listing?.model].filter(Boolean).join(' ') || 'Aircraft'
}

export function hoursLabel(h) {
  return h == null ? null : `${Math.round(h).toLocaleString()} hrs`
}
