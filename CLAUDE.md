# AVIARA-APP — working rules for this repo

This is the **shared, live AVIARA project** (`durias-emp/AVIARA-APP`): a
pilot flight-planning PWA (React/Vite + Supabase). Two-person team — James
(`jjmcb123`, this machine) and his partner, who works from his own machine.
The production app deploys from this repo. This folder was once an isolated
sandbox clone; that era ended 2026-08-03 when the two diverged copies were
merged (PR #4). The old push-blocking hook is preserved, disabled, at
`.git/hooks/pre-push.disabled`.

## Git workflow

- **Fetch/pull `origin/main` before starting work.** The partner commits
  independently; divergence is routine, not exceptional.
- Commit locally freely. Push work as **feature branches** to `origin`.
- **Never push directly to `main`. Never force-push.** Merging into `main`
  happens through pull requests on GitHub, and the merge click belongs to
  the humans — do not merge, close, or comment on PRs. Create a PR only
  when explicitly asked; otherwise hand over the compare/PR link.

## Deployment — two Vercel projects, very different rules

- **Production: `pqrh-app.vercel.app`** — the partner's Vercel project,
  auto-deploys whenever `main` changes on GitHub. Never deploy to it
  directly; shipping to production == merging to `main`, nothing else.
- **James's sandbox: `aviara-sandbox.vercel.app`** (Vercel team `jiegos`) —
  deployed manually from this folder with `npx vercel --prod`. Fine for
  demos/experiments; it is NOT git-connected.

## Shared live infrastructure — treat with care

- **One live Supabase project serves both partners and real users.**
  Migrations in `supabase/migrations/` applied via `npx supabase db push`
  change the production database for everyone. Get explicit confirmation
  in the moment before applying any migration, and keep them additive.
- **Secrets** live in `.env` (`OPENAI_API_KEY`) and `.env.local` (Supabase
  URL/anon key) — gitignored. Never commit, print, or paste their values.
  The OpenAI key also powers production (partner's Vercel env), so
  rotating it means updating: this `.env`, `aviara-sandbox` env, and the
  partner's `pqrh-app` env.

## Data pipeline

Bundled aeronautical data (`src/data/`) is rebuilt on the FAA's 28-day
cycle by `.github/workflows/navdata-refresh.yml` (weekly, Thursdays) via
the Python builders in `scripts/`. Don't hand-edit generated JSON; fix the
builder and rerun it.
