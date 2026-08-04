# AVIARA backend architecture

**Status:** proposal, 2026-08-03. Nothing here is built yet.
**Goal:** the infrastructure required to operate at ForeFlight's level, starting
with the pieces that unlock everything else.

---

## Why a backend at all

Today AVIARA is a static PWA plus Vercel serverless functions. Every function
starts cold, answers one request, and dies. That is a genuinely good fit for
what the app does now, and a hard stop for everything below it:

| Capability | Why serverless can't do it |
|---|---|
| NOTAM mirror | Needs a subscriber holding an open connection to the FAA, indefinitely |
| Real-time TFRs | Same — a push stream, not a poll |
| Push notifications | Needs to know what changed while nobody had the app open |
| Flight plan filing | Vendor credentials that must never reach a phone, plus session state |
| Mobile Clearance | Delivered to a *filing provider*, so it inherits all of the above |

Everything ForeFlight does that AVIARA doesn't traces back to one difference:
they run always-on services with their own copy of the data. That is the gap
to close first, because it is the only one that needs no one's permission.

---

## Shape

Three pieces, each doing the one thing it is good at.

```
┌─────────────────────────────────────────────────────────────┐
│  PWA  (Vercel — unchanged)                                  │
│  UI, charts, IndexedDB offline cache, social via Supabase   │
└───────────────┬──────────────────────┬──────────────────────┘
                │                      │
                │ reads                │ reads/writes
                ▼                      ▼
┌───────────────────────────┐  ┌──────────────────────────────┐
│  Postgres  (Supabase)     │  │  aviara-svc   (always-on)    │
│  • social (today)         │◄─┤  • SWIM/SCDS subscriber      │
│  • notams  (new)          │  │  • NOTAM/TFR ingest          │
│  • tfrs    (new)          │  │  • Leidos filing proxy       │
│  • wx cache(new)          │  │  • push notifications        │
│  • subscriptions (new)    │  │  • scheduled data refreshes  │
└───────────────────────────┘  └──────────────────────────────┘
                                        │
                          ┌─────────────┴──────────────┐
                          ▼                            ▼
                   FAA SWIM / SCDS            Leidos Flight Service
                   (NOTAMs, TFRs, flight)     (file / brief / activate)
```

**The PWA does not talk to the FAA or Leidos directly, ever.** It reads
Postgres. That is what makes the app fast and offline-capable: a NOTAM lookup
becomes a local database query against data that is already current, instead of
a network round trip to Washington while the pilot is standing on a ramp with
one bar of signal.

---

## The three pieces

### 1. Postgres — Supabase, extended

Already there, already holding the social schema, already has RLS the app
trusts. Adding operational data to it rather than standing up a second database
keeps one backup story, one access-control model, one thing to reason about.

New tables, roughly:

- `notams` — the mirror. One row per NOTAM, keyed by FAA id, with the parsed
  Q-code fields the client already understands (`src/lib/notams.js` does this
  parsing today and can move server-side unchanged), plus geometry for
  "NOTAMs along my route".
- `tfrs` — same idea, with polygons.
- `wx_cache` — shared METAR/TAF cache. Today every device fetches its own; one
  shared cache cuts upstream traffic by however many pilots are using the app.
- `subscriptions` — which pilot cares about which airports and routes, so the
  worker knows who to notify.
- `flight_plans` — local record of what was filed, so the app can show status
  without asking Leidos every time.

Cost: Supabase Pro, **$25/month**. The free tier pauses on inactivity, which is
disqualifying for something that must hold an open subscription.

### 2. `aviara-svc` — the always-on worker

A single small Node service. Not a monolith by ambition, just by starting size —
one process is easier to reason about than four, and it can be split later when
something actually needs to scale differently.

Responsibilities:

- **SWIM/SCDS subscriber.** Hold the connection, take the initial load of all
  active NOTAMs, apply the update stream, keep `notams` current.
- **Ingest and parse.** Reuse the Q-code parser already written and tested
  against live NAV CANADA data.
- **NAV CANADA poller.** Canada has no push feed, so poll on a schedule. This
  replaces the per-request proxy the app uses today.
- **Leidos proxy.** Holds the vendor credentials, exposes filing to the app.
- **Notifier.** Diff incoming NOTAMs/TFRs against `subscriptions`, send push.

Hosting: **Fly.io or Railway**, ~**$5–20/month** for an instance this size.
Both give a persistent process, a private network to Postgres, and deploy from
a Dockerfile. Neither locks anything in — it is a Node process.

### 3. The PWA — mostly unchanged

The client changes are small and mostly deletions. `src/lib/notams.js` stops
calling `/api/notams` and reads Supabase instead; `api/notams.js` and its dev
proxy retire. The parsing, grouping, this-airport-vs-FIR split and the whole
NOTAMs tab keep working exactly as they do now, against better data.

---

## What this costs

| | Monthly |
|---|---|
| Supabase Pro | $25 |
| Worker host | $5–20 |
| SWIM/SCDS access | $0 — sign a Service Access Agreement |
| FAA NOTAM API | $0 |
| **Total** | **~$30–45** |

That is the honest number for this phase, and it is worth stating plainly
because "compete with ForeFlight" sounds like it should start at a different
order of magnitude. It doesn't. The expensive parts come later and are
licensing, not infrastructure.

**Not included, and these are the real money:** Jeppesen or equivalent chart
licensing, NAV CANADA chart licensing (their charts are paywalled — confirmed
earlier), liability insurance appropriate to an app that files IFR, and
whatever Leidos vendor onboarding turns out to require.

---

## Becoming a filing app

This is the strategically important half, because **FAA Mobile Clearance is
delivered "via flight plan service provider applications."** No filing
capability, no clearances. Ever. It is a prerequisite, not a parallel track.

What is known:

- Leidos Flight Service runs Flight Service under FAA contract for CONUS,
  Alaska, Hawaii and Puerto Rico.
- They publish **Flight Service Web Services** for third-party vendors,
  supporting file, retrieve, amend, activate, close, cancel, and pilot profile
  management — the full lifecycle.
- Documentation and a vendor support wiki are public. There is a Service
  Provider Integration page and a vendor support contact.
- ForeFlight and Garmin are integrated the same way. ForeFlight sends **VFR**
  plans to Leidos; **IFR** plans go directly to the FAA centre computer.

What is not yet known, and needs a conversation with Leidos rather than more
searching:

- What vendor onboarding requires — agreement, testing, certification, fees.
- Whether a Canadian-registered entity can be a vendor for a US FAA contract
  service, and what that implies about incorporation.
- The IFR path. VFR goes via Leidos; IFR filing to the FAA centre computer may
  be a separate arrangement.
- Whether Mobile Clearance participation is open to any filing vendor or is
  invitation-only during the evaluation period (ends February 2027).

**Near-term, before any of that:** make the handoff to an existing provider
seamless. AVIARA builds the flight plan — route, aircraft, times, fuel — and
hands it to 1800wxbrief with everything pre-filled, so the pilot files in two
taps instead of retyping it. Not filing, but it removes the friction today and
the data model it needs (a proper flight plan object) is exactly what real
filing needs tomorrow. Nothing is thrown away.

**For Canada:** NAV CANADA is the filing authority, a separate integration, and
the one that matters most for a Barrie-based pilot. Worth scoping in parallel
rather than treating the US as the only market.

---

## Order of work

Each step is independently useful. None is wasted if the next is delayed.

1. **Stand up `aviara-svc` + Supabase Pro.** Move the NAV CANADA NOTAM poller
   into it. Nothing user-visible changes except NOTAMs get faster and work
   offline. This proves the architecture on something already working.
2. **Apply for SCDS.** Create an account, sign the Service Access Agreement,
   subscribe to the FNS NOTAM feed. Free; the cost is calendar time.
3. **Build the NOTAM mirror** on the SWIM feed. US NOTAMs light up without ever
   needing the MyAccess portal that is currently blocked.
4. **Push notifications** for subscribed airports and routes. First capability
   that is genuinely ForeFlight-grade and visible.
5. **Flight plan object + seamless 1800wxbrief handoff.** Ships value now,
   builds the model filing needs.
6. **Contact Leidos vendor support.** Start onboarding. This is a
   correspondence-and-paperwork track that runs in the background.
7. **Real filing.** VFR via Leidos, IFR per whatever step 6 establishes.
8. **Mobile Clearance**, once a filing provider. Nationwide deployment is
   February 2027 — reaching this by then is not obviously out of reach.

Steps 1–5 need nobody's permission and cost under $50/month. Steps 6–8 are
gated on other people, which is exactly why 6 should start early and in
parallel rather than after 5 finishes.

---

## Open questions

- Does SCDS have a sandbox, or is the first subscription live data?
- Does the FNS initial load fit comfortably in Supabase, and at what row count?
- Leidos vendor requirements — the whole of it.
- Canadian incorporation implications for US vendor status.
- Liability posture once the app files. Needs an actual advisor, not an
  engineering answer.

## Sources

- [FAA Mobile Clearance](https://www.faa.gov/air_traffic/technology/mobile_clearance)
- [Getting Access to SWIM](https://www.faa.gov/air_traffic/technology/swim/products/get_connected)
- [What is SCDS](https://support.swim.faa.gov/hc/en-us/articles/360034501051-What-is-SCDS)
- [FNS NOTAM JMS service agreement](https://aa.data.faa.gov/data/service.jsf?uuid=08c4033e-5faf-421f-b235-71f28ca5d8d9)
- [FNS reference client](https://github.com/faa-swim/fns-client)
- [Leidos Flight Service Web Services support](https://lmfswebservices.atlassian.net/wiki/spaces/WSS/overview)
- [Leidos web services documentation](https://www.1800wxbrief.com/Website/resources/doc/WebService.xml)
