# KCCA Command Center — Module 4: city reports and insights

Delivered 21 October 2026. Builds on the command centre (Phase 6A/6B) and Modules 1–3. Read-only towards operational
data; adds one table for issued reports.

## What KCCA gets

**City reports** (`/dashboard/city-report`, KCCA admin and system admin; under City oversight):

- Choose a **month** or **quarter**. The draft is prepared live from the records and compared with the previous period.
  The current period can be viewed "to date"; future periods are refused.
- The report is a document, laid out to print cleanly on A4 (**Print or save as PDF**; the app shell is hidden in print):
  1. **Key findings:** plain-language insights, most serious first (risk, then attention, then positive).
  2. **Headline figures:** collection completion, missed collections, waste delivered for disposal, weighbridge
     verification, issues resolved within standard, issues received, recovery rate, returns filed, each with its change
     on the previous period (percentage points for rates).
  3. **Collection service** by division (from each job's zone; unlinked jobs are shown separately).
  4. **Resident issues** by category against KCCA's response standards: received, resolved, share within standard,
     median time.
  5. **Recycling:** collected, sold, residue, recovery rate, materials (from Module 2).
  6. **Licensing:** permits in force at period end, new, renewed, suspended, expired, renewal requests, expiring
     within 60 days, companies with no permit on record (from Module 1).
  7. **Accountability:** compliance cases opened, closed and open at period end by category; monthly-returns filing per
     month (from Module 3).
  8. **Collector performance:** league table with the command centre's 0–100 service score over the period.
  9. **Six-month trend:** completion, disposal tonnage, resident issues, recyclables.
  10. **How these figures are produced:** definitions and the standards used, printed with every report.
- **Collectors CSV** exports the league table (draft or issued).
- **Issue report** (KCCA admin, completed periods only) freezes the draft as an **official, numbered record**
  (`KCCA-CR-2026-09`) with optional KCCA commentary printed at the top. Issued reports are listed below the report and
  open with an "official report" banner.
- **Corrections:** a period's issued report cannot be edited or deleted (database trigger). If figures change, KCCA issues a
  **replacement** with a reason; the old report is marked *superseded by KCCA-CR-2026-09-R1: reason* and stays readable.

## Insight rules (`services/waste-service/src/services/city-report.rules.ts`, `INSIGHT_RULES`)

| Finding | Tone | Rule |
|---|---|---|
| Collection completion below target | attention, or risk if it fell ≥ 5 pts | completion < 90% |
| Completion improved | positive | up ≥ 5 pts and at or above target |
| Missed collections up | risk | up ≥ 20% with at least 10 missed in either period |
| Issues resolved within standard | risk / positive | < 80% / ≥ 95% |
| Collectors needing action | risk | service score < 65 (names listed) |
| Companies with no permit on record | attention | any |
| Permits expiring soon | attention | expiring within 60 days of period end |
| Monthly returns filing low | attention | < 90% of returns due were filed |
| Weighbridge verification low | attention | < 90% of completed trips verified |
| Disposal tonnage moved | attention | ± 10% on previous period |
| Recyclers needing action | attention | any (Module 2 standing) |
| Recovery rate rose | positive | up ≥ 2 pts |
| Best collector | positive | highest score ≥ 85 with at least 10 collections |

At most eight findings are shown. **KCCA should confirm these targets before reports are published.**

## Definitions

- Scheduled collections exclude cancelled jobs; completion = completed ÷ scheduled.
- Disposal = net weight of completed weighbridge tickets in the period; verification = completed trips with a verified weight.
- Resident issues: measured from report to resolution against `kcca_service_standards` (or the built-in defaults until
  migration 091 is applied: missed collection 24 h, overflowing bin 24 h, illegal dumping 48 h, pickup request 72 h).
- Collector score: completion 50, verification 20, issues within standard 15 (unresolved issues count against the
  standard up to the period end), regulatory standing 15 (0 without a valid permit at period end, 30% with an open critical
  case, 70% with any open case).
- Licensing counts come from the permit history (new permits = approvals from review or direct issue; renewals = validity
  extensions). Permits "in force at period end" use the dates and current status as recorded.
- Monthly returns are counted for months from `RETURNS_FIRST_PERIOD` that had fallen due when the report was prepared.

## Database — migration 095 (`infrastructure/database/095_city_reports.sql`)

Additive and idempotent. Table `city_reports` (one issued report per period; frozen data and commentary; supersession with
reason, link deferred to commit), protection trigger, and indexes for period queries on resident issues, jobs and permit
history.

```bash
cd services/waste-service
npm run migrate:city-reports:check
npm run migrate:city-reports
```

## API (under `/api/waste`)

| Method & path | Who |
|---|---|
| `GET /city-reports/live?period=YYYY-MM\|YYYY-Qn` (default: last month) | KCCA admin, system admin |
| `GET /city-reports/live/export.csv?period=` | KCCA admin, system admin |
| `GET /city-reports`, `GET /city-reports/:id`, `GET /city-reports/:id/export.csv` | KCCA admin, system admin |
| `POST /city-reports` — `{period, commentary?, replaceReason?}` | KCCA admin |

## Verification

- `npm test` (waste-service): **104/104** (7 new: months and quarters with previous periods, refused periods, trend
  months / shares / changes / medians, issue standards by category, steady period produces no alarms, risks ordered first
  with names, licensing / filing / verification / tonnage / recovery signals).
- `npm run test:e2e:city-report`: **14/14** — access; quarter resolution and refusals; headline figures and change on
  August (cancelled jobs excluded, verification, disposal, issues, cases); issue standards by category; licensing (new
  permit, unlicensed collector); league table scores worked out by hand (84 *Watch*, 35 *Action required*) and ranking;
  divisions, accountability and trend; returns filing for the month; insights naming the collector and ordered by
  seriousness; CSV row; incomplete-period and role refusals; issuing with commentary; frozen snapshot while live figures
  change (update and delete refused); replacement requires a reason and supersedes the original.
- All earlier suites re-run in the same session: Module 3 **14/14**, Module 2 **17/17**, Module 1 **27/27**.
- Migration 095 validated with rollback and applied locally.
- Browser: draft report for September 2026 with test data (findings, headline figures, sections, league table), issued
  report list and opening a superseded official report. Test data and the test's issued reports removed afterwards.
- `tsc` and ESLint clean on the new page. **Print output was not checked** in a real print dialog; the print stylesheet hides
  the app shell, toolbars and the issued list and keeps sections together.

## Notes

- Compliance cases created by earlier end-to-end runs cannot be deleted (they are immutable by design), so the local
  September 2026 report shows a few *service delivery* cases from deactivated `[e2e fixture]` companies.
- Not included: scheduled e-mailing of reports, charts beyond the trend table, per-division resident issues (issues are
  not linked to divisions consistently yet), monetary indicators.
