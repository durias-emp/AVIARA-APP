# PQRH App — Backlog & Roadmap

Last updated: 2026-07-03

Legend: 🟢 Quick win (no dependencies) · 🟡 Medium (design + build) · 🔴 Large / needs research · ⛔ Blocked

---

## Phase 1 — Quick Wins (start here)

Small, self-contained fixes. No research or external dependencies. Good for fast, visible progress.

- ✅ ~~Rename "Checklist" box to **"Flight Planning"**; remove the intermediate screen — tapping it should jump straight into the checklist.~~ **Done**
- ✅ ~~Move the **CX-3 calculator** button to the top of the Calculator section.~~ **Done**
- 🟢 Redesign Section 5 (Pilot) of the checklist — currently just 2 options, needs a cleaner layout.
- 🟢 Passenger-carrying currency → two checkboxes ("3 takeoffs/landings in 90 days — Day" / "— Night"), acknowledgment style, not a date field.
- 🟢 IFR currency: **IPC** = date field. Separate **6 approaches / 6 hours / holds (6-6-6)** rule = a plain checkbox acknowledgment statement (too impractical to track every approach individually).
- 🟢 Rename "Flight Plan Filed" → **"Flight Plan / Itinerary Filed"**, keep as a simple check item for now.
- 🟢 CARROW → rename/restructure to **"Aircraft Documents Onboard"**: a checkbox with a dropdown listing the required documents. Add insurance as its own separate note ("optional for privately registered aircraft") rather than folding it into the acronym.
- 🟢 Remove **IMSAFE** from the Currency section entirely — it belongs only in the Flight Plan Checklist (this was flagged twice in your notes, treating as final).
- 🟢 Add **"Aircraft Documents Onboard"** and **IMSAFE** to the Flight Plan Checklist too — both are per-flight quick checks, not scheduled/expiring items like the rest of Currency.
- 🟢 Make checklist checkmarks interactive (tappable, not just visual).
- 🟢 Add unit toggle support app-wide: ft ↔ m, NM ↔ km, gal ↔ liters, lbs ↔ kg — wherever a unit currently appears.
- 🟢 Hobbs input field: pre-fill placeholder with the previously logged Hobbs time. **Why it matters (from 2026-07-03 conversation):** Hobbs is a global counter used across the app — it drives every hour-based maintenance/currency item (100-hr inspection, oil change, etc.), the same way the phone's calendar automatically drives every date-based item (medical, annual, etc.). Calendar items sync themselves; Hobbs is the one thing the pilot must manually enter each time. Likely lives on the home screen, possibly integrated into/near the aircraft profile button (e.g. the "Pilatus PC-12" selector). Workflow: pilot opens logbook, takes the last recorded time, plugs it in — if the app's been kept current, it then catches/flags anything due for him automatically.
- 🟢 Inspections: add a **Total Time** input. App compares it against fixed due-dates/due-times and tells the pilot which inspections are current, which are coming due, and hours/days remaining to each.
- 🟢 Add a rotating/fading aviation quotes ticker near the bottom of the home screen (list already provided — see Appendix).

## Phase 2 — Foundational Features

Used by or feed into other features — worth building carefully once, early.

- 🟡 **Pilot profile setup**: first name, last name, phone, email — stored and auto-filled into flight planning.
- 🟡 **Fuel calculator**: bidirectional Jet-A conversion (gallons ↔ lbs/kg ↔ liters). Place as the 2nd calculator option (right under CX-3, most-used). Also embed the same calculator inside Weight & Balance.
- 🟡 Placeholder aircraft image/icon for aircraft with no photo — a generic symbol (deliberately not shaped like any real aircraft), plus a "describe your aircraft to the AI" editor option. (3D-model-from-photos is a fun stretch goal, not near-term.)
- 🟡 Add an **acronym reference section** (general aviation acronyms).
- 🟡 **Home screen nav restructure** (from 2026-07-03 conversation, resolves the old "AIn LAW = REGULATIONS" / "2 NEW DIFFERENT CARDS" open questions): keep the main grid at 4 buttons — don't overload it. Rename the 4th button (bottom-right, currently "References") to **"Quick Reference"** and make it prominent/full-size like the other 3: houses lost-comm procedures, light gun signals, and marshalling signal images. **Air Law** and a renamed **"Regulations"** (was "References") become secondary, smaller/thinner buttons — same visual tier as each other, both less prominent than the main 4 since they're used less often. Reserve 2 more blank button slots for later (Diego to decide what fills them).
- 🟡 **Global currency status indicator**: the Currency button/icon on the home screen should change color based on the pilot's overall status — green when every tracked item is current, yellow when something's approaching its due date, red when anything's expired. Goal: pilot sees at a glance whether they're current without opening the Currency section.

## Phase 3 — Checklist Redesign

Structural rework that many later items plug into.

- 🟡 New checklist flow: horizontal "book page" style, left → right through sections — En Route → Performance → Airport → Aircraft → Pilot — with a section turning green on completion. Interactive, clear directional flow.
- 🟡 Add **Weight & Balance** to the flight plan checklist. ⛔ **Blocked — waiting on ForeFlight screenshots from Diego** to match the reference format.
- 🟡 Add a **customizable "Aircraft Checklist"** section — pilot-entered custom check items. Still deciding: own section, or folded into the existing Aircraft section.

## Phase 4 — Flight Plan "One-Pager" + Weather Depth

Bigger design questions — needs a decision on what data to include before building.

- 🔴 Flight plan one-pager: after finishing all checklists, generate a single page broken into stages (Takeoff / En Route / Landing). Printable AND interactive in-app — tapping the current phase highlights only that stage's info. Ties in FBO frequency from the checklist. **Open question: exactly which data fields per stage** — needs a follow-up pass to decide.
- 🔴 Home screen weather widget should be tappable → shows METAR/TAF for the airport. (Depends on the weather indicator bug fix, currently with Codex.) **Reference (2026-07-03, ForeFlight Mobile Guide screenshots):** the airport weather page should show, per METAR/TAF cycle — a Flight Category dot (color per standard below), Wind (direction/speed range), Visibility, Clouds AGL (each layer), and a "Change" trend indicator (e.g. Gradual), plus the raw METAR/TAF text with color-coded lines matching flight category severity. Model after ForeFlight's airport page: Info / Weather / Runway / Procedure / NOTAM tabs, with Weather sub-tabs for METAR / ATIS / TAF / MOS / Daily / Winds.
- 🔴 Weather explanation section: chart/legend reference, cloud types, what warm/cold fronts bring. Should include an in-app legend/key for every map overlay color code below so pilots can look up what a color means without leaving the app.
- 🔴 Map overlays for route/altitude selection — modeled after ForeFlight's map layers (2026-07-03 reference), each using standard aviation color coding:
  - **Flight Category layer** (METAR-derived, refresh ~5 min, drop after 3 hrs stale): 🟣 LIFR (ceiling <500ft or vis <1mi) · 🔴 IFR (ceiling 500–<1000ft or vis 1–<3mi) · 🔵 MVFR (ceiling 1000–3000ft or vis 3–5mi) · 🟢 VFR (ceiling >3000ft and vis >5mi, incl. sky clear).
  - **Ceiling layer**: 🟣 <500ft · 🔴 500–999ft · 🔵 1000–2999ft · 🟢 ≥3000ft.
  - **Visibility layer**: 🟣 <1sm · 🔴 1–2sm · 🔵 3–5sm · 🟢 >5sm.
  - **Sky Coverage layer**: METAR-derived cloud coverage on the map.
  - **AIRMET / SIGMET / CWA layer** (icing, turbulence, IFR, mountain obscuration, convective outlook, all SIGMET types) — color-coded shapes, tappable to open a sidebar of overlapping advisories with full detail + highlighted boundary. This is the actual icing/turbulence overlay already on the backlog — now with a concrete color/legend spec instead of "TBD."
  - **Cameras layer**: airport camera icons, tap for latest views (lower priority, nice-to-have).
  - Note: GAFOR (Germany/Switzerland difficulty index) appeared in the same reference material but is Europe-specific — skip it, not relevant for a North America–focused app.
- 🔴 Research: how Canada/US flight planning services currently handle digital flight plan filing — informs the "Flight Plan/Itinerary Filed" feature and one-pager format.

## Phase 5 — AI / Advanced Features (V1.5+/V2 candidates)

- 🔴 AI route weather briefing: best-guess weather along the route by altitude/time, suggests altitude/routing around icing, TFRs, turbulence, and explains its reasoning.
- 🔴 AI alternate airport suggestion that accounts for the actual alternate minimums tied to the intended approach type.
- 🔴 Takeoff alternate suggestion for IFR departures from airports with non-precision approaches only.
- 🔴 Takeoff run / accelerate-stop distance / landing distance calculator, POH-based: pilot inputs weight, weather, runway; app computes wind component and spits out the three distances. ("Runway breakdown" note, inspired by ForeFlight.) ⛔ **Blocked (2026-07-03):** the math itself is straightforward — the hard part is designing what the pilot needs to input to build a usable aircraft performance profile (same challenge as Weight & Balance: bad input → wrong/unsafe output). **Waiting on Diego to write up the actual POH performance-chart methodology** (how takeoff/landing distance charts are read and corrected for weight, pressure altitude, temperature, wind, runway surface/slope, etc.) so that write-up can be handed to the coding side to design the input flow correctly.
- 🔴 VFR/IFR fuel minimums logic — differs between airplanes and helicopters.
- 🔴 Airworthiness Directives (A/Ds) + Service Bulletins by aircraft make/model/year — needs a data source.
- 🔴 Logbook feature — reference ForeFlight screenshot (same blocker as W&B, awaiting screenshots).

## Blocked / Waiting

- ⛔ Weather indicator (top of app) not working — handed off to Codex. **Likely root cause (2026-07-03):** Diego swapped in a new weather dashboard component for a different change, which appears to have disconnected the existing runway wind-component display. See runway wind analysis item below — probably the same bug.
- ⛔ **Runway wind / "best runway" analysis is disconnected** — this used to work and needs to be restored (probably alongside the weather indicator fix above). Full spec, since it's easy to lose: for the current airport, show **every runway direction** (e.g. runway 05 and runway 23 as separate rows, not just one "05/23" entry), and for each compute headwind/tailwind + crosswind component from the current METAR. Green = headwind (good), red = tailwind (avoid). Whichever direction has the headwind component is flagged as the **best runway** — for planning purposes only, not an ATC assignment. Because a two-way runway's components are always mirror images (one direction's headwind = the other's tailwind, same magnitude), the "best" runway is just whichever face currently has the wind mostly behind the nose.
- ⛔ FAA NOTAM integration — Diego's login.gov account is blocked; needs a new login.gov account or [email protected] fix, then register free at api.faa.gov.
- ⛔ Weight & Balance checklist item + Logbook feature — both waiting on ForeFlight reference screenshots from Diego.
- ⛔ Takeoff/landing/accel-stop distance calculator (see Phase 5) — waiting on Diego's written POH methodology explanation.

## Open Questions / Needs Clarification (flagged, not blocking)

- ~~"AIn LAW = REGULATIONS"~~ — **Resolved 2026-07-03:** see the Home screen nav restructure item in Phase 2 (Air Law + Regulations become secondary/smaller buttons).
- ~~"2 NEW DIFFERENT CARDS"~~ — **Resolved 2026-07-03:** the 2 reserved blank button slots in the same nav restructure item.
- Exact data fields for the flight-plan one-pager per stage (Takeoff/En Route/Landing).
- Where the customizable Aircraft Checklist lives (own section vs. inside Aircraft).

## Deferred (not now, revisit later)

- Bottom tab/nav bar — considered for a future map feature and extra sections, but app is close to "template-ready" with just minor adjustments left. Don't overload it now. If added later, keep it minimal (~3 buttons).

---

## Appendix — Aviation Quotes (for the home screen ticker)

1. There are old pilots, and there are bold pilots, but there are no old, bold pilots.
2. Aviation is inherently risky, and it's a pilot's job to keep the risk to a minimum.
3. It's better to be on the ground wishing you were in the air than in the air wishing you were on the ground.
4. Any landing you can walk away from is a good one, and any one you can use the plane again is a great one.
5. Aviate. Navigate. Communicate.
6. There are no emergency takeoffs, only emergency landings.
