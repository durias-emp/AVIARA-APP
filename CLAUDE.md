# Local sandbox rules for this AVIARA-APP clone

This directory is a **local-only clone** of `durias-emp/AVIARA-APP`, used for experimentation. It must never affect the real, production AVIARA app (deployed at pqrh-app.vercel.app) or the shared GitHub repo.

Hard rules — do not do these, even if asked, without the user re-confirming explicitly in that moment:

- **Never run `git push`** (to any branch, including feature branches). Pushing is technically disabled here (dummy push URL + a blocking pre-push hook), but do not attempt to work around that.
- **Never create a pull request** against `durias-emp/AVIARA-APP` (no `gh pr create`, no pushing a branch and opening a PR via the web).
- **Never open, merge, or comment on issues/PRs** on the upstream repo.
- All work here stays local: edit, commit locally, build, and test freely — commits only ever land in this local `.git` history, never upstream.

If the user wants to actually contribute changes back upstream at some point, that requires them explicitly re-authorizing it in that conversation (re-enabling the push remote, removing the hook) — a past approval of this file does not carry forward to that decision.
