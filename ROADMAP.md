# AVIARA: from V1 to a company

The goal is to compete with ForeFlight and Garmin by giving pilots a fresher
perspective, starting where those two are weakest.

This document is the order of operations. It is deliberately not a feature
list. Features are the easy part and you are already good at them; what
follows is the work that decides whether the app can be sold, whether it
survives an accident investigation, and whether the company behind it can hold
a contract.

Everything marked **BLOCKER** must be finished before you take money from
anyone. Everything marked **LAWYER** is a question for a qualified person in
the relevant country, not for a developer and not for an AI.

---

## The honest competitive position

You will not beat ForeFlight feature for feature. It has twenty years, Boeing's
balance sheet, and certified data contracts with Jeppesen. Garmin makes the box
in the panel, which no software can replicate. Competing head on means losing
slowly and expensively.

Both are weakest in the same place, and it is the place you have already
started digging:

- **They are built for the United States.** Coverage outside it is thin and
  the pricing assumes a US salary.
- **Central America is close to unserved.** The bundled worldwide database had
  *zero* heliports in El Salvador and five in Honduras against the national
  AIP's twenty-four. You have already fixed both from official sources. That
  data does not exist in ForeFlight.
- **Neither of them is social.** A pilot's flying is invisible to other
  pilots. That is the redesign's whole premise.

So the wedge is: **the best app for flying in Central America, that happens to
also be a flight log worth keeping.** Win a country, then a region, then argue
about the United States.

---

## Phase 1: Legal and data foundation

**Nothing here is optional and none of it can be deferred until after launch.
It gets more expensive the more you build on top of it.**

### 1.1 Licensing audit of every data source (BLOCKER)

The app calls twenty or so external services. Each one has terms, and "it has
a free tier" is not the same as "I may sell a product built on it".

- [ ] **openAIP (airspace layer)**: believed **CC BY-NC-SA**. The
      **NonCommercial** clause means the moment you charge for the app you are
      in breach. The **ShareAlike** clause may also force you to license
      derivatives the same way. This is the single biggest legal blocker in
      the codebase. Options: buy a commercial licence from openAIP, replace
      the layer with the national AIP airspace you are already collecting, or
      drop it. **Decide this before writing another feature on top of it.**
- [ ] **Open-Meteo**: free tier is non-commercial. Needs a paid plan.
- [ ] **CARTO basemaps**: free tier has request limits and commercial terms.
- [ ] **adsb.lol (live traffic)**: ODbL 1.0, commercial use permitted with
      attribution. Already attributed in the payload and rendered. **This one
      is fine**, keep it that way.
- [ ] **Iowa Environmental Mesonet (NEXRAD radar)**: public but confirm
      attribution and acceptable use.
- [ ] **FAA sources** (charts, TFR, NOTAM, eCFR): US government works, but
      confirm the ArcGIS tile services' terms of use separately from the data.
- [ ] **OurAirports**: public domain. Fine.
- [ ] **National AIP data (AAC El Salvador, AHAC Honduras)**: LAWYER. State
      aeronautical publications are often Crown or state copyright.
      Redistributing them in a commercial product may need permission. Ask the
      authorities directly; they are usually approachable and it is a chance
      to build the relationship you will want later.
- [ ] **OpenAI**: commercial use is fine, but confirm data handling: what
      pilot data leaves the device, and does the privacy policy say so.
- [ ] Write the findings into `legal/DATA_SOURCES.md`, one row per source:
      licence, commercial status, attribution required, where it appears in
      the UI, and who to contact.

### 1.2 The things that must be true about aviation data

- [ ] **Never present modelled data as official.** This is already a house
      rule in CLAUDE.md and it is already honoured in the code. Keep it
      absolutely. It is the difference between a defensible product and a
      negligent one.
- [ ] **Every figure carries its source**, visible to the pilot. Already done
      for the national aerodrome data. Extend it everywhere.
- [ ] **Say what is stale.** Data has an age; show it.
- [ ] **Document a data currency policy**: FAA data is on the 28-day AIRAC
      cycle and already automated. The hand-maintained national data is not.
      Decide who checks it, how often, and write it down.

### 1.3 Terms, privacy and the disclaimer that has to hold

- [ ] **Terms of Service**: LAWYER. Must include limitation of liability,
      "not for navigation" / supplemental-use-only language, and no warranty
      of data accuracy.
- [ ] **Privacy policy**: `legal/PRIVACY_POLICY.md` exists. Have it reviewed
      against what the app actually collects now: position, flight tracks,
      logbook, and anything sent to OpenAI.
- [ ] Confirm the **"Reference aid only, always consult current FAR/AIM"**
      notice appears where a court would expect it: at first run, in the
      terms, and in the app. Two of three are done.
- [ ] If you will have EU users, **GDPR**. If Salvadoran, the local data
      protection regime. LAWYER.

---

## Phase 2: Make V1 production grade

The app works. That is not the same as being ready for strangers.

### 2.1 Known defects, in priority order

- [ ] **The hangar fills with duplicate aircraft on every launch.** Confirmed:
      38 copies of one helicopter accumulated in testing, and the legacy
      record the migration deletes keeps coming back. This is live data
      corruption and it is the most serious open bug. Root cause looks like
      the migration racing the cloud restore.
- [ ] **`vercel.json` returns HTML for missing assets.** The catch-all rewrite
      answers any missing file with `index.html` and a **200**, so a client
      holding a cached page after a deploy receives HTML where it expects
      JavaScript and dies. Proven on production. This is the likeliest cause
      of the long-standing standalone white screen. Exclude `/assets/` from
      the rewrite so a missing file 404s honestly.
- [ ] **There is no error boundary anywhere in the app.** Any component that
      throws takes the whole screen to blank white, with no message and no
      way back. This happened during development and is exactly what a pilot
      must never see. Add one at the route level with a "reload" action.
- [ ] **iOS standalone white screen**: long-standing and unresolved. May be
      the rewrite bug above; verify after fixing it.

### 2.2 Things that do not exist yet and need to

- [ ] **Tests.** There is exactly one test file in the entire repo
      (`src/lib/currency.test.js`). Everything a wrong answer could hurt
      someone needs coverage first: weight and balance, fuel burn, distance
      and course, altitude selection, and the unit conversions under all of
      them. You do not need to test the UI. You do need to test the arithmetic.
- [ ] **Error monitoring.** No Sentry or equivalent. Right now a crash on a
      pilot's phone is invisible to you. This is the cheapest single
      improvement in this document.
- [ ] **Analytics you can act on**, without collecting more than you need.
- [ ] **Lint baseline.** 207 problems, of which 169 are errors. Most are
      pre-existing patterns rather than bugs, but the number means a real
      problem cannot be spotted. Drive it down deliberately.

### 2.3 Infrastructure

- [ ] **Separate development from production.** One live Supabase project
      currently serves both developers and real users, and migrations applied
      from a laptop change the production database for everyone. This will
      cause a data loss incident eventually. Split it.
- [ ] **Backups**, and a restore you have actually tested. An untested backup
      is a hope.
- [ ] **Rotate and centralise secrets.** The OpenAI key sits in `.env` and
      also powers production.
- [ ] **Staging environment** that is not a Cloudflare tunnel from a laptop.

---

## Phase 3: Real pilots, deliberately few

Do not launch. **Recruit.**

- [ ] Pick **ten to twenty pilots in El Salvador** you can meet in person.
      Ilopango and the aeroclubs are the obvious place. In-person feedback
      from a pilot who just landed is worth a hundred analytics events.
- [ ] Watch them use it **without helping**. Every time you explain something,
      write it down: that is a design defect, not a training problem.
- [ ] **Fly with it yourself, repeatedly.** A flight-planning app has to be
      used in a cockpit, in turbulence, in sunlight, one-handed, with gloves.
      Nothing else surfaces those problems.
- [ ] Instrument the funnel that matters: **does a pilot who plans a flight
      come back and log it?** That single number tells you whether the Strava
      premise works.
- [ ] Fix the top three complaints before adding anything new.

---

## Phase 4: The company

- [ ] **Entity.** LAWYER and an accountant. Where you incorporate depends on
      where your users, your money and your investors are, and those may be
      three different countries.
- [ ] **Insurance.** Errors and omissions, and product liability, from an
      insurer who understands aviation software. Get quotes early: the answer
      shapes what you are willing to ship.
- [ ] **Trademark the name.** Whatever it ends up being, search before you
      commit. The Vercel project is still `pqrh-app` and renaming it later
      means updating the Supabase URL and every pilot re-installing.
- [ ] **Aviation authority relationships.** Talk to AAC El Salvador and AHAC
      Honduras. You are already using their published data. A working
      relationship turns a licensing risk into a distribution advantage, and
      nobody else is asking them.
- [ ] **Pricing.** ForeFlight is priced for US incomes. There is room below it
      that is not "free". Charge something from early on: it filters for
      pilots who actually want it and it is far harder to start charging later.

---

## Phase 5: Growth

- [ ] Country by country, and each one is **the same data problem you already
      solved twice**: get the national AIP, add the aerodromes and heliports
      nobody else has, own that country.
- [ ] The **social layer** is the retention engine and the thing neither
      competitor has. Flights as activities first, photos second.
- [ ] **App store presence.** The PWA is genuinely good and installs to the
      home screen, but pilots look in the App Store. Decide whether to wrap it.
- [ ] **Offline is the feature**, not a checkbox. Central American coverage is
      patchy and that is exactly when a pilot needs the app most.

---

## What I would do in the next two weeks

1. **Resolve the openAIP licence.** Everything commercial is downstream of it.
2. **Fix the duplicate aircraft bug.** It is corrupting real data now.
3. **Fix the `vercel.json` rewrite** and add an error boundary. Two small
   changes that probably end the white screen.
4. **Add error monitoring.** You cannot fix what you cannot see.
5. **Write tests for weight and balance and fuel.** Start where being wrong
   hurts someone.

Nothing on that list is a feature, and that is the point. The app is further
along than the company is.
