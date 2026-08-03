# Linear Migration Snapshot — PQRH App

Created: 2026-07-07

Purpose: preserve the current EsencIA Linear structure before reconnecting Linear to `info@cielonorteaviacion.com`.

## Source Workspace

- Team: EsencIA
- Team key: ESE
- Project: PQRH App
- Project summary: Offline-first PWA pilot quick reference handbook for student/private pilots
- Project description: Offline-first PWA that turns a printed pilot handbook into an interactive cockpit companion. React + Vite + IndexedDB. Issues here are organized by phase from the working backlog (`PQRH_App_Backlog.md`).

## Labels To Recreate

- Phase 1: Quick Wins
- Phase 2: Foundational
- Phase 3: Checklist Redesign
- Phase 4: One-Pager & Weather
- Phase 5: AI / Advanced
- Feature
- Improvement
- Bug
- Blocked
- Needs Clarification

## Status Mapping

- Backlog -> Backlog
- Todo -> Todo
- In Progress -> In Progress
- Done -> Done

## Migration Scope

Migrate the PQRH App backlog issues represented in `PQRH_App_Backlog.md` and the current Linear project. Do not migrate unrelated non-product notes unless explicitly requested.

Excluded by default:

- ESE-27 Reaching out to Hotels
- ESE-28 Conversation with PACO
- ESE-29 Pilot schedule
- ESE-30 Ukiyo

## Source Of Truth For Issue Bodies

Use `PQRH_App_Backlog.md` as the durable local issue-body source, enriched by the current Linear metadata where available:

- title
- description
- phase label
- type label
- blocked/clarification label
- priority
- status
- original source identifier

Each migrated issue should include a footer:

`Migrated from EsencIA Linear on 2026-07-07. Original issue: ESE-XX.`

