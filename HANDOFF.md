# AVIARA: handoff

Written 10 August 2026, from the state of `vector-map-spike` at commit `8b72c28`.
Everything below was read out of the repository rather than remembered.

---

## 1. What the app is

Flight planning for general aviation pilots. A React 19 + Vite PWA, offline
first, installed to the home screen and flown with. Two developers work on it
from separate machines against one shared repository (`durias-emp/AVIARA-APP`)
and one shared live Supabase project.

It answers two different questions, and which one it leads with is the whole
story of the redesign:

- **`main` asks "can I make this flight?"** A menu of tools: plan, weather,
  aircraft, calculators, reference.
- **The redesign asks "what have I flown, and who else is flying?"** A map you
  fly from, with the plan on a drawer over it, and a feed underneath.

---

## 2. Where the code is

Three branches matter.

| Branch | What it is | State |
|---|---|---|
| `main` | The shipping app. Installed on the owner's phone, deployed to production. | Last touched 3 Aug 2026 |
| `strava-layout` | The redesign. 228 commits ahead of `main`. | Last touched 9 Aug 2026 |
| `vector-map-spike` | `strava-layout` plus the vector basemap and everything built on it. 15 commits ahead. | Current work |

**The one rule: `main` is the shipping app, and redesign work does not go on
it.** A local `pre-commit` hook enforces this. It is not committed, so a fresh
clone has to reinstall it. Deliberate work on `main` has to be said out loud:

```bash
ALLOW_MAIN_COMMIT=1 git commit -m "..."
```

Never push directly to `main`, never force-push. Merging happens through pull
requests and the merge click belongs to the humans.

Two tags exist as escape hatches:

- `pre-main-merge`: before `main` was last merged into the redesign.
- `pre-vector-map`: the last commit on `strava-layout` before the vector
  basemap spike began. If the spike is judged not worth it, this is where to
  go back to, and nothing after it is load-bearing for the rest of the app.

---

## 3. What is built

### 3.1 The map home (redesign only)

`src/pages/Home/MapHome.jsx` is the largest file in the app and the redesign's
centre of gravity. A full-screen map with a drawer over it.

**The drawer** rests at one of five stops, named by the percentage of the
screen they cover: 0 / 25 / 50 / 80 / 100. A stop the pilot named is a
position, not a suggestion, and content fits the stop rather than the stop
growing to the content.

**The action row** (Weather, record, Plan Route) lives on exactly one surface
at a time, decided by the drawer's height alone:

| Drawer | Where the row is |
|---|---|
| Resting, empty | Inside the drawer, at the top |
| Resting, carrying a route | Floating over the map above it |
| Half screen | Floating over the map above it |
| Above half | Nowhere. It rides down under the drawer |

**The top card** carries two rows in one panel: the home airport's conditions
above (flight category, temperature, wind, ceiling, visibility, dewpoint, a
link into the full METAR/TAF report), and the aerodrome the map is currently
over below. They take turns opening, because both open at a large airport is
more card than map.

**The map layers**, behind the layers button: FAA Sectional, Terrain, IFR Low,
IFR High, Airspace (openAIP), Traffic, TFR, Airports, Heliports, Seaplane
bases, Radar (NEXRAD), Flight Category, and 3D.

**The route line is the editor.** Hold it to bend it, tap a turning point to
take it out, hold anywhere on the map for the coordinates of that spot and the
option to add it.

**3D** is a layer of the home screen, not a screen of its own: a second
MapLibre map filling the map area with the buildings standing up, drawing the
route from the same stored record. It is not terrain; hills need elevation
data OpenFreeMap does not serve, and the chip says so.

### 3.2 The flight plan

`src/pages/Checklists/` is the planner, and it lives in two hosts: standalone
at `/checklists`, and embedded in the map home's drawer. One component, two
rooms; the drawer remaps the app's surface tokens onto the map's palette so the
same cards read correctly in both.

Five groups, swipeable horizontally, with a numbered tab bar:

1. **Route**: Route and Altitude, Weather, Alternate(s)
2. **Performance**: Weight & Balance, Density Altitude, Distances, Cruise & Fuel
3. **Airport**: Airports, Charts
4. **Aircraft**: CARROW, airworthiness, fuel, equipment
5. **Pilot**: IM SAFE, IM CURRENT, IM VALID, IM AIRWORTHY, Flight Itinerary

In the drawer the whole thing is **one scroller**: route chips, the eight
figures, the flight rules row and the steps all move together. Nothing is
pinned above anything. The tab bar and the Add Step / Complete Flight Plan
buttons appear once the drawer owns the whole screen and are gone below that,
where the swipe is the way between groups.

**The eight figures** on the route card: Distance, Magnetic Course, True
Course, Variation on the first row; Time, Trip Fuel, Fuel Aboard, Cruise Alt on
the second. They recompute when a waypoint is added or removed. Cruise altitude
reads "Not set" rather than 0, because 0 ft is sea level and would be a claim.

**Cruise altitude** is a planned figure, not a sensed one. Phones cannot give
pressure altitude; GPS height is not the same quantity. `src/lib/cruiseAdvisor.js`
recommends one from terrain, airspace, aircraft ceiling, climb economics and
weather aloft, with hard gates (below MEA, above ceiling, oxygen limits,
official severe icing) removing candidates before anything scores them.
`api/altitude-brief.js` turns the engine's brief into prose using the OpenAI
key, and may only choose from the candidates the engine supplied.

**Flight rules** are VFR / IFR / RTC, chosen directly under the route.
RTC is rotorcraft, flown under the VFR rules.

### 3.3 Aerodromes on the map

Three layers, by zoom:

- **From zoom 7**, a marker per field: blue towered, magenta non-towered, grey
  where the data does not say. Heliports and seaplane bases from zoom 8.
- **From zoom 13**, the runway itself, drawn from surveyed threshold
  coordinates at its real width and angle. From zoom 14 the centreline, the
  threshold bars, and the designators painted the way they are painted on the
  ground: the number's own "up" pointing down the runway.
- **The plate**, in the top card: identifier, elevation, every runway with its
  dimensions, the frequencies a pilot tunes on the way in, and the official
  chart.

A field whose runway is drawn loses its marker. A field with no published
threshold coordinates keeps it at every zoom, because only 12,016 of the 26,449
fields in the pack have them and a field that vanishes as you fly towards it
would be the worst thing this layer could do.

**The official chart** opens the FAA's own airport diagram where the FAA
publishes one, current cycle, cached offline after the first fetch. Where it
does not, the plate names the authority that does. El Salvador's aerodrome
charts are the AAC's and this app does not carry them, and it says so rather
than linking to a scan of one.

### 3.4 The rest of the app

- **Hangar**: multiple aircraft, templates for 11 types, weight and balance
  setup, performance charts extracted from a POH page, maintenance tracking,
  generated aircraft icons.
- **Pilot**: logbook with custom fields, CSV import, page scanning, currency
  tracking, flight debriefs.
- **Weather**: METAR/TAF, area weather, winds aloft, hazard products.
- **Discover**: posts, stories, marketplace listings, comments, follows,
  direct messages, shareable links. This is `main`'s Instagram-style half; the
  redesign keeps the plumbing but the primary card in the feed is meant to be a
  flight, not a photo.
- **Reference**: air law, light gun signals, lost communications, marshalling.
- **Calculators**, **Settings**, **Onboarding**, **UAP reporting**.

---

## 4. Data

### 4.1 Bundled packs

`src/data/geo/`, none of them precached, all fetched on first use and cached
after. This is deliberate: together they are over 10 MB, and precaching would
mean a phone must download all of it before a new version activates.

| Pack | Size | What it is |
|---|---|---|
| `land.json` | 2.2 MB | Coastline |
| `airport_details.json` | 2.1 MB | Frequencies and runways, 26,449 fields |
| `airports.json` | 1.7 MB | Identifier, position, class, name |
| `runway_geometry.json` | 1.5 MB | Surveyed thresholds and widths, 12,016 fields |
| `preferred_routes.json` | 1.0 MB | FAA preferred routes |
| `procedures_index.json` | 732 KB | Which charts exist per US field, 2,976 fields |
| `aux_aerodromes.json` | 656 KB | Heliports and seaplane bases |
| `airport_search.json` | 532 KB | City and IATA search index |
| `cenamer_airspace.json` | 44 KB | CENAMER FIR controlled airspace |
| `fb_stations.json` | 8 KB | Winds aloft stations |

Plus `faa_charts.json` (1 MB) and hand-maintained national supplements for
El Salvador and Honduras, which exist because the community data has nothing
for those countries.

### 4.2 How they are built

Python builders in `scripts/`, rerun by `.github/workflows/navdata-refresh.yml`
weekly on Thursdays, tracking the FAA's 28-day cycle. Never hand-edit the
generated JSON; fix the builder and rerun it.

Sources, in order of authority, each field taking the best one that covers it:

- **FAA NASR** 28-day subscription. Official, current, and it covers the
  non-towered fields the community data is thinnest on.
- **COCESNA eAIP** for the CENAMER FIR. Small in volume, authoritative, and it
  fills fields nothing else has.
- **OurAirports**, community-maintained, worldwide. The base layer, and the
  only source outside the two above.

Every entry records which source it came from, and the app shows it.

### 4.3 Live services

Vercel functions in `api/`, all of them proxies or key-holders:

| Route | Upstream |
|---|---|
| `awc.js` | aviationweather.gov (METAR, TAF, G-AIRMET) |
| `traffic.js` | ADS-B traffic |
| `tfr.js`, `tfr-detail.js` | FAA TFR feed |
| `notams.js` | FAA NOTAM search |
| `procedure-chart.js` | FAA d-TPP chart PDFs |
| `altitude-brief.js` | OpenAI, for the cruise altitude briefing |
| `generate-aircraft-icon.js` | OpenAI, for aircraft icons |
| `extract-poh-chart.js`, `extract-logbook-page.js` | OpenAI vision |

Called directly from the client: Open-Meteo (winds and temperatures aloft),
OpenFreeMap (vector tiles), ArcGIS (FAA raster charts), openAIP (airspace
tiles), Iowa Environmental Mesonet (NEXRAD), NOAA (magnetic declination),
eCFR (regulations).

---

## 5. Storage

**On the device**: IndexedDB, database `pqrh`, version 9. Stores: `aircraft`,
`airportDiagram`, `checklists`, `complianceLog`, `currency`, `flights`,
`logbookEntries`, `maintenanceItems`, `procedureChartImages`, `settings`,
`syncMeta`, `uapReports`, `weather`.

The app is local-first by design. Sign-in is never required to use it; an
account only matters for cross-device backup or a social feature, and those are
gated individually at the point of use.

**In the cloud**: one live Supabase project, shared by both developers and by
real users. Tables: `profiles`, `posts`, `post_media`, `post_likes`, `comments`,
`follows`, `blocks`, `reports`, `stories`, `conversations`, `messages`,
`listings`, `listing_media`, `backups`, `events`, `notams`, `notam_watch`,
`uap_reports`. Six migrations in `supabase/migrations/`.

**Migrations change the production database for everyone.** Get explicit
confirmation in the moment before running `npx supabase db push`, and keep
migrations additive.

---

## 6. Infrastructure

- **Production is `pqrh-app.vercel.app`**, auto-deployed whenever `main`
  changes on GitHub. Never deploy to it directly. Shipping means merging to
  `main` and nothing else.
- Sandbox deployments are manual, from a developer's own Vercel project, not
  git-connected. Fine for demos, never for real users.
- **Secrets** live in `.env` (`OPENAI_API_KEY`) and `.env.local` (Supabase URL
  and anon key), both gitignored. Never commit, print or paste their values.
  The OpenAI key also powers production, so rotating it means updating every
  environment that holds it.
- The Vercel project is still named `pqrh-app` deliberately. Renaming it would
  change the Supabase redirect URL and force everyone to reinstall the PWA, so
  it waits until the branding is final.

### Phone preview

The desktop browser lies about viewport size, safe-area insets and standalone
mode, so phone behaviour is checked on the phone:

```bash
npm run build && npm run preview
```

then a Cloudflare tunnel at `http://127.0.0.1:4173`. The tunnel address changes
every restart, and an old address serves a stale cached PWA forever, so always
use the newest link.

---

## 7. Ground rules that outlive any branch

These are not style preferences. Each one is a bug that took a day to find, or
a safety position.

1. **Pilots fly to small strips and to points that are in no database.** Never
   assume an ICAO code exists for a destination.
2. **Nothing may present modelled or non-official data as official.** Every
   hazard band and every figure carries its source. Modelled bands are drawn
   dashed, labelled "modelled", never "forecast", and never gate an altitude.
3. **No em dashes** in code, comments or UI text.
4. **No gamification that would encourage flying badly.** Leaderboards for
   speed or altitude are a flight-safety problem, not a feature.
5. **The owner is non-technical.** Explain in plain language, verify on the
   device rather than asserting, and never claim something works without
   checking.
6. `npm run build` and `npm run lint` before anything is called done. Lint has
   a long-standing baseline of **207 problems (169 errors, 38 warnings)**;
   compare counts before and after rather than expecting zero.

### Things the comments exist to stop you undoing

- `index.html`, `src/index.css` and `src/main.jsx` carry device-specific fixes
  for iOS standalone mode. The CSS viewport is 59px short in the web clip and
  `body` carries the correction. Do not remove it.
- The iOS status bar colour is re-read at launch from `start_url` only, and
  `prefers-color-scheme` lies at parse time, so an adaptive bar is impossible.
  Black is the chosen answer. Do not rebuild the shell swap.
- `VectorBasemap.jsx`'s creation effect depends on the Leaflet map and nothing
  else. Adding to that dependency list is how the map flicker comes back:
  measured, seven GL engines built during a single drawer drag.
- The MapLibre bridge's per-tick zoom handler stays hooked. Removing it left
  the route 268px adrift of the ground during a pinch.
- `maplibre-gl` is pinned to v5. v6 is ESM-only and the Leaflet bridge requires
  it as UMD.

---

## 8. Where this is heading

Based on what has actually been built, not on a wishlist.

### Immediately decidable

**The vector basemap spike needs a verdict.** OpenFreeMap replaced the CARTO
raster tiles as the map floor. It brought the 3D view, sharper labels at every
zoom, and free unmetered tiles. It also brought a megabyte of engine and a
class of bug the raster map did not have. Everything since is built on it, and
`pre-vector-map` is the way back. This is a keep-or-discard call, and it is the
owner's.

**El Salvador's aerodrome charts.** The runway layer draws MSSS and MSLP
correctly, checked against the AAC's own chart to within 8 metres, but the app
carries no official chart for them. Two honest routes: obtain the PDFs from the
AAC and bundle them as licensed content, or build a "load your own chart"
pocket so a pilot supplies theirs. Both are real; neither is started.

### The airport layer, and where it goes next

Taxiways and their letters are **done**, and they cost no data pack at all. The
OpenFreeMap tiles carry an `aeroway` source layer whose schema is exactly two
fields, `class` and `ref`, and `ref` is the taxiway designator: 108 taxiway
features at KJFK with 91 of them lettered, and Ilopango's A/B/C/D matching the
AAC's own chart. `src/components/aerowayStyle.js` restyles the vendor's
near-invisible taxiway lines into pavement and adds a symbol layer for the
letters from zoom 14, on both the flat map and the tilted one. Runway numbers
on the pavement were the first half of that picture; this is the second.

Beyond that, the data already in `airport_details.json` and
`runway_geometry.json` supports, in rough order of effort: displaced
thresholds, lighting type per runway, hot spots (FAA publishes them), and
runway end elevations for a sloping strip.

### The redesign's own premise, still mostly unbuilt

This is the honest gap. `strava-layout` has rebuilt the *home screen* as a map
and the *plan* as a drawer, superbly. What it has not built is the thing it is
named after.

- **`ActivityCard` exists and is rendered in exactly one place**, on the map
  home's drawer, listing past flights. That is the whole of the activity feed.
- **The `flights` store exists and syncs to Supabase**, so the data model is
  there: a flight already has a track, distance, duration, aircraft and route.
- **`FeedTab` renders posts, not flights.** The social half is `main`'s
  Instagram plumbing, kept but not repointed.
- **No totals, no personal records, no kudos.** Grep finds none of them.

So the work the redesign was started for is: make the feed a feed of flights,
give a pilot a profile with year and all-time totals, and add the one social
gesture that is safe (acknowledging someone else's flight). The map, the plan
and the aerodrome layers were the foundation; this is the building.

### The merge

`strava-layout` is 228 commits ahead of `main`, and `main` still holds screens
the redesign has not restyled. Merging `main` into the redesign is expected and
routine. Merging the redesign back into `main` needs the owner to ask for it,
and it is a large enough change that it wants a deliberate moment rather than a
quiet one.

---

## 9. Known open threads

Small, real, and none of them blocking:

- The map home polls `/api/awc` repeatedly. Worth a look.
- The on-condition maintenance drawer has no on-screen way out.
- A lowercase "conditions there, not here." in the aerodrome weather caveat.
- `AirportInfo` takes no parameters, so nothing can deep-link to one field's
  screen. The map plate works around this by carrying its own detail.
- Above half screen there is no record button, by design. If that turns out to
  matter in the air, the fix is a small pinned record control rather than
  bringing the whole row back.
- `Reset` for the flight plan now lives only on `/checklists`. If it is wanted
  in the drawer it needs a new home.
- The runway geometry pack is built from NASR cycle 06 Aug 2026 while
  `airport_details.json` is on 09 Jul 2026. Both are labelled with their own
  cycle, so nothing is misrepresented, but a single rebuild would align them.
