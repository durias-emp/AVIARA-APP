# aviara-svc

The always-on half of AVIARA. Today it keeps the NOTAM mirror current; see
`docs/backend-architecture.md` for where it goes next (SWIM ingest, push
notifications, the Leidos filing proxy).

It exists because a static PWA and serverless functions that die per request
cannot hold a subscription to a national NOTAM feed, cannot notice something
changed while nobody had the app open, and cannot hold vendor credentials.

## Try it without touching anything

```bash
cd services/aviara-svc
npm install
npm run dry-run
```

Runs the whole pipeline — fetch, parse, classify, build rows — against live
NOTAM data and prints what it *would* write. No credentials, no database, no
risk. This is how the FIR-wide merge bug was found before a single row reached
production, and it is the right way to review any change to ingest.

## Running for real

Needs, in `.env`:

| | |
|---|---|
| `SUPABASE_URL` | the project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | **service role** — bypasses RLS, must never reach a browser |

Optional: `POLL_INTERVAL_SEC` (default 300), `SEED_IDENTS`, and the FAA
credentials below.

Requires migration `0006_notam_mirror.sql`.

## Sources

Each authority is an adapter in `src/sources/`. The ingest loop knows only
`poll` and `stream`; adding a country is one file. Nothing in the schema or
the pipeline privileges any one of them.

| Source | Mode | State |
|---|---|---|
| `navcanada` | poll | **Working.** Keyless. Rate-limited to 30 req/min — it is a free public endpoint and worth not abusing |
| `faa` | stream (preferred) / poll | **Idle** until credentials exist. Says so loudly at startup rather than mirroring nothing quietly |

The FAA adapter supports both paths so whichever arrives first can be switched
on by configuration:

- **SCDS / SWIM** — the real pipe, and what a ForeFlight-grade mirror is built
  on. Initial load plus a held subscription. Set `SCDS_USERNAME` /
  `SCDS_PASSWORD`. The stream itself is not implemented: it cannot be written
  honestly without an account to see the actual message envelope. The FAA
  publish a [reference client](https://github.com/faa-swim/fns-client) to port.
- **NOTAM API** — per-airport, from the api.faa.gov portal. Strictly worse, and
  useful because it works the day credentials appear. Set
  `FAA_NOTAM_CLIENT_ID` / `FAA_NOTAM_CLIENT_SECRET`.

## Deploying

Build context is the **repo root**, not this directory — the worker shares
`src/lib/notamParse.js` with the PWA so the two can never disagree about what
a NOTAM says.

```bash
fly launch --dockerfile services/aviara-svc/Dockerfile   # from the repo root
fly secrets set SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=...
```

`GET /` returns health: uptime, per-source configured state, sweep count,
NOTAMs mirrored, errors.

## Design notes

**Nothing is deleted because a source returned nothing.** An empty response
can mean "this field has no NOTAMs" or "something broke upstream", and those
are indistinguishable at the HTTP layer. Rows expire on their own `ends_at`;
`last_seen` records when a source last vouched for one.

**`affected` is unioned, never replaced.** A FIR-wide NOTAM is returned for
every aerodrome in the FIR, and each fetch only knows about the one it asked
about. Replacing would make the last aerodrome polled the only one that can
find it — for a runway closure, a safety bug rather than a data bug. Hence
`upsert_notams()` in migration 0006 rather than a plain upsert.

**Polling is sequential and rate-limited.** These are other people's public
endpoints. A faster sweep is worth less than continued access to them.
