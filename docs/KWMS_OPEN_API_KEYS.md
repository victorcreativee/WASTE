# KWMS — Open API and key management

Concept note KWMS-CN-001-2026, phase 3: "Open API with key management". Gives NEMA, development finance institutions,
carbon verifiers and companies' own systems read-only access to verified data. Migration **116**.

## Keys

| Who issues | Holder | Sees | Scopes allowed |
|---|---|---|---|
| Collection company admin | the company's own systems (accounting, website, reporting) | that company only | all five |
| KCCA admin | a named partner, with contact email and purpose | every operator (city-wide) | all but `receipts:read` |

- **Format.** A key reads `kwms_<8-character id>_<40-character secret>`. It is shown once when created. KWMS keeps
  only its SHA-256 hash, and the app's database role cannot even read the hash column. A lost key is revoked and
  replaced.
- **Scopes.** `operators:read`, `tonnage:read`, `certificates:read`, `carbon:read`, `receipts:read`. Household
  receipts are personal data, so the database refuses partner keys with `receipts:read`.
- **Expiry and limits.** Keys expire after 30 days to 2 years (1 year by default). Each key has a per-minute limit:
  60 for company keys, and 1–600 for partner keys (KCCA sets it).
- **Revoking.** A key is revoked with a reason and stops working at once. Only active collection companies can have
  keys, and a deactivated company's keys stop working.
- **Usage.** Every request is counted per key, endpoint and Kampala day, with refused requests counted separately.
  Each key's last use and IP address are shown.
- **Audit.** Creation, scope and limit changes, and revocation go to the audit log, with the secret hash redacted.
- **Who manages keys.** Companies see and manage only their own keys (row-level security). KCCA and system
  administrators see every key and can revoke any.

## How a key's requests are protected

- **Isolation.** A request with a key runs under row-level security as the key's company (tenant scope), or
  city-wide for a partner key. `kwms_set_request_context` now takes an optional API key, which is the fifth argument
  all three services send. Every query also filters by the key's company, because the weighbridge and organization
  tables are shared by design.
- **Read-only.** The open API has only GET endpoints.
- **Failed keys.** Malformed keys are refused without a database lookup. More than 20 failed attempts a minute from
  one address are refused with 429.
- **Limits are in memory.** They live in the waste-service process, which is fine with one waste-service container.
  Several replicas would need a shared store such as Redis.

## Endpoints

The base is `https://<site>/api/v1`; the gateway forwards `/api/v1` to waste-service. Send the key as
`Authorization: Bearer kwms_...` (or `X-API-Key`). The machine-readable description is at
`/api/v1/openapi.json` (OpenAPI 3.1, no key needed).

| Endpoint | Scope | Returns |
|---|---|---|
| `GET /me` | — | the key: holder, access (operator or city), scopes, limit, expiry |
| `GET /operators` | `operators:read` | licensed collection companies, permit number and status, divisions |
| `GET /tonnage?from&to` | `tonnage:read` | loads and net kg per day, operator and facility (up to 92 days) |
| `GET /load-certificates?from&to&page&pageSize` | `certificates:read` | load certificates (module 5), revoked status, fingerprint, composition |
| `GET /carbon-baseline?from=YYYY-MM&to=YYYY-MM` | `carbon:read` | monthly baseline rows by operator, destination and stream |
| `GET /receipts?date&page&pageSize` | `receipts:read` | one Kampala day of the company's own receipts, with chain hashes; no phone numbers or street addresses |

- **Success:** `{ data, meta }`. List endpoints with pages put `page`, `pageSize` and `total` in `meta`.
- **Errors:** `{ error: { code, message } }`. The codes are `invalid_key` (401), `missing_scope` (403),
  `invalid_request` (400), `rate_limited` (429, with `Retry-After`), `too_many_failures` (429), `not_found` (404) and
  `server_error` (500).
- **Rate limit headers:** every response carries `X-RateLimit-Limit`, `X-RateLimit-Remaining` and
  `X-RateLimit-Reset` (seconds).

## Screens

**API keys** (`/dashboard/api-keys`) appears in these menus:
- Company admin: *Administration*
- KCCA: *Regulation*
- System admin: *Reference*

The page shows:
- how to call the API, with a link to the OpenAPI document
- every key with its data, limit, last use, requests in the last 30 days and expiry
- *Usage*: requests by day and endpoint
- *Revoke*

*Create key* (company) or *Issue partner key* (KCCA) shows the key once, with a copy button.

Management API under `/api/waste`:
- `GET /api-keys`, `GET /api-keys/:id/usage` and `POST /api-keys/:id/revoke`: company admin, KCCA and system admin
- `POST /api-keys`: company admin and KCCA

## Deploying

- **Migrations first.** Migration 116 replaces the four-argument `kwms_set_request_context` with a five-argument one
  whose fifth argument is optional. Services still running the old code keep working, but the new code needs the
  migration, so it must run before the services restart. `deploy.sh` already does that.
- **Set `PUBLIC_APP_URL`.** The OpenAPI document gives the server address as `PUBLIC_APP_URL/api/v1`, and the
  variable is still empty in production.
- **No CORS change needed.** The API is for server-to-server use. Browsers calling it from another site are still
  limited by `CORS_ORIGINS`.

## Not covered yet

- Write access, such as submitting returns or receipts from another system. Every endpoint is read-only.
- Webhooks (notifying a partner when data changes).
- Package gating: every collection company can create keys. To make the API part of a paid package, add a feature
  and gate `POST /api-keys`.
