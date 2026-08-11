// One short-lived cache in front of /api/awc, shared by everything that asks.
//
// Seven places in this app fetch that proxy and none of them knew about the
// others: the weather card, the flight-category dots, the altimeter lookup in
// the GPS bar, the airport picker, the G-AIRMET hazard bands, the winds-aloft
// table (twice, from two different functions with the same URL) and the
// airport lookup. Opening the map with a couple of layers on asked the same
// service for overlapping data several times over, and panning asked again.
//
// Deliberately shaped as a drop-in for fetch. It takes the same arguments and
// returns a real Response, so a caller changes one word and keeps its own
// parsing and its own error handling exactly as written. That matters more
// here than it usually would, because those error paths are not incidental:
// weather.js distinguishes a 204 "no station here" from a failed request, and
// that distinction is the gate on whether the app is allowed to show substitute
// weather for a field. A cache that flattened it would put modelled numbers
// where a real observation should be, which is the one thing this app must not
// do. So the cache carries the status through untouched and decides nothing.
//
// What it will not do:
//
//   - It never caches a failure. A throw, or any non-2xx, goes straight back
//     to the caller and nothing is stored, so a service having a bad minute
//     cannot be served for the rest of the minute. The next call is a real
//     request.
//   - It never serves anything past the TTL. There is no stale-while-revalidate
//     and no fallback-to-stale-on-error, on purpose: a pilot reading a figure
//     from a cache that has given up on refreshing is worse off than one being
//     told the request failed.

// Long enough to collapse the burst of requests that a screen makes as it
// opens and as a finger pans, short enough to be invisible against what is
// behind it. A METAR is issued hourly, a TAF less often than that, and
// G-AIRMETs on a fixed cycle, so nothing upstream changes inside this window.
const TTL_MS = 45_000

// The cache is keyed by URL, which already carries the path and every
// parameter, so two callers asking the same question in different words do not
// exist: they either build the same URL or they are asking different things.
const responses = new Map()   // url -> { at, status, statusText, body }
const inflight = new Map()    // url -> Promise<{ status, statusText, body }>

// A flat cap with a flat clear. The working set is one screen's worth of
// requests and bbox URLs vary continuously as the map moves, so an unbounded
// map would grow all session for entries nobody will ask for twice.
const MAX_ENTRIES = 120

// Statuses that are not allowed to carry a body. Reconstructing a cached 204
// as `new Response(body, { status: 204 })` throws a TypeError, which would
// have turned the "no station here" answer into a broken one the first time a
// second caller asked for the same empty station.
const NULL_BODY = new Set([204, 205, 304])

function toResponse({ status, statusText, body }) {
  return new Response(NULL_BODY.has(status) ? null : body, { status, statusText })
}

// The shared request carries no caller's abort signal.
//
// With more than one caller waiting on a single fetch, honouring the first
// one's timeout would cancel it for everybody else, so whoever asked first
// would decide when everyone else gave up. Instead the shared fetch runs to
// its own ceiling, above every caller's own timeout, and each caller's signal
// is applied to its own promise below. One caller giving up no longer takes
// the answer away from the others.
const SHARED_TIMEOUT_MS = 15_000

async function requestOnce(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(SHARED_TIMEOUT_MS) })
  // Read here, once, so every caller gets its own fresh Response to consume.
  // A Response body can only be read a single time, so handing the same one to
  // two callers would give the second an already-used stream.
  const body = NULL_BODY.has(res.status) ? '' : await res.text()
  return { status: res.status, statusText: res.statusText, body }
}

// Reject when the caller's own signal aborts, without disturbing the shared
// request that other callers are still waiting on.
function withSignal(promise, signal) {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

export default function awcFetch(url, init = {}) {
  const key = String(url)

  const hit = responses.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) {
    return Promise.resolve(toResponse(hit))
  }
  // Past its TTL it is not data any more. Dropped rather than left to be
  // stepped over, so nothing downstream can reach for it as a fallback.
  if (hit) responses.delete(key)

  let shared = inflight.get(key)
  if (!shared) {
    shared = requestOnce(key)
      .then((result) => {
        // Only a real answer is worth keeping. Anything else and the next
        // caller does a real request rather than being handed this minute's
        // bad luck.
        if (result.status >= 200 && result.status < 300) {
          if (responses.size >= MAX_ENTRIES) responses.clear()
          responses.set(key, { at: Date.now(), ...result })
        }
        return result
      })
      .finally(() => { inflight.delete(key) })
    inflight.set(key, shared)
  }

  return withSignal(shared.then(toResponse), init.signal)
}

// For tests and for the console when something looks wrong. Not called by the
// app: entries expire on their own.
export function clearAwcCache() {
  responses.clear()
  inflight.clear()
}
