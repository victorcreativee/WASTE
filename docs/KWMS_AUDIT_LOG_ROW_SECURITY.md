# KWMS — audit log and tenant isolation

Concept note KWMS-CN-001-2026, cross-cutting requirements: multi-tenant row-level security, and an audit log with
before/after state and IP address. Migration 113.

## Tenant isolation (row-level security)

- **The database enforces it, not only the code.** The services still log in with `DATABASE_URL`, but every
  connection switches to the restricted role `kwms_app` (`SET ROLE`), which is not a superuser and cannot bypass
  row-level security. Before a connection is used, the service tells PostgreSQL who the request is for
  (`kwms_set_request_context`: user, IP, request id, path). The database looks up that user's roles itself and sets
  the scope:

  | Scope | Who | Sees |
  |---|---|---|
  | tenant | company staff (admin, supervisor, driver, recycling roles, applicants) | only rows of their own organization |
  | city | KCCA staff, weighbridge operators | every operator |
  | household | citizens | not narrowed by the database; the services filter by household |
  | public | requests without a signed-in user (sign-in, public receipt check, MoMo callbacks) | not narrowed |
  | system | scheduled work with no request | not narrowed |

  An account with no known role is treated as tenant with no organization, so it sees none of the protected rows.
- **Which tables.** 60 operator-owned tables: customers and their locations, contracts, subscriptions, packages,
  bills, payments, mobile money accounts, receipts, routes, collection jobs and stops, trucks, drivers, GPS
  positions, fleet records, expenses, payroll, suppliers, inventory, and the recycling ledgers. A company can neither
  read nor write another company's rows in them, whatever the query says. Older rows with no organization in
  `collection_jobs`, `collection_routes`, `customer_service_locations`, `driver_job_problems`, `drivers`,
  `pickup_schedules` and `waste_trucks` stay visible as before.
- **Shared by design, still filtered by the services:** users and access control, organizations, notifications,
  permits, returns, penalties and other regulatory records (KCCA and the company both work on them), weighbridge
  tickets (the landfill records loads from every hauler), the recycling factory flow, and the SaaS subscription tables.
  A processing plant sees the sales made to it and the lots they came from.
- **Isolation report.** KCCA and the system admin see on **Audit log** whether isolation is enforced right now, which
  role the services use, and every table with an organization column and its state
  (`GET /api/waste/audit/isolation`).
- Not a defence against SQL injection inside the same connection; the services use parameterised queries throughout.

## Audit log

- **Written by the database.** A trigger on 42 business and regulatory tables records every insert, update and
  delete in `audit_log`: time, organization, user, their roles and scope, IP address, request id, method and path,
  the service (or `psql`) that made it, the database login, the record, the changed fields, and the full record
  before and after. Updates that change nothing (or only bookkeeping such as `updated_at`) are skipped.
- **Cannot be forged or changed.** The trigger runs as the owner; the `kwms_app` role has no insert, update, delete or
  truncate rights on `audit_log`, and triggers reject any change or delete even by the owner.
- **Secrets never stored.** Values in fields named like password, secret, token, OTP or encrypted credentials are
  stored as `[redacted]`; the log still shows that they changed.
- **Changes outside the system are visible.** An edit made directly in the database (a DBA in `psql`, a migration) has
  no signed-in user and is flagged *Directly in the database* with the login used. KCCA sees how many happened in the
  last 30 days.
- **Who reads it.** Screen: **Audit log** — KCCA (*Regulation*), system admin (*Reference*), company admin
  (*Administration*, own organization only). Filter by record type, change, origin (through the system or directly in
  the database), organization (KCCA), dates, and person, email, IP or request id. *View* shows the before and after of
  each field.
- API: `GET /api/waste/audit` (paged), `GET /api/waste/audit/:id`, `GET /api/waste/audit/filters`,
  `GET /api/waste/audit/isolation` (KCCA and system admin).
- The older `organization_audit_events` (access and billing events, shown under *Access & permissions*) is unchanged.

## Configuration

| Variable | Purpose |
|---|---|
| `DB_APP_ROLE` | Role the services switch to. Default `kwms_app`; leave it unset. **Emergency only:** set it to empty to turn isolation off without a migration. The audit log keeps recording. |
| `TRUST_PROXY` | Already in use: decides which proxies are trusted for the client IP. The default (loopback and private networks) gives the real client IP behind nginx and the gateway. |

## Operations

- `kwms_app` is a cluster role, so `pg_dump` does not include it. When restoring into a new PostgreSQL server, run
  migration 113 again (it is idempotent) to recreate the role and its rights.
- New tables created by later migrations get the `kwms_app` rights automatically (default privileges). A new
  operator-owned table must be added to the isolation list in a migration, or it is shared; the isolation report shows
  it as *Shared by design*.
- The audit log grows with activity and is never pruned. Plan a retention policy with KCCA before it becomes large;
  partitioning by month is the natural next step.
- GPS positions are isolated but not audited (volume). GPS consent and retention rules are separate work.
