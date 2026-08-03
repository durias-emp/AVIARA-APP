# Handoff: the iOS status bar that will not match the app

You are picking up a three-day investigation. The人 you are working with is
non-technical, patient but fatigued, and tests on their physical iPhone by
screenshot. Everything below is device-verified unless marked otherwise. Do
not re-derive what is already proven; do not trust the desktop preview for
any of these signals.

## The app

- AVIARA, a flight-planning PWA. React 19 + Vite + vite-plugin-pwa
  (autoUpdate, skipWaiting/clientsClaim), react-router. Offline-first:
  service worker precaches the shell; navigations are served from cache.
- Deployed on Vercel: **https://pqrh-app.vercel.app** (project `pqrh-app`).
  Auto-deploys from GitHub `main` (durias-emp/AVIARA-APP). SPA rewrite in
  vercel.json; Vercel serves real files before the rewrite.
- Dev: `npm run dev` (port 5173) + a cloudflared quick tunnel. `.claude/launch.json`
  has the config. Tunnel URLs rotate on restart.
- Installed on the user's iPhone as a home-screen web clip. Manifest:
  `display: standalone`, `start_url: '/'`, theme_color/background_color
  `#000000` (in vite.config.js VitePWA block).
- Device: iPhone with 852×393 pt screen (14 Pro/15/16 class), iOS current as
  of Aug 2026. Dark mode user, tests both modes.

## The goal

The status bar area (clock/battery zone) should visually merge with the app:
white over the white app in light mode, black over the black app in dark
mode — adaptively. The app itself already themes instantly (CSS tokens,
`data-theme` attribute set from `prefers-color-scheme` by `src/hooks/useTheme.js`).
App backgrounds are exactly `#ffffff` light / `#000000` dark for this reason.

## Current failing state

Bar is **white in dark mode** (white bar, dark glyphs, over a pure-black
app). Latest deployed attempt: static media-scoped theme-color pair (see
"Current head"). User reports no change. NOT yet verified whether their
latest test was a clean reinstall (private-tab Safari → Add to Home Screen);
that verification is your first task before any new theory.

## Device facts, each paid for in blood

F1. **`black-translucent` is off the table.** It triggers a container bug:
    the web view is sized 793pt (screen minus status bar) but pinned to the
    top, leaving a 59pt dead band at the bottom that belongs to the OS
    window. Element painting is clipped at the view edge — proven with
    painted probes (a hot-pink `body::before` and a lime canvas both stopped
    dead at the line). No CSS/JS can reach the band. A full compensation
    machinery was built and then stood down (still in `src/main.jsx`,
    `--vp-deficit`, currently forced to 0px). Do not re-enable it; do not
    retry translucent without re-verifying the container bug first.

F2. With `default` or `black` styles, the view sits below the bar and
    reaches the physical bottom (verified by beacon: `safeTop: 0px`,
    footer bottom = view bottom = physical bottom). The bottom is FINE.
    Only the bar's own color is wrong.

F3. The bar has obeyed **no value** of `apple-mobile-web-app-status-bar-style`:
    `default` → white; `black` → still white (after deploy + fresh installs,
    per user). It also ignores manifest theme_color/background_color (both
    `#000000` while the bar stayed white), and it is not system-following
    (white in dark mode).

F4. **Script-visible `prefers-color-scheme` LIES at document-parse time in
    a web clip**: it reports the *previous session's* value and corrects
    itself after parse. Proven both directions with an on-screen diagnostic
    (`want=light` under a dark-rendering app and vice versa). Any head
    script that branches on it at parse acts on garbage. (This same device
    also lies about safe-area insets for the first ~beats of launch, and
    about viewport height under translucent — pattern: launch-time values
    on this iOS are unreliable; only late or iOS-native evaluations hold.)

F5. A two-shell mechanism (index.html light / dark.html with `black` bar
    meta; head-script redirect) was built and **proven to execute
    perfectly** (diagnostic showed `shell=dark path=/dark.html` at launch) —
    bar stayed white anyway. Removed. Do not rebuild it.

F6. Reinstalling the clip — including from `/dark.html`, including (per
    user report, unverified) from a private tab after the `black` meta
    deploy — has never changed the bar.

F7. The bar's rendered color sampled from screenshots: `#fdfdfd`-white in
    the light era, plain white now. The one value in the page it has always
    matched: the static `theme-color` `#ffffff` (leading theory, F8).

F8. **Leading theory at handoff**: this iOS paints the web-clip bar from
    `theme-color`, sampled once at parse — and the old inline script was
    *rewriting theme-color at parse from the lying F4 value*, i.e. telling
    iOS "white" in dark mode. Fix shipped: static media-scoped pair, no
    script touches it at load (iOS evaluates the `media` attribute itself,
    outside the lying script value). User says still white — but see
    "Current failing state": clean-install verification pending.

## Current head (deployed)

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black" />
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#ffffff" />
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#000000" />
<meta name="color-scheme" content="light dark" />
```

No inline scripts in the head anymore. `useTheme.paintChrome()` updates the
*matching* member of the pair after theme changes (for Android/red palette),
never collapses the pair, never runs at parse.

## Tools you have

- **Dev telemetry**: dev builds beacon viewport/standalone readings to the
  dev server terminal (`deviceLogSink` in vite.config.js, reporter in
  src/main.jsx, `/__device-log`). Dev builds only, absent from production.
  Read with the preview server logs. Restart dev + tunnel if dead; the
  user's dev web clip must then be reinstalled (tunnel URL rotates).
- **The DIAG strip pattern**: a fixed, tappable-to-dismiss colored strip
  appended on DOMContentLoaded from an inline head script, showing values
  captured at parse. This is how F4/F5 were proven. Deploy to production,
  ask for one screenshot, remove. The user tolerates this; keep it to one
  round per question and REMOVE it after.
- Screenshots from the user: 1179×2556 (3x, 393×852pt). Sample pixels with
  PIL rather than eyeballing (that method caught the exact Apple grays).
- Project memory files (`~/.claude/projects/-Users-oliout-Desktop-CC-projects-AVIARA-APP/memory/`):
  `ios-standalone-viewport-deficit.md` (the band saga),
  `ios-status-bar-two-shells.md` (partially superseded — items (2)/(3) about
  per-launch re-read and install-freezing are NOT both confirmed; F8 is the
  live theory). Update these when you learn something durable.
- Git log on `main`: every experiment has a commit whose message narrates
  the finding. `git log --oneline` from `bc4f830` forward is the timeline.

## What to do first (ordered, cheapest decisive step first)

1. **Verify the current deploy reached the phone and the install is clean.**
   Add a DIAG strip that reports: which theme-color tags exist in the DOM at
   parse, `navigator.standalone`, and — the key number — nothing derived
   from script-visible prefers-color-scheme (it lies). Have the user do the
   private-tab reinstall WITH the strip live. If the bar is black in dark
   after a truly clean install, F8 was right and you are done: remove strip.
2. If still white on a verified-clean install: F8 falls. Next candidates,
   in order of evidence-cost:
   a. Remove `apple-mobile-web-app-capable` + the apple bar-style meta
      entirely (manifest-only install path). iOS ≥16.4 prefers the manifest;
      the legacy metas may be forcing a legacy code path.
   b. Remove `theme_color` from the manifest (it may override the
      media-scoped page tags for manifest-driven clips; manifest has no
      media support, and ours says #000000 — note the bar is WHITE, which
      argues it is not being read, but removal is one variable).
   c. Test a page with literally minimal head (viewport + one dark
      theme-color) served from a scratch route, installed fresh — establish
      whether ANY configuration can produce a black bar on this device. If
      none can, the bar is simply white-in-light/appearance-frozen on this
      iOS build and the honest endgame is designing the app to live with a
      white bar (light-first header treatment), or dark-only + accepting
      it, and telling the user so plainly.
3. Whatever you learn, UPDATE the memory files and index.html's comments so
   this never gets relitigated.

## Constraints and courtesies

- One decisive experiment per round; the user has done ~15 test cycles.
  Always state exactly what to do (delete icon → private tab → URL → Add to
  Home Screen → open in dark) and what one screenshot you need.
- Do not trust: desktop preview insets (0), hidden-pane innerHeight (0),
  `navigator.standalone` in Chromium (undefined), parse-time
  prefers-color-scheme on device (F4), your own certainty (two confident
  wrong diagnoses already happened; the correct calls came from on-device
  measurement every time).
- The bottom-of-screen work (view reaching the physical bottom) is DONE and
  fragile-adjacent: `black`/`default` keep it correct; translucent breaks
  it. Never trade the bottom for the top without the user choosing that.
- End every user-facing reply with the preview link as a short "click here"
  markdown link. Sign-in works via email/password; Google OAuth needs the
  provider enabled in Supabase (separate open item, user's own dashboards).
- The user's standing instruction: think like a pilot, plainly, no jargon
  walls; they call the bar "the top area."
