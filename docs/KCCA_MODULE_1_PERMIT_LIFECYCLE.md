# KCCA Command Center — Module 1: permit lifecycle and authorized activities

Delivered 21 October 2026. Builds on the permit foundation (migrations 034, 038, 052) without changing existing
permit numbers, dates or statuses.

## What changed for each role

| Role | Before | Now |
|---|---|---|
| **KCCA admin** | Approve/renew/suspend from one dropdown offering every action regardless of status; no reinstatement; renewal only on KCCA's initiative | **Permits and renewals** (`/dashboard/permits`): lifecycle summary (in force, expiring in 60 days, expired, suspended, in review), only the decisions valid for each status, authorized activities chosen at approval, suspension and **reinstatement**, a company **renewal request queue**, full permit history, a list of collectors with **no permit on record**, and **Run expiry check now** |
| **System admin** | Read permits | Same, read-only (cannot decide) |
| **Company admin** | Certificate download in company settings | **KCCA permit** (`/dashboard/permit`): status, days left, activities, divisions, notices, **request renewal** (with an optional PDF/JPG), withdraw a request, decision history, certificate download |
| **Supervisor** | — | Same page, read-only (cannot request renewal) |
| **Public** | — | **`/verify`**: enter the code or scan the certificate QR to see the permit's *live* status |

## Rules

**Authorized activities.** A permit now lists what the company may do. Catalogue (`permit_activity_types`):
household collection, commercial and institutional collection, transport to disposal site, bulky and construction waste
(collectors); recyclable collection, recyclable trading, recycling and processing (recycling companies — used from Module 2).
KCCA must choose at least one activity when approving, and only activities matching the organization type are accepted.
Existing permits were given *household collection, commercial collection, transport to disposal site* (the scope of the
original collection permit), recorded in each permit's history.

**Decisions by status.**

| Status | KCCA may |
|---|---|
| Submitted / information required | Start review |
| Under review | Approve (validity date + activities), request information, reject |
| Approved | Renew, change activities, suspend |
| Suspended | Reinstate (only while still in date), renew with a new date |
| Expired | Renew |

A new validity date must be in the future, after the current expiry, and at most 5 years ahead. Renewal is still blocked
when the organization is inactive or has an open critical compliance case (existing rule, kept).

**Suspension** suspends the permit's division authorizations and marks them `suspended_by_permit`; **reinstatement**
restores exactly those, not divisions KCCA had removed for other reasons.

**Automatic expiry.** The waste service runs `expire_lapsed_permits()` 15 seconds after start and then hourly (an advisory
lock keeps several instances from duplicating work). An approved permit past its `valid_until` becomes `expired`, its
division authorizations become `expired`, a history entry is written by "System", and the company gets a notice.
Everywhere the public or operations read a permit, an approved permit past its date is already treated as expired, so
nothing depends on the timing of the job.

**Reminders.** `issue_permit_expiry_reminders()` gives the company one notice at 60, 30 and 7 days before expiry (only the
tightest that applies, once per validity period; renewing resets them). Notices appear on the company's KCCA permit page
until marked as read. *Email/SMS delivery is not part of this module* — the platform has no outbound messaging yet.

**Company renewal requests.** Open from 90 days before expiry and stay open after expiry; refused while suspended or
while another request is open (database-enforced). KCCA approves with its own date (defaulting to the requested one),
which extends the permit, its division authorizations and the request in one transaction — or rejects with a note the
company sees. If KCCA renews directly on the permit while a request is open, that request is closed as approved.

**Operations enforcement.** A database trigger on `collection_routes` blocks *planning* (insert) and *dispatch* of
collection routes when the collector's permit is suspended, expired, or does not include household or commercial
collection. Because it is in the database, route creation, the trips screen and dispatch all obey it. Work already
in progress is not interrupted. The message tells the company exactly why (e.g. *"KCCA permit PERMIT-… expired on
11 Oct 2027. Request a renewal before planning or dispatching routes."*).

> **Transitional rule.** Collectors created before permits existed (no permit on record) are **not** blocked; KCCA sees
> them under *No permit on record*. Once a permit is linked to them, the rules apply. Locally there are 2 such collectors.

**Public verification.** Every issued permit has a verification code (`XXXX-XXXX-XXXX`), printed on the certificate with
a QR code linking to `/verify?code=…`. The page shows company, permit number, live status, validity, activities and
active divisions — never contact details or documents. The public API is rate-limited by the existing public router.

**Audit.** Permit history can no longer be updated or deleted (trigger); every decision, renewal request, withdrawal,
automatic expiry and activity change is recorded with who and why.

## Database — migration 092 (`infrastructure/database/092_permit_lifecycle_activities.sql`)

Additive and idempotent. New: `permit_activity_types`, `organization_permit_activities`, `permit_renewal_requests`,
`permit_lifecycle_notices`; columns `verification_code`, `expired_at`, `suspended_at` on permits and
`suspended_by_permit` on division authorizations; functions `expire_lapsed_permits`, `issue_permit_expiry_reminders`,
`organization_permit_block_reason`, `new_permit_verification_code`; triggers for route enforcement and history immutability.

```bash
cd services/waste-service
npm run migrate:permit-lifecycle:check   # validates and rolls back
npm run migrate:permit-lifecycle         # applies (local only unless ALLOW_NON_LOCAL_MIGRATION=true)
```

Production: `infrastructure/production/migrate.sh` picks up 092 automatically. Set **`PUBLIC_APP_URL`** (e.g.
`https://wms.kcca.go.ug`) in `infrastructure/production/.env` so certificate QR codes point to the real site; the service
warns at start-up if it is missing. `PERMIT_LIFECYCLE_SCHEDULER=off` disables the hourly job (used by tests).

## API (all under `/api/waste`)

| Method & path | Who |
|---|---|
| `PATCH /regulatory/permit-applications/:id` — now also `reinstate`, `update_activities`; `activityCodes[]` | KCCA admin |
| `GET /regulatory/permit-applications/:id/history` | KCCA, system admin |
| `GET /regulatory/permit-activity-types` | KCCA, system admin, company admin, supervisor |
| `GET /regulatory/permit-lifecycle/overview` | KCCA, system admin |
| `POST /regulatory/permit-lifecycle/run` | KCCA admin |
| `GET /regulatory/permit-renewals[?status=]`, `GET …/:id/evidence` | KCCA, system admin |
| `PATCH /regulatory/permit-renewals/:id` — `{action: approve\|reject, notes, validUntil?, activityCodes?}` | KCCA admin |
| `GET /regulatory/organization-permit` | Company admin, supervisor |
| `POST /regulatory/organization-permit/renewals` — `{requestedValidUntil, statement, evidence?}` | Company admin |
| `PATCH /regulatory/organization-permit/renewals/:id/withdraw` | Company admin |
| `POST /regulatory/organization-permit/notices/:id/acknowledge` | Company admin, supervisor |
| `GET /public/permit-verification/:code` | Anyone |

The company endpoints sit outside platform package gating: every licensed company gets them, whatever its subscription.

## Files

- Backend: `services/waste-service/src/services/permit-lifecycle.rules.ts` (all rules, unit-tested),
  `repositories/permit-lifecycle.repository.ts`, `controllers/permit-lifecycle.controller.ts`,
  `services/permit-certificate.pdf.ts` (new certificate with QR), `services/permit-lifecycle.scheduler.ts`;
  changes in `regulatory.repository.ts`, `regulatory.validator.ts`, `regulatory.controller.ts`, both regulatory route files,
  `server.ts`, `config/env.ts`. New dependency: `qrcode`.
- Frontend: `apps/admin-web/src/app/dashboard/permits/page.tsx` (rewritten), `app/dashboard/permit/page.tsx`,
  `app/verify/page.tsx`, `lib/session.ts` (hydration-safe role check), `lib/api.ts` (`openAuthenticatedFile`), navigation.

## Verification

- `npm test` (waste-service): **84/84** (8 new: status actions, effective expiry, renewal window, validity limits,
  reminder thresholds, code normalization, certificate content).
- `npm run test:e2e:permits` against a waste-service instance and the local database: **27/27** checks — approval rules and
  role denials, activities, division authorization, reminders (issued once), company standing, notice acknowledgement,
  public verification (formats, unknown code), certificate PDF, renewal request rules (window, duplicates, dates,
  supervisor denied), reject → notify → reapply, withdraw, approve with KCCA's own date (permit + divisions + request),
  suspension (routes blocked, divisions suspended, certificate withheld, renewal refused, public sees suspended),
  reinstatement (exact divisions restored), automatic expiry (status, history by System, divisions, routes blocked),
  renewal of an expired permit closing the open request, activity scope blocking collection routes, immutable history.
  Fixtures are removed afterwards; organizations that appear in immutable audit events are deactivated and renamed
  `[e2e fixture] …` instead.
- Migration 092: validated with rollback, applied locally, re-applied (no-op); the existing permit was backfilled correctly.
- Browser: KCCA workspace and detail panel, company KCCA permit page, `/verify` with the real local permit; certificate
  rendered and inspected. `tsc` and ESLint clean on all changed frontend files.
- **Not done:** `next build` (it would interrupt the running dev server); email/SMS reminders; linking a permit to the
  legacy collectors; recycling-company activity enforcement (Module 2).

Local data note: `kampala_divisions` was empty in the local database although migration 034 seeds it; the idempotent seed
line was re-run so the five divisions exist again.
