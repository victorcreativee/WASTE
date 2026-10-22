# Engineering Audit & Hardening — Batch 1 (2026-10-20)

Scope: whole monorepo as it exists in the local working folder (which is ahead of GitHub `main` @ `5c58a60`:
30 modified files, the whole `apps/desktop` app, 14 mobile components, 4 auth files and migrations 087–090 are not committed).

Legend: **[V]** verified by running code/tests in this batch · **[C]** confirmed by reading the code · **[T]** needs testing on real data/devices.

---

## 1. Executive summary

**Overall health: good foundations, not yet production-hard.** The domain model is serious and careful: tenant isolation is
enforced in both the API (`requireOrganizationScope`, membership-based `organization_effective_permissions`) and the database
(trigger-based integrity checks, migrations 073–080), money movements take advisory locks inside transactions, offline sync
is idempotent (`desktop_sync_requests`), and the desktop/mobile clients store credentials properly (Electron sandbox +
context isolation + scrypt + lockout; Expo SecureStore + PIN lockout).

**Strongest decisions**
- DB-enforced tenant/actor integrity and permissions, with regression tests for them.
- Idempotent offline mutation sync with request hashing and receipt replay.
- Hardened Electron shell (navigation allow-list, `/api/` path allow-list, no Node in renderer).
- Checksummed, transactional migration runner (`infrastructure/production/migrate.sh`).

**Most important weaknesses (before this batch)**
1. A single PostgreSQL restart or network drop could crash every backend service (no pool `error` listener). **[V]**
2. No brute-force protection on `/api/auth/login`; existing rate limits were effectively global because `trust proxy` was off. **[V]**
3. Refresh tokens survived password changes and admin resets for up to 7 days. **[V]**
4. Unexpected errors (DB outages, bugs) were returned as `400` with raw internal messages; a DB blip during token refresh returned `401`, logging users out. **[V]**
5. No database backups anywhere in the deployment. **[C]**
6. Source durability: the desktop app and much recent work exist only on one laptop; the public GitHub repo tracks ~16k `node_modules` files, `dist/` output and four `.env` files. **[C]**

**Production readiness: conditional.** After this batch the backend fails safe, recovers from DB restarts and resists
credential attacks. Remaining blockers are operational (commit/backups/secret rotation) and scalability (unbounded list queries).

---

## 2. Current architecture

| Layer | Technology | Notes |
|---|---|---|
| Web | Next.js 16 / React 19, Tailwind 4, Leaflet | `apps/admin-web`, ~70 files, all dashboard pages are client components; standalone output |
| Desktop | Electron 44 + better-sqlite3 | `apps/desktop` wraps the standalone web build; offline queue, snapshots, auto-update (**not in git**) |
| Mobile | Expo 57 / React Native 0.86 | `apps/recycling-mobile`, Android tablet + phone; SecureStore sessions |
| Gateway | Express 5 + http-proxy-middleware 3 | `apps/api-gateway`, path-prefix routing to 3 services, aggregated health |
| Services | Express 5, pg, zod, jsonwebtoken | `auth-service` (identity, staff, payroll, access), `organization-service`, `waste-service` (operations, finance, recycling, regulatory) |
| Database | PostgreSQL 16 + PostGIS 3.4 | 90 ordered migrations, 83 tables, 145 indexes, business rules in triggers/functions |
| Hosting | Docker Compose (`infrastructure/production`) behind host nginx | Ports bound to 127.0.0.1; Redis used only by the gateway health check |

All services share one database and one JWT access secret; services re-load user status/roles from the DB on every request
(so suspensions take effect immediately for the waste and organization services).

---

## 3. Issues and risks

| # | Sev | Issue | Where | Evidence | Status |
|---|---|---|---|---|---|
| 1 | **Critical** | Idle pg client error crashes the process | all `src/config/database.ts` | Reproduced: plain Pool exits 1 on PG restart; with listener survives **[V]** | **Fixed** |
| 2 | **High** | No login brute-force limit; per-IP limits keyed on the gateway's IP (global) | `auth.routes.ts`, all `app.ts` | 12 bad logins → all 401 before; now 429 after 10, other clients unaffected **[V]** | **Fixed** |
| 3 | **High** | Refresh tokens valid after password change/reset | `utils/jwt.ts`, `auth.service.ts` | Old refresh token now → 401 "password was changed" **[V]** | **Fixed** |
| 4 | **High** | Internal errors returned as 400 + raw message (e.g. `relation "users" does not exist`); refresh DB errors → 401 → forced logout | auth/waste/org `app.ts`, controllers | Before/after captured in smoke test **[V]** | **Fixed** |
| 5 | **High** | Public `/api/auth/register` accepted any `organizationId`, linking self-registered accounts to real companies | `auth.validator.ts`, `auth.service.ts` | Registered with KCCA's id → stored `organization_id` was set; now `null` **[V]**. No client uses this endpoint. | **Fixed** |
| 6 | **High** | No database backup or restore procedure | `infrastructure/production` | No pg_dump/volume backup anywhere **[C]** | **Script added** (`backup.sh`, restore verified locally) — schedule + off-site copy still needed |
| 7 | **High** | Source not under version control / public repo hygiene | repo root | `apps/desktop` untracked; 15,985 `node_modules` + 5,521 `dist` files tracked; 4 `.env` files (dev secrets) public **[C]** | `.gitignore` fixed; **you** must commit + untrack (see §5) |
| 8 | Medium | Account enumeration: suspended accounts revealed without the password; timing differs for unknown emails | `auth.service.ts` | Now identical 401 for unknown/wrong; status revealed only after correct password **[V]** | **Fixed** |
| 9 | Medium | Services start in production with empty/placeholder secrets | all `config/env.ts` | Placeholder `dev-…` secret now refuses boot **[V]** | **Fixed** |
| 10 | Medium | No graceful shutdown: `docker stop`/deploy cuts in-flight requests, pools not closed | all `server.ts` | SIGTERM now drains and exits 0 **[V]** | **Fixed** |
| 11 | Medium | Gateway proxy failure behaviour undefined / HTML; no upstream timeout | `proxy.routes.ts` | Upstream down → JSON 502 **[V]**; 120 s upstream timeout | **Fixed** |
| 12 | Medium | Org service had no JSON error handler (Express default HTML) | `organization-service/src/app.ts` | **[C]** | **Fixed** |
| 13 | Medium | Missing browser security headers on the web app | `next.config.ts` | **[C]** | **Added** (nosniff, frame DENY, referrer, permissions); **not build-verified here** |
| 14 | Medium | Most list endpoints are unbounded (`SELECT` without `LIMIT`) | e.g. `contract`, `customer-stop`, `citizen-issue`, `compliance` repositories | 22 repositories, ~400 SELECTs, ~40 LIMITs **[C]** | Roadmap P1 |
| 15 | Medium | Very large single-file client pages | `recycling/page.tsx` 145 KB, `billing` 88 KB, `driver-mobile` 58 KB | Whole pages ship as one client bundle **[C]**; bundle size not measured (build not possible here) **[T]** | Roadmap P2 |
| 16 | Medium | Two migration mechanisms (checksummed `migrate.sh` + 60+ ad-hoc `migrate-*.cjs` scripts) | `services/waste-service/scripts` | Drift risk **[C]** | Roadmap P2 |
| 17 | Low | CORS open on every service | all `app.ts` | Bearer tokens (no cookies) limit impact **[C]** | Roadmap P2 (env-configured allow-list) |
| 18 | Low | Minified one-line source in many files (109 lines > 500 chars) | e.g. `payroll.repository.ts` | Hard to review/diff **[C]** | Roadmap P2 (Prettier) |
| 19 | Low | 15 tenant tables lack an index leading on `organization_id` | e.g. `payroll_lines`, `inventory_movements`, `supplier_payments` | Static scan; several are covered by composite uniques **[T]** | Roadmap P2 (verify with `EXPLAIN` on production-size data) |
| 20 | Low | No CI; auth & org services had no tests | — | **[C]** | 7 auth tests added; CI in roadmap |

---

## 4. Changes made in this batch

All backward compatible: no API contract changes, no schema migration, no data changes.

- **`*/src/runtime.ts`** (new, one per service — services build independently in Docker): production config validation,
  `trust proxy` setting, graceful shutdown + unhandled-rejection logging, safe JSON error handler.
  Error handler keeps every intentional message: `statusCode`/`status` errors, Zod issues (`field: message`), unique
  violations with the waste service's friendly constraint messages, and DB trigger rules (`P0001` → 400 with the trigger's text).
  Only *unexpected* errors become `500 "Something went wrong on our side…"` and are logged server-side.
- **`*/src/config/database.ts`**: `dbPool.on("error")` listener, `application_name` per service (visible in `pg_stat_activity`).
- **`*/src/server.ts`**: start through `startServer` (drains on SIGTERM/SIGINT, closes DB/Redis).
- **Gateway `proxy.routes.ts`**: `xfwd` (real client IP reaches services), JSON 502 on upstream failure, 120 s upstream timeout.
- **Auth**: per-account+IP (10 / 15 min) and per-IP (100 / 15 min) login limits with `Retry-After`; constant-time-ish unknown-user
  path; status revealed only after a correct password; refresh tokens carry `pwv`, a keyed fingerprint of the password hash, so any
  password change, admin reset or account revocation ends older sessions (tokens issued before this release keep working until expiry);
  public registration never links an organization.
- **Controllers** (`auth.controller.ts`, `organization.controller.ts`): rethrow unexpected errors to the central handler.
- **`infrastructure/production/backup.sh`** (new): `pg_dump -Fc`, integrity check with `pg_restore --list`, atomic rename, 600 perms, retention.
- **`compose.yaml` / `.env.example`**: optional `TRUST_PROXY` passthrough (empty = safe default).
- **`next.config.ts`**: baseline security headers, `poweredByHeader: false`.
- **`.gitignore`**: node_modules, dist, build caches, `.env*` (except examples), `backups/`.
- **Tests**: `services/auth-service/tests/session-security.test.ts` (7), `services/waste-service/tests/runtime.test.ts` (7); `npm test` script for auth-service.

### Tests and checks executed

| Check | Result |
|---|---|
| `tsc --noEmit` + `tsc` build: gateway, auth, organization, waste | all pass (before and after) |
| waste-service `npm test` | 58/58 before → **65/65** after |
| auth-service `npm test` (new) | **7/7** |
| Live smoke test (all 4 services + gateway on PostgreSQL 16) | register, login, refresh, password change → old refresh rejected, enumeration, brute-force 429, per-client isolation via X-Forwarded-For, PG restart survival (all 4 alive), DB failure → safe 500, upstream down → JSON 502, SIGTERM → clean exit, placeholder secret → refuses boot |
| Pool crash reproduction | without listener: process exits 1 on PG restart; with listener: survives |
| `backup.sh` | dump written, `pg_restore` into fresh DB, row counts match |

### Not verified here (environment limits)
- **admin-web and desktop builds** — this workspace has no npm registry access, and their `node_modules` are not in git. Run `npm run build` in `apps/admin-web` once.
- **DB-backed stabilization suites** (`npm run test:finance` etc.) — need PostGIS, unavailable here. Run them locally against your dev database.
- Mobile app was reviewed, not built.

---

## 5. Actions for you (cannot be done from here)

1. **Before deploying**: confirm production secrets pass the new check (≥ 32 random characters, not starting with `dev`/`change`/`replace`), otherwise services will refuse to start by design:
   `awk -F= '/^JWT_/{print $1, length($2)}' infrastructure/production/.env`
2. **Commit your work and stop tracking generated files and dev `.env` files** (from the repo root on your Mac):
   ```bash
   git add -A apps/desktop apps/recycling-mobile services infrastructure docs .gitignore apps/admin-web
   git rm -r --cached --quiet node_modules \
     apps/api-gateway/node_modules apps/api-gateway/dist \
     services/auth-service/node_modules services/auth-service/dist \
     services/organization-service/node_modules services/organization-service/dist \
     services/waste-service/node_modules services/waste-service/dist \
     apps/api-gateway/.env services/auth-service/.env services/organization-service/.env services/waste-service/.env
   git commit -m "Hardening batch 1; stop tracking dependencies, build output and local env files"
   ```
   Keep the local `.env` files (they are still used for development). Consider making the GitHub repository private.
3. **Rotate** any secret that ever appeared in a committed `.env` if it was also used outside your laptop.
4. **Schedule backups** on the server (crontab line is in `backup.sh`) and copy the dumps off the server.
5. Run `npm run build` in `apps/admin-web` and the stabilization suites in `services/waste-service` against your dev DB.

---

## 6. Improvement roadmap

| Pri | Item | Complexity | Dependencies / risk | Benefit |
|---|---|---|---|---|
| **P0** | Commit desktop + local work; untrack node_modules/dist/.env; rotate exposed secrets | S | Needs your machine | No single-laptop loss; clean, reviewable repo |
| **P0** | Schedule `backup.sh` + off-site copy + monthly restore drill | S | Server access | Survive disk/server loss |
| **P1** | Pagination (`limit`/`cursor`, default + max) for unbounded lists, starting with customers, collection stops, citizen issues, transactions | M | Must stay backward compatible: add optional params, keep current response shape | Predictable latency as Kampala data grows |
| **P1** | Structured JSON logs with request id propagated gateway → services; error alerting | M | Low | Faster incident diagnosis |
| **P1** | Readiness vs liveness health endpoints + compose `healthcheck` for services | S | Low | Safe rolling restarts |
| **P1** | Move rate limits to Redis (already deployed) if more than one instance per service is run | S | Only when scaling out | Limits hold across instances |
| **P2** | Split the largest client pages into route segments / lazy-loaded panels (recycling, billing, driver-mobile) | M–L | Needs build + UI regression check | Smaller bundles, faster first load on low-end tablets |
| **P2** | One migration path (retire ad-hoc `migrate-*.cjs` in favour of `migrate.sh` checksums) | M | Coordinate with existing environments | No schema drift |
| **P2** | CI: typecheck, unit tests, admin-web build, migration dry-run on PostGIS container | M | GitHub Actions | Catch regressions before deploy |
| **P2** | Prettier + ESLint on backend; reformat one-line files | S | Large diff — do in its own commit | Reviewability |
| **P2** | CORS allow-list via env; Content-Security-Policy (allow map tile hosts) | S–M | CSP needs browser testing | Defence in depth |
| **P2** | Index review with `EXPLAIN ANALYZE` on production-sized data for the 15 tenant tables flagged | S | Use `CREATE INDEX CONCURRENTLY` | Query speed |
| **P3** | Server-side session list (revoke per device), MFA for system/KCCA admins | M | Schema addition | Stronger account security |
| **P3** | Read replicas / reporting views for city-wide dashboards | L | Infra | Scale reporting |

## 7. Next implementation priorities (batch 2)
1. Backward-compatible pagination for the heaviest list endpoints, with tests.
2. Request-id propagation + structured logging across gateway and services.
3. Liveness/readiness endpoints and compose health checks.
4. admin-web build verification and bundle measurement once dependencies are available.
