# KCCA Command Center — Module 2: recycling oversight and recycler licensing

Delivered 21 October 2026. Builds on Module 1 (permit lifecycle, migration 092) and the existing recycling workspace
(migrations 054–090). Read-only towards recycling companies' records; nothing they recorded was changed.

## What KCCA gets

**Recycling oversight** (`/dashboard/recycling-oversight`, KCCA admin and system admin):

- **Period:** last 30 days (default), last 90 days, year to date, or a custom range (up to two years).
- **City figures:** recyclables collected, sold to industry, sorting residue (material that still needs licensed disposal),
  stock held now, and the **recovery rate** = recyclables collected ÷ (recyclables collected + weighbridge-verified disposal)
  for the same period.
- **Materials** by category (plastic, paper and cardboard, metal, glass, organic, textile, other), from each company's own
  material catalogue; names not in a catalogue count as "other".
- **Last six months** of collected vs sold, city-wide (and per recycler in the detail panel).
- **Recyclers table** with collected, sold, residue share, stock (and stock older than 90 days), daily-closing discipline,
  last activity and a **standing**: *Good*, *Watch* or *Action required*, with the reason.
- **Where material goes:** sold volume by the buyer industry recorded on each sale.
- **Recycler detail:** why it is flagged, its materials, monthly trend, aged stock by material, buyers by industry, recent
  daily closings, and **Issue compliance notice** prefilled from the evidence (new category *Recycling operations*).
- **Export CSV** of the recyclers table for the chosen period (opens cleanly in Excel; formula-like text is neutralised).

**Privacy boundary.** The oversight shows volumes only. Prices, sale values, supplier and buyer names, customers, cash,
float and payroll stay inside each company's workspace.

## Standing rules (`services/waste-service/src/services/recycling-oversight.rules.ts`)

| Flag | Severity | Rule |
|---|---|---|
| No permit on record | Action | No permit ever issued to the company |
| Permit expired / suspended | Action | Current permit not in force today |
| Permit expiring | Watch | Expires within 30 days |
| Inactive | Watch | No purchase, sorting or sale for more than 14 days (or never) |
| Aged stock | Watch | ≥ 500 kg held for more than 90 days |
| High residue | Watch | > 20% of sorted input rejected, with at least 100 kg sorted in the period |
| Closing gap | Watch | Daily closing on fewer than 80% of working days, with at least 3 working days |

Any *Action* flag → **Action required**; otherwise any flag → **Watch**; none → **Good**. All thresholds live in
`OVERSIGHT_THRESHOLDS` and are unit-tested. **KCCA should confirm these thresholds before they are used for enforcement.**

**Definitions.** *Collected* = purchased lots in the period (sorting outputs are re-labelled stock, not new material; lots
marked rejected are excluded). *Sold* = sales in the period. *Residue* = `rejected_kg` from sorting batches.
*Stock* = available kg on lots that are available or partially sold, regardless of period. *Working day* = a day with any
purchase, sorting or sale.

## Licensing recycling companies (extends Module 1)

Recycling companies join the platform with a registration document and never went through the permit flow. KCCA can now
**issue a permit directly to any active organization** (Permits and renewals → *No permit on record* → **Issue permit**):
registration number, contact, licensed operations, validity and activities. The same route licenses collectors created
before permits existed. The permit starts approved, gets a verification code and certificate, and is recorded in its
history as issued directly by KCCA. A second permit for an organization that already holds one is refused (renew or
reinstate instead).

**Enforcement.** Database triggers now check recycling records:

| Record | Needs a permit in force with |
|---|---|
| New purchase (lot with origin *purchase*) | Recyclable material collection |
| New sale | Recyclable material trading **or** Recycling and processing |

Sorting existing stock is not blocked. The same transitional rule as Module 1 applies: a company with **no permit on
record is not blocked** (KCCA sees it flagged *Action required*). Messages tell the company exactly why, e.g. *"KCCA
permit PERMIT-… is suspended. New material purchases cannot be recorded until KCCA reinstates it."* Expiry notices for
recyclers now describe purchases and sales instead of collection routes, and the company's KCCA permit page does the same.
Recycling companies now see **KCCA permit** in their navigation.

## Database — migration 093 (`infrastructure/database/093_recycling_oversight.sql`)

Additive and idempotent. Requires 092.

- `organization_permit_block_reason(org, activities, blocked_action)` covers recycling companies; the two-argument form
  used by Module 1 delegates to it.
- Triggers `trg_recycling_lot_permit`, `trg_recycling_sale_permit`.
- `trg_permit_certificate_on_insert`: permits created already approved get a certificate date and verification code
  (the earlier trigger only handled updates; found by the end-to-end test).
- `expire_lapsed_permits()` writes notices appropriate to the organization type.
- Compliance category `recycling_operations`.
- Indexes for city-wide period queries on lots, sales, sorting batches and completed weighbridge tickets.

```bash
cd services/waste-service
npm run migrate:recycling-oversight:check   # validates and rolls back
npm run migrate:recycling-oversight         # applies (local only unless ALLOW_NON_LOCAL_MIGRATION=true)
```

Production: `infrastructure/production/migrate.sh` applies 093 after 092 automatically.

## API (under `/api/waste`)

| Method & path | Who |
|---|---|
| `GET /recycling-oversight?period=30d\|90d\|year` or `?from=YYYY-MM-DD&to=YYYY-MM-DD` | KCCA admin, system admin |
| `GET /recycling-oversight/recyclers/:id` (same period parameters) | KCCA admin, system admin |
| `GET /recycling-oversight/export.csv` (same period parameters) | KCCA admin, system admin |
| `POST /regulatory/organizations/:id/permits` — `{registrationNumber, contactName, email, phone, address, serviceDescription, validUntil, activityCodes[], notes}` | KCCA admin |
| `POST /compliance/city` — now accepts `category: "recycling_operations"` | KCCA admin |

## Files

- Backend: `src/services/recycling-oversight.rules.ts`, `src/repositories/recycling-oversight.repository.ts`,
  `src/controllers/recycling-oversight.controller.ts`, `src/routes/recycling-oversight.routes.ts`; permit issuance in
  `permit-lifecycle.repository.ts` / `permit-lifecycle.controller.ts` / `regulatory.routes.ts`; validators.
- Frontend: `app/dashboard/recycling-oversight/page.tsx` (new), `app/dashboard/permits/page.tsx` (Issue permit),
  `app/dashboard/permit/page.tsx` (recycler wording), `components/command-center/ComplianceNoticeDialog.tsx` (new
  category), `components/layout/AppShell.tsx` (navigation), `globals.css` (numbers in tables do not wrap).

## Verification

- `npm test` (waste-service): **91/91** (7 new: periods, invalid periods, recovery rate, good standing, permit flags,
  operational flags with their minimums, CSV quoting and formula neutralising).
- `npm run test:e2e:recycling` against a waste-service instance and the local database: **17/17** — access (anonymous 401,
  company 403, system admin 200); unlicensed recycler allowed but flagged; activity/role checks on issuance; direct
  issuance with verification code and history; duplicate refused; activities gating purchases vs sales; legacy collector
  licensed; city totals (collected, sold, sorted, residue, disposal, recovery rate); recycler flags and standing; category,
  industry and monthly breakdowns; recycler detail; custom and invalid periods; CSV content; suspension blocking purchases
  and sales; recycler-specific expiry notice; recycling-operations compliance case.
- Module 1 end-to-end suite re-run after the shared function changes: **27/27**.
- Migration 093 validated with rollback, applied locally, re-applied after the insert-trigger fix.
- Browser, with the end-to-end data kept temporarily: oversight overview, recyclers table, recycler panel, prefilled
  compliance notice (not issued), Issue permit form for a real local recycler (not submitted). The data was then removed.
- `tsc` and ESLint clean on all changed frontend files. `next build` not run (would interrupt the running dev server).

## Not in this module

- **Recycling factories** as their own organization type: today a processor is either a recycling company with the
  *Recycling and processing* activity, or appears as a buyer industry. A dedicated factory type with intake/output
  reporting belongs with the factory workspace in the SaaS phase.
- Locations: field GPS is captured on some purchases, but divisions have no boundaries in the database yet, so volumes are
  not broken down by division.
- Monetary insight (market prices, sales value) is deliberately excluded pending KCCA's data-sharing policy.
