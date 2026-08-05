# AVIARA

Flight planning for general aviation pilots. React 19 + Vite PWA, offline
first, installed to the home screen and flown with.

This is the shared, live project (`durias-emp/AVIARA-APP`), worked on by two
people from separate machines. The production app deploys from this repo, so
divergence between the two is routine rather than exceptional.

## Branches, and the one rule

**`main` is the shipping app. Do not commit to it during redesign work.**

It is installed on the owner's phone and deployed to production. It works, and
a great deal of hard-won device-specific behaviour is encoded in it (see the
comments in `index.html`, `src/index.css` and `src/main.jsx`, which are not
decoration: each one is a bug that took a day to find).

`strava-layout` is the redesign: the same app, reimagined as a social feed for
pilots. It is a fresh take on layout and product, not a refactor, and it is
free to break whatever it likes. Merging `main` into it is expected and fine;
merging it back into `main` is not, and needs the owner to ask.

A `pre-commit` hook in `.git/hooks/` enforces this. It is local, not committed,
so if the repo is cloned fresh, reinstall it. Deliberate main work must be said
out loud: `ALLOW_MAIN_COMMIT=1 git commit -m "..."`.

## Git workflow

- Fetch `origin/main` before starting work. The other developer commits
  independently.
- Commit locally as often as is useful. Push work as feature branches.
- **Never push directly to `main`. Never force-push.** Merging into `main`
  happens through pull requests, and the merge click belongs to the humans:
  do not merge, close, or comment on PRs. Create a PR only when asked;
  otherwise hand over the compare link.

## Deployment

- **Production is `pqrh-app.vercel.app`**, which auto-deploys whenever `main`
  changes on GitHub. Never deploy to it directly. Shipping to production means
  merging to `main`, and nothing else.
- Sandbox deployments are manual, from a developer's own Vercel project, and
  are not git-connected. Fine for demos, never for real users.

## Shared live infrastructure, which is not a sandbox

- **One live Supabase project serves both developers and real users.**
  Migrations in `supabase/migrations/` applied with `npx supabase db push`
  change the production database for everyone. Get explicit confirmation in
  the moment before applying any migration, and keep migrations additive.
- **Secrets** live in `.env` (`OPENAI_API_KEY`) and `.env.local` (Supabase URL
  and anon key), both gitignored. Never commit, print, or paste their values.
  The OpenAI key also powers production, so rotating it means updating every
  environment that holds it, not just this folder.

## What the redesign is

Strava, for flying. The existing app answers "can I make this flight?" The
redesign asks "what have I flown, and who else is flying?" Flights become
activities with a map trace, distance, duration, aircraft, and route; a pilot
has a profile with totals and personal records; there is a feed.

The flight log already exists (`flights` store, synced to Supabase), so the
data model is largely there.

Ideas worth taking from Strava: the activity card, the year/all-time totals,
segments (approaches? airports?), kudos, and the fact that its home screen is
a feed rather than a menu.

Ideas worth refusing: gamification that would encourage flying badly.
Leaderboards for speed or altitude are a flight-safety problem, not a feature.

**The feed is flights, not photos.** `main` grew an Instagram-style Discover
section (posts, stories, marketplace, messages) and the redesign keeps that
plumbing, but the primary card in the feed is an activity: a flight with its
trace and its numbers. The two are easy to confuse and are not the same
product.

## Ground rules that outlive any branch

- Pilots fly to small strips and to points that are not in any database. Never
  assume an ICAO code exists for a destination.
- Nothing in this app may present modelled or non-official data as official.
  Every hazard band, every figure, carries its source.
- No em dashes in code, comments, or UI text.
- The owner is non-technical. Explain in plain language, verify on the device
  rather than asserting, and never claim something works without checking.

## Data pipeline

Bundled aeronautical data (`src/data/`) is rebuilt on the FAA's 28-day cycle by
`.github/workflows/navdata-refresh.yml` (weekly, Thursdays) via the Python
builders in `scripts/`. Don't hand-edit generated JSON; fix the builder and
rerun it.

## Verification

`npm run build` and `npm run lint` before anything is called done. Lint has a
long-standing baseline of pre-existing problems: compare counts before and
after rather than expecting zero. Verify UI in the browser preview, and phone
behaviour on the phone, because the desktop preview lies about viewport size,
safe-area insets and standalone mode.
