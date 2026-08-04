// The FAA — United States, and the source that matters most by volume.
//
// Two ways in, and this adapter supports both because they arrive on
// different timelines:
//
//   SWIM / SCDS  (mode: 'stream', preferred)
//     The real pipe, and what a ForeFlight-grade mirror is built on. Take an
//     initial load of every active US NOTAM, then hold a subscription and
//     apply updates as they are issued. Needs an SCDS account and a signed
//     Service Access Agreement — free, but it is paperwork with a calendar
//     attached. See docs/backend-architecture.md step 2.
//
//   NOTAM API   (mode: 'poll', fallback)
//     external-api.faa.gov, per-airport, needs a client id/secret from the
//     api.faa.gov portal. Same shape as NAV CANADA: ask about one field at a
//     time. Strictly worse than the stream, and useful precisely because it
//     can be switched on the day credentials appear without waiting for SCDS.
//
// Which one is live is decided by configuration, not by editing code: set
// SCDS credentials and it streams, set portal credentials and it polls, set
// neither and it reports itself unconfigured so the ingest loop skips it and
// says so out loud rather than silently mirroring nothing.

const API = 'https://external-api.faa.gov/notamapi/v1/notams'

const US = /^(K[A-Z]{3}|P[AH][A-Z]{2})$/

function mode(env) {
  if (env.SCDS_USERNAME && env.SCDS_PASSWORD) return 'stream'
  if (env.FAA_NOTAM_CLIENT_ID && env.FAA_NOTAM_CLIENT_SECRET) return 'poll'
  return 'unconfigured'
}

export default {
  id: 'faa',
  name: 'FAA',

  covers: icao => US.test(icao),

  get mode() { return mode(process.env) },
  get configured() { return mode(process.env) !== 'unconfigured' },

  // Why this source is not running, in a sentence a human can act on. The
  // ingest loop logs it once per start rather than failing quietly — an
  // empty US mirror that nobody notices is the worst outcome available.
  get unconfiguredReason() {
    return 'FAA source idle: set SCDS_USERNAME/SCDS_PASSWORD for the SWIM stream '
         + '(preferred), or FAA_NOTAM_CLIENT_ID/FAA_NOTAM_CLIENT_SECRET for the '
         + 'per-airport API. See docs/backend-architecture.md.'
  },

  // ── Poll path ─────────────────────────────────────────────
  async fetch(icao) {
    if (mode(process.env) !== 'poll') {
      throw new Error('FAA poll path not configured')
    }
    const res = await fetch(`${API}?icaoLocation=${encodeURIComponent(icao)}&pageSize=50`, {
      headers: {
        client_id: process.env.FAA_NOTAM_CLIENT_ID,
        client_secret: process.env.FAA_NOTAM_CLIENT_SECRET,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(20000),
    })
    if (!res.ok) throw new Error(`FAA HTTP ${res.status}`)
    const payload = await res.json()

    // Written to the FAA's documented v1 shape and never yet run against the
    // live service — this project has no credentials. So it refuses loudly on
    // an unexpected shape instead of returning [], which would look exactly
    // like "no NOTAMs in the United States".
    if (!Array.isArray(payload?.items)) {
      throw new Error('FAA NOTAM API returned an unexpected shape — adapter needs updating')
    }

    const out = []
    for (const item of payload.items) {
      const core = item?.properties?.coreNOTAMData?.notam
      if (!core) continue
      const translated = (item.properties.coreNOTAMData.notamTranslation ?? [])
        .find(t => t?.formattedText)?.formattedText
      out.push({
        notamId: String(core.number ?? core.id),
        raw: translated || core.text || '',
        startsAt: core.effectiveStart ?? null,
        endsAt: core.effectiveEnd ?? null,
      })
    }
    return out.filter(n => n.raw)
  },

  // ── Stream path ───────────────────────────────────────────
  //
  // Not implemented: it cannot be written honestly without an SCDS account to
  // see the actual message envelope and initial-load format against. The
  // FAA publish a reference client (github.com/faa-swim/fns-client) which is
  // the thing to port here once access exists.
  //
  // Shape it will have:
  //   1. pull the FNS Initial Load over SFTP, upsert every active NOTAM
  //   2. hold the SCDS subscription, upsert each update as it arrives
  //   3. on reconnect, re-run the initial load — updates missed while
  //      disconnected are gone, and a mirror that silently drops NOTAMs is
  //      worse than one that is briefly slow
  async subscribe() {
    throw new Error('SWIM/SCDS stream not implemented — awaiting SCDS access')
  },
}
