# KCCA Command Center 1.0 — release notes and Module 5 (hardening)

Prepared 21 October 2026. Everything below is verified locally by `npm run release:check`; nothing has been committed
or deployed yet.

## What 1.0 contains

| Area | Delivered in |
|---|---|
| Modern, restrained interface across the web app; account menu and sign-out | UI pass, Module 3 |
| Permit lifecycle: activities, automatic expiry, 60/30/7-day reminders, company renewals, suspend/reinstate, QR-verifiable certificates, route enforcement | [Module 1](./KCCA_MODULE_1_PERMIT_LIFECYCLE.md) |
| Recycling oversight, direct permits for recyclers and legacy collectors, recycling enforcement | [Module 2](./KCCA_MODULE_2_RECYCLING_OVERSIGHT.md) |
| Free regulatory portal for licensed companies, monthly statutory returns, KCCA returns register | [Module 3](./KCCA_MODULE_3_REGULATORY_PORTAL.md) |
| City reports with insights, print/PDF, issued official reports | [Module 4](./KCCA_MODULE_4_CITY_REPORTS.md) |
| Hardening and release tooling | Module 5 (this document) |
| Recycling factories: intake, processing, dispatch, chain of custody from recyclers, KCCA oversight and returns | [Module 6](./KCCA_MODULE_6_RECYCLING_FACTORIES.md) |
| Notifications: in-app bell and inbox, email and SMS with retries, per-person channel settings | [Module 7](./KCCA_MODULE_7_NOTIFICATIONS.md) |
| Disposal verification: every collection trip matched to a KCCA weighbridge ticket, company explanations, KCCA review | [Module 8](./KCCA_MODULE_8_DISPOSAL_VERIFICATION.md) |
| Illegal dumping enforcement: reports with photos and location, inspection, responsibility, cleanup orders with deadlines, recurrence | [Module 9](./KCCA_MODULE_9_ILLEGAL_DUMPING.md) |
| Fines and penalties: published schedule, notices, one appeal, confirmed payment, escalation to permit suspension | [Module 10](./KCCA_MODULE_10_PENALTIES.md) |
| GPS track checks: each trip's GPS compared with facilities and its weighbridge ticket; tracking through the disposal leg | [Module 11](./KCCA_MODULE_11_GPS_TRACK_CHECKS.md) |
| Waste Management SaaS, first module: plans, trials, invoices, plan limits, read-only on non-payment | [Module 12](./SAAS_MODULE_12_SUBSCRIPTIONS.md) |

Database migrations added: **092–103**. All are additive and idempotent.

## Module 5 — what changed

### Server-side sessions (migration 096)
- Each sign-in creates a session in `user_sessions`, and both tokens carry its id. **All three services** reject an access
  token whose session has ended, so sign-out takes effect immediately across the API, not after the 15-minute token expiry.
- `POST /api/auth/logout` ends the current session, or every session with `{ "everywhere": true }`. It works with an
  expired access token by falling back to the refresh token, and never reveals whether a session existed.
- Changing the password signs out every **other** device and keeps the current one.
- The web sign-out calls the server first (4-second timeout, so an offline device still signs out locally) and offers
  **Sign out on all my devices**.
- Tokens issued before this release keep working until they expire; refreshing one moves it into a session. Every
  service tolerates the table being absent, so code and migration can roll out in either order.
- Ended sessions older than 30 days are pruned.

### Operability
- **Readiness:** `GET /api/auth/ready`, `/api/organizations/ready`, `/api/waste/ready` return 200 only when the database
  answers and this release's tables exist (503 lists what is missing). `/health` is unchanged.
- **Request ids:** the gateway and every service accept a well-formed `X-Request-Id` (or create one), return it, and
  include it in 5xx responses and error logs. Malformed client values are replaced, so logs cannot be injected.
- **Structured logs:** in production each request is one JSON line (`time, service, request_id, method, path, status,
  ms`); development keeps the readable `morgan` output.
- **CORS allow-list:** `CORS_ORIGINS` (comma-separated) restricts browser origins on the gateway and services. It is
  unset by default, which keeps current behaviour. Set it to the public web address in production.
- **Docker health checks** on every service and the gateway; the gateway waits for healthy services and the web app
  waits for the gateway.
- **`infrastructure/production/deploy.sh`:** build → start database → back up → migrate → start services → wait until
  every service is *ready*. It stops at the first failure and warns if `PUBLIC_APP_URL` is empty.

### Dependencies
| Package | Before | After |
|---|---|---|
| auth, organization, waste services | 1 critical, 2 moderate, 1 low each (express stack) | **none** |
| admin-web | 1 critical, 4 high (Next.js, PostCSS, sharp) | **none** — Next.js 16.2.6 → 16.4.2 |
| api-gateway | 1 critical, 4 high, 3 moderate | 3 high, all one accepted issue (below); `uuid` removed in favour of Node's `crypto.randomUUID` |

**Accepted risk:** `braces` ≤ 3.0.3 (via `micromatch` in `http-proxy-middleware`) has a stack-exhaustion issue with
deeply nested glob patterns, and no fixed release exists. The gateway only matches fixed route patterns from its own
code, never patterns from requests. Re-check when `braces` publishes a fix; the release check names this exception
explicitly and fails on anything else.

Next.js 16.4 is stricter about the project root in a monorepo. `next.config.ts` now compiles from `apps/admin-web` and,
inside the monorepo, keeps file tracing at the repo root, so the standalone build stays at
`.next/standalone/apps/admin-web/server.js`, where the desktop app loads it.

### Pagination (backward compatible)
The four largest list endpoints accept optional paging:

| Endpoint | Sort (with unique tie-breaker) |
|---|---|
| `GET /api/waste/weighbridge/transactions` | operation date, created time (newest first), id |
| `GET /api/waste/citizen-issues` | created time (newest first), id |
| `GET /api/waste/customers` | name, id |
| `GET /api/waste/customer-collection-stops` | scheduled date (newest first), stop order, created time, id |

- **No paging parameters → exactly the previous response**, so the web app, desktop app and mobile app are unaffected.
- `?limit=50&offset=100` or `?page=3&pageSize=50` (maximum 500 per page) returns that page with
  `pagination: { limit, offset, total, returned, has_more, next_offset, page, page_size }` and an `X-Total-Count` header.
- Invalid values (zero, over 500, negative, or mixing both styles) answer 400 with a clear message.
- The unique tie-breaker means rows with identical timestamps can never repeat or vanish between pages.
- Shared helper: `services/waste-service/src/utils/pagination.ts` (5 unit tests). Adding paging to another list endpoint
  is a small change in its repository and controller.
- **Not yet:** the web screens still load full lists and page in the browser. Moving them to server paging needs server-side
  search and filters on each screen, which is the natural next step once lists grow.

### Release tooling
- **`npm run verify:migrations`** (`scripts/verify-migrations.sh`) applies all 96 migrations to a brand-new
  `postgis/postgis:16-3.4` container exactly as `migrate.sh` does, re-applies 092+ to prove they repeat safely, checks the
  key tables, and removes the container.
- **`npm run release:check`** (`scripts/release-check.sh`) runs: type checks (5 packages) → unit tests → production
  dependency audit → admin-web production build (and standalone path) → fresh-database migrations → all end-to-end
  suites against local test instances on ports 8191/8193. It stops at the first failure and cleans up after itself.
- **`.github/workflows/ci.yml`** runs the same gates on every push and pull request. The end-to-end job migrates a
  fresh PostGIS service container and runs every suite against it.

## Verification

`npm run release:check` (run twice, the second time after hardening its own cleanup):

| Gate | Result |
|---|---|
| Type checks: gateway, auth, organization, waste, admin-web | pass |
| Unit tests | 7 (auth) + 109 (waste) pass |
| Dependency audit | pass (one documented gateway exception) |
| Admin web production build | 59/59 pages; standalone server where the desktop app expects it |
| Fresh-database migrations | 96 applied; 092–096 re-applied; no key table missing |
| End-to-end | sessions 12, permits 27, recycling 17, regulatory portal 14, city reports 14, pagination 11 (**95 checks**) |

The CI end-to-end job was rehearsed locally on a fresh PostGIS container with CI-style secrets: all five suites passed.
The workflow file itself has not run on GitHub yet.

Findings made during this module:
- Migrations older than 092 are not written to be re-run (073 fails on a second run). That is safe because `migrate.sh`
  records applied migrations, but never apply old migration files by hand.
- The local database has never had migrations 084 (desktop sync idempotency) and 091 (KCCA service standards) applied;
  a fresh install includes them. Apply them locally: `cd services/waste-service && npm run migrate:kcca-service-standards`,
  and apply 084 through `migrate.sh` or its own script.
- `npm audit fix --omit=dev` prunes development packages from `node_modules`; run `npm install` afterwards. This briefly
  stopped the local dev stack during this module. It was restored; see "Local environment" below.

## Deploying 1.0

1. Commit and push (see the engineering audit for untracking `node_modules`, `dist` and `.env` files first).
2. On the server, set in `infrastructure/production/.env`:
   - `PUBLIC_APP_URL=https://<public web address>` (certificate QR codes)
   - `CORS_ORIGINS=https://<public web address>`
   - optional: `RETURNS_FIRST_PERIOD=YYYY-MM` if KCCA wants returns to start later than September 2026
   - optional: `DISPOSAL_FIRST_DATE=YYYY-MM-DD` if KCCA wants trip disposal assessed from a date other than 1 October 2026
   - email and SMS (Module 7): `NOTIFY_EMAIL_PROVIDER=smtp`, `SMTP_URL`, `NOTIFY_EMAIL_FROM`, and
     `NOTIFY_SMS_PROVIDER=africastalking` with `AT_USERNAME`, `AT_API_KEY`, `AT_SENDER_ID` (or `webhook` with
     `NOTIFY_WEBHOOK_URL` and `NOTIFY_WEBHOOK_SECRET`). Without them messages are only written to the service log.
3. Run `infrastructure/production/deploy.sh`. It backs up the database, applies 092–103, and finishes only when every
   service reports ready.
4. Set the subscription plan prices (Module 12, placeholders today) before any trial ends. Set the location of every disposal facility on the GPS track checks page (none are seeded). Ask KCCA to confirm the penalty schedule amounts (Module 10, placeholders today) and the thresholds documented in Modules 2–4 (recycler standing, returns tolerance, report targets)
   before they are used for enforcement.

## Still open after 1.0

- Moving the web screens for those four lists to server-side paging with server-side search (the API supports paging now).
- A full Content-Security-Policy: needs browser testing because maps load third-party tiles.
- Retiring the ad-hoc `migrate-*.cjs` scripts in favour of `migrate.sh` only.
- Admin-web ESLint still reports two existing issues (`WeighbridgeReconciliation.tsx`, login effect); the release
  check does not run lint for that reason.

## Local environment after this module

- Migration 096 applied to the local database.
- The root `npm run dev` stack had stopped. The three services came back on their own; the gateway (port 8090) and the
  web app (port 3000) are now running as background processes started from this session. To return to the usual single
  terminal, stop those two and run `npm run dev` from the repository root.
