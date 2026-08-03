# AVIARA Privacy Policy (Draft)

*Last updated: [date] — Version 1*

This is a draft written to accurately describe what AVIARA actually collects and does today. It is **not legal advice and has not been reviewed by an attorney.** Before this goes live in a real sign-up flow — especially because of the data-licensing practice described in Section 4 — have a lawyer review it. Selling or licensing user-contributed data, even anonymized, is one of the more heavily regulated things an app can do (California's CCPA defines "sale" broadly enough to cover more than cash transactions; if you ever have EU users, GDPR is a materially heavier bar than anything below). Treat this as a first draft, not a finished document.

---

## 1. What we collect

**Account information.** Email address and authentication data when you sign in (via Google or email/password), handled by our backend provider, Supabase.

**Aviation data you enter.** Aircraft, logbook entries, currency status, checklists, and similar pilot data. This is stored primarily on your own device and backed up privately to your account so it survives a lost or replaced phone. We do not sell, share, or analyze this data — it exists solely so the app works for you.

**Location data**, only while you're using map or flight-tracking features and only with your device permission. Used to show your position on the map and, if you enable it, to auto-detect flights for your logbook. Not collected in the background — this app cannot and does not track your location when it isn't open on screen.

**Social features.** If you create a public profile (Friends), the username, posts, follows, and direct messages you create are stored so those features work, visible only as the feature itself describes (e.g., DMs are visible only to their participants).

**Photos you submit for AI processing.** If you use a feature that reads a photo (a Pilot Operating Handbook performance chart, or a scanned logbook page), that image is sent to OpenAI's API to extract the data, then discarded — we don't retain a copy after processing.

**UAP/UFO sighting reports.** Covered separately in Section 4 below, because it works differently from everything else in this list.

## 2. What we don't collect

We don't request your real name, physical address, or government ID. We don't track you across other apps or websites. We don't collect location data in the background or when the app is closed.

## 3. How we use it

To provide the app's own features, to back up your data so you don't lose it, and — only for UAP reports, and only with your separate, explicit consent for each report — to build an aggregated dataset as described below.

## 4. The UAP Report dataset — read this section carefully

AVIARA includes an optional feature for logging UAP/UFO sightings. This works differently from the rest of your data:

- **Submitting a report is a separate, explicit action** from everything else in the app. Drafting a report privately never shares anything. Only tapping "Submit to AVIARA Database" — after checking a consent box describing exactly this practice — sends it to our shared database.
- **Once submitted, a report (including any age range or gender you optionally chose to provide) may be included in an anonymized, aggregated dataset that AVIARA shares, licenses, or sells to third parties** — for example, researchers or organizations studying UAP phenomena.
- **Your name, email address, and account identity are never included in that dataset.** We separately record which account submitted which report (so you can review your own submission history and so we can investigate abuse), but that link is never part of what's shared or sold.
- Age range and gender are always optional and are collected in broad ranges (e.g., "25–34"), never as an exact birthdate.
- We record a small number of internal signals — including how long your account has existed and, if you're a signed-in pilot, your logged flight hours — to help us assess a report's credibility. These are described in more detail in the consent text you see when submitting; they're used internally and are not a public "score."
- **Once submitted, a report can't be edited or deleted through the app.** If you need a submission corrected or removed, contact us at [support email].

If you never use this feature, none of this section applies to you.

## 5. Third parties we share data with

- **Supabase** — our backend/database provider, hosts all account and app data.
- **OpenAI** — processes photos you submit for chart/logbook extraction (Section 1); not used for any other data in this app.
- **Google** — if you sign in with Google, standard OAuth account info.
- **UAP dataset recipients** — researchers, organizations, or buyers who license or receive the anonymized dataset described in Section 4. We do not sell or share any other category of data described in this policy.

## 6. Your rights

You can request a copy of your data or request deletion of your account and its data at any time by contacting [support email]. UAP reports already included in a shared or sold dataset snapshot can't be retroactively pulled from copies already distributed, but we will remove them from future dataset exports and from our own systems.

## 7. Children's privacy

AVIARA is not directed at, and we do not knowingly collect data from, anyone under 13.

## 8. Changes to this policy

If this policy changes in a way that affects what's already been collected — especially anything in Section 4 — we'll update the version number at the top and, where required, ask affected users to re-consent rather than applying the change retroactively.

## 9. Contact

[support email / contact method]
