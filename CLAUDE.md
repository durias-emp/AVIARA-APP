# AVIARA

Flight planning for general aviation pilots. React 19 + Vite PWA, offline
first, installed to the home screen and flown with.

## Branches, and the one rule

**`main` is the shipping app. Do not commit to it during redesign work.**

It is installed on the owner's phone and deployed to production. It works, and
a great deal of hard-won device-specific behaviour is encoded in it (see the
comments in `index.html`, `src/index.css` and `src/main.jsx`, which are not
decoration: each one is a bug that took a day to find).

`strava-layout` is the redesign: the same app, reimagined as a social feed for
pilots. It is a fresh take on layout and product, not a refactor, and it is
free to break whatever it likes.

A `pre-commit` hook in `.git/hooks/` enforces this. It is local, not committed,
so if the repo is cloned fresh, reinstall it. Deliberate main work must be said
out loud: `ALLOW_MAIN_COMMIT=1 git commit -m "..."`.

Never merge `strava-layout` into `main` without the owner explicitly asking.

## What the redesign is

Strava, for flying. The existing app answers "can I make this flight?" The
redesign asks "what have I flown, and who else is flying?" Flights become
activities with a map trace, distance, duration, aircraft, and route; a pilot
has a profile with totals and personal records; there is a feed.

The flight log already exists (`flights` store, synced to Supabase), so the
data model is largely there. What is missing is anything social.

Ideas worth taking from Strava: the activity card, the year/all-time totals,
segments (approaches? airports?), kudos, and the fact that its home screen is
a feed rather than a menu.

Ideas worth refusing: gamification that would encourage flying badly.
Leaderboards for speed or altitude are a flight-safety problem, not a feature.

## Ground rules that outlive any branch

- Pilots fly to small strips and to points that are not in any database. Never
  assume an ICAO code exists for a destination.
- Nothing in this app may present modelled or non-official data as official.
  Every hazard band, every figure, carries its source.
- No em dashes in code, comments, or UI text.
- The owner is non-technical. Explain in plain language, verify on the device
  rather than asserting, and never claim something works without checking.

## Verification

`npm run build` and `npm run lint` before anything is called done. Lint has a
long-standing baseline of pre-existing problems: compare counts before and
after rather than expecting zero. Verify UI in the browser preview, and phone
behaviour on the phone, because the desktop preview lies about viewport size,
safe-area insets and standalone mode.
