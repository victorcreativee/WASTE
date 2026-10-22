# KCCA live command centre — Phase 6A

A real-time city control room for KCCA (`kcca_admin`, `system_admin`) at **`/dashboard/command-center`**
("Live command centre" in the KCCA navigation). It refreshes every 30 seconds, pauses while the browser tab
is hidden, keeps the last good picture on screen if a refresh fails, and has a full-screen **Wall display** mode.

## What it shows

| Section | Source | Rule |
|---|---|---|
| City headline figures | `collection_jobs`, `collection_routes`, `weighbridge_transactions`, `collector_compliance_cases`, `organization_permit_applications` | Today = database `CURRENT_DATE`. Cancelled jobs are not scheduled work. Weighbridge tonnage = completed tickets today. Permits expiring = approved permits ending within 30 days. |
| Live fleet map + attention list | existing `liveFleet()` (same rules as the company fleet page) | `signal_missing` (no GPS > 5 min on a dispatched/in-progress trip), `off_route` (> 500 m from route geometry, accurate fix), `stopped_too_long`. Alerts the collector marked *resolved* are hidden. |
| Division performance today | jobs → zone → division; trips → service route → division; issues → zone boundary (or nearest zone centre within 3 km) | Jobs/trips not linked to a division appear in a "Not linked to a division" row only when non-empty. Tonnage = weighbridge-verified trips linked to a division route. |
| Resident issues vs service standards | `citizen_issues` (open = not resolved/rejected) | Default standards: missed collection 24 h, overflowing bin 24 h, illegal dumping 48 h, pickup request 72 h, other 48 h. *Due soon* = last quarter of the standard. 12 most overdue (relative to their standard) are listed. |
| Collector scorecard (last 7 days) | existing `cityCollectorReport()` + issues + compliance | Service score /100: completion 50, weighbridge verification 20, issues within standard 15, regulatory standing 15 (0 if suspended / permit missing or expired; 30% with a critical open case; 70% with any open case). ≥ 85 Good, ≥ 65 Watch, else Action required. Collectors with no scheduled work are listed but not ranked. |

The standards and score weights live in one place, `services/waste-service/src/services/city-command-center.service.ts`,
and are unit-tested. **KCCA should confirm the response standards and weights before the scorecard is used for enforcement.**

## API

`GET /api/waste/command-center/city` — KCCA/system admin only (company roles receive 403). One request returns
`totals`, `divisions`, `fleet`, `fleet_alerts`, `issues`, `scorecard`, `generated_at`, `refresh_seconds`. `Cache-Control: no-store`.
No schema migration; read-only.

## Files

- `services/waste-service/src/services/city-command-center.service.ts` — standards, SLA state, score
- `services/waste-service/src/repositories/city-command-center.repository.ts` — queries (parallel)
- `services/waste-service/src/controllers/command-center.controller.ts`, `routes/command-center.routes.ts`
- `services/waste-service/tests/city-command-center.test.ts` — 9 tests
- `apps/admin-web/src/app/dashboard/command-center/page.tsx`, nav entry in `components/layout/AppShell.tsx`

## Verification

- waste-service: `tsc` clean; `npm test` 74/74 (9 new).
- Queries executed against all 90 migrations with seeded fixtures (two collectors, divisions, trips, GPS, weighbridge,
  issues of different ages, a critical compliance case); every figure was checked by hand. PostGIS functions were
  stubbed in that run, so spatial results (off-route distance, boundary containment) were **not** verified there —
  they reuse the existing live-fleet rules and standard PostGIS calls.
- HTTP: KCCA 200 (~50 ms on fixture data), company admin 403, anonymous 401.
- admin-web: `tsc --noEmit` clean; ESLint clean on the new page and nav.
- Not yet done: viewing the page signed in as a KCCA user with real data; `next build`.

## Next (Phase 6B candidates)

- Click-through from a division row or collector to filtered issue / trip lists.
- Raise a compliance notice directly from a scorecard row or fleet alert.
- KCCA-editable service standards (table + admin screen) instead of code defaults.
- Indexes on `collection_jobs(job_date, status)` and `citizen_issues(status, created_at)` if refresh time grows with real volumes.

---

# Phase 6B — KCCA-owned service standards and notices from the command centre

## Service standards (editable by KCCA)

- New table `kcca_service_standards` (migration **091**, additive, idempotent) seeded with the starting values
  24 / 24 / 48 / 72 h. Every change is written to `kcca_service_standard_history` with old value, new value,
  reason and the officer's name; that history cannot be updated or deleted (database trigger).
- Command centre → **Service standards**: KCCA admins change hours (1–720, whole hours) with a reason;
  system admins can view only. The command centre applies new standards from its next refresh.
- Until 091 is applied the command centre keeps working on the built-in defaults, and the standards
  dialog explains that the migration is needed.
- API: `GET /api/waste/command-center/standards` (KCCA, system admin), `PUT /api/waste/command-center/standards`
  (KCCA only) — body `{ standards: [{ category, responseHours }], reason }`.

Apply locally: `cd services/waste-service && npm run migrate:kcca-service-standards:check && npm run migrate:kcca-service-standards`.
Production: `infrastructure/production/migrate.sh` picks up `091_kcca_service_standards.sql` automatically.

## Issue a compliance notice from evidence

- **Issue notice** on each scorecard row and **Issue compliance notice** on a truck with a fleet alert
  (KCCA admins only). The dialog is prefilled — category, severity, subject, the evidence figures, required action
  and due date (critical 3 days, others 7; fleet 2 days) — and KCCA edits it before issuing.
- It uses the existing `POST /api/waste/compliance/city` workflow, so the collector sees and answers it in their
  KCCA compliance page as before. No new notice type was created.

## Verification

- waste-service: `tsc` clean, `npm test` 76/76 (2 new: custom standards, change validation).
- Fixture database: migration check/apply/re-apply; before-migration fallback; company admin 403, invalid hours 400,
  KCCA change audited with name and reason, unchanged values 409, command centre uses the new standard
  (an illegal-dumping report at 48 h moved from overdue to within standard after 48 → 72 h), history immutable,
  system admin view-only; a generated fleet notice accepted by the compliance endpoint and reflected in totals and scorecard.
- admin-web: `tsc --noEmit` and ESLint clean on the page and both dialogs. Not yet viewed signed in with live data.
