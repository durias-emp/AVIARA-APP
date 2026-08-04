// NAV CANADA — Canadian aerodromes.
//
// Poll, not push: plan.navcanada.ca answers per aerodrome and offers no
// subscription, so somebody has to decide what to ask about and how often.
// That is what notam_watch is for.
//
// Keyless and unauthenticated, which is generous of them and worth not
// abusing. The rate limit below is deliberately conservative — this is a
// public endpoint nobody is charging us for, and a mirror that hammers it
// would be a good way to lose access to it.

const ENDPOINT = 'https://plan.navcanada.ca/weather/api/alpha/'

// Requests per minute. ~1,900 Canadian aerodromes exist; at this rate a full
// sweep of a 200-airport watch list takes about seven minutes, which is far
// inside how fast NOTAMs actually change.
export const RATE_PER_MIN = 30

// Canadian idents are C-prefixed: CY**/CZ** for the main fields, plus the
// CN/CG/CS/CT.. small-aerodrome space.
const CANADIAN = /^C[A-Z0-9]{3}$/

export default {
  id: 'navcanada',
  name: 'NAV CANADA',
  mode: 'poll',
  ratePerMin: RATE_PER_MIN,

  covers: icao => CANADIAN.test(icao),

  // Returns RawNotam[] for one aerodrome. Throws on transport failure so the
  // caller can record last_error and back off; an aerodrome NAV CANADA does
  // not recognise is not a failure, it is an empty answer.
  async fetch(icao) {
    const url = `${ENDPOINT}?site=${encodeURIComponent(icao)}&alpha=notam`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'AVIARA/1.0 (+https://pqrh-app.vercel.app)' },
      signal: AbortSignal.timeout(20000),
    })
    if (!res.ok) throw new Error(`NAV CANADA HTTP ${res.status}`)
    const payload = await res.json()

    // Per-site problems come back in meta.messages rather than as a status
    // code — asking for a weather station instead of an aerodrome (CXBI)
    // returns alpha.geomInvalid. Not an error worth retrying.
    const problem = (payload?.meta?.messages ?? []).find(m => m?.type === 'error')
    if (problem && !(payload?.data ?? []).length) return []

    return (payload?.data ?? []).map(item => {
      let raw = '', english = null
      try {
        const t = JSON.parse(item.text)
        raw = t.raw ?? ''
        english = t.english ?? null
      } catch {
        raw = typeof item.text === 'string' ? item.text : ''
      }
      return {
        notamId: String(item.pk),
        raw,
        // Their plain-language translation where they supply one. Easier to
        // read than the abbreviated original, which is kept regardless
        // because it is the authoritative text.
        english,
        startsAt: item.startValidity ?? null,
        endsAt: item.endValidity ?? null,
      }
    }).filter(n => n.raw)
  },
}
