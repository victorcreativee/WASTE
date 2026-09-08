# WMS organization system — audit, gap analysis and architecture review

Audit date: 3 September 2026. Project: /Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE

## Executive decision

**Preserve the existing application, but do not describe it as a complete, securely isolated multi-organization business platform yet.** It is a substantial operational prototype with real SQL-backed workflows. The principal obstacle is not the number of screens: it is inconsistent authorization, incomplete business relationships, and financial/operational state that can diverge.

The strongest next milestone is a **secure two-organization demonstration**, followed by customer-specific collection execution. Pause advanced HR, accounting, GPS and recycler expansion until those foundations pass acceptance tests.

Most urgent findings:

1. KCCA is authorized to read private organization expenses, billing, procurement, fleet costs and combined workforce/finance reports.
2. A supervisor without an organization passes role checks; null tenant identifiers can mean unrestricted access.
3. Jobs and route stops identify zones, not customer service locations. Customer history is zone history.
4. Confirmation of multiple pending payments can over-credit an invoice.
5. Reports double-count fleet outflows after fleet costs become paid finance expenses.
6. Inventory stock movement SQL fails preparation with PostgreSQL error 42P18.
7. Organization creation does not create the administrator required to operate the organization.
8. Permission tables exist, but configurable tenant-scoped RBAC does not.

No application code, schema, business records, permissions or organization assignments were changed during this audit. Only these audit documents were added.

## 1. Evidence and confidence

### What was inspected

- All registered routes in Auth, Organization and Waste; gateway mount/proxy configuration; authentication and authorization middleware.
- Controller scoping, service validation, repositories and migrations for every existing module family.
- Frontend route inventory, API calls, navigation, shared components, driver/customer flows, GIS and report calculations.
- Current local database table metadata and role linkage counts, without reading passwords or exporting customer records.
- Existing tests, frontend lint and TypeScript checks.

[Separate endpoint inventory: 100 service route registrations](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/docs/WMS_API_AUDIT_2026-09-03.md) documents the route surface and inherited guards. The gateway additionally exposes GET /api/health.

### Runtime evidence collected this audit

| Check | Result | What it does NOT prove |
|---|---|---|
| Frontend /login, gateway, auth, organization and waste health | All returned HTTP 200 | Authentication, tenancy and business workflows are not thereby proven |
| Existing waste-service tests | 18 passed | Predominantly middleware, validation and mocked routing tests; not full cross-tenant or accounting integration |
| FundingShortfall frontend component tests | 4 passed | Not browser interaction or database enforcement |
| Frontend lint and TypeScript | Passed | Does not catch SQL business defects |
| Waste-service TypeScript | Passed | Does not validate dynamically constructed SQL |
| Auth, Organization, Gateway TypeScript | All passed | Does not prove independent service deployability |
| In-memory requireRoles with supervisor + organizationId=null | Allowed; no 403 | Synthetic missing-tenant case, not an allegation that an existing supervisor is exploiting it |
| PREPARE of existing inventory UPDATE, without execution | Failed: 42P18, could not determine data type of parameter $3 | No stock was changed |
| Database metadata | 40 public tables including extension/health tables; RLS disabled on all | Absence of RLS alone is not a vulnerability; it means application scoping is the only barrier |
| Role/config metadata | 7 global roles; 17 permissions; 4 organizations | Four organizations are not four fully provisioned tenant test accounts |

Current company_admin, supervisor and driver role assignments have organizations; the supervisor null-scope defect is latent rather than demonstrated through an existing unlinked supervisor. There is only one current company-admin assignment, so a full A-versus-B administrative test matrix needs additional explicitly provisioned fixtures.

**E2E grading:** “traced” below means connected frontend → gateway → service → SQL exists, not that all transitions were exercised in a browser during this audit. No mutation endpoints or previously written rollback integration fixtures were run here. Prior session test results are historical evidence, not a substitute for a fresh complete ecosystem demo. No major module earns “complete and working” against the full brief.

## 2. A — Current architecture

    One Next.js frontend (role-dependent pages, sessionStorage JWTs)
        |
        | /api/auth, /api/organizations, /api/waste
        v
    Express API Gateway :8090
        +-- Auth service :8091
        |     Accounts, global roles/permissions, staff, customer creation,
        |     supervisor assignments, attendance, payroll
        +-- Organization service :8092
        |     Organization list/detail/create
        +-- Waste service :8093
              Zones, vehicles, drivers, schedules, jobs, routes, incidents,
              customer service, contracts, billing, expenses, inventory,
              procurement, payables, fleet and reporting
        |
        v
    Shared PostgreSQL + PostGIS schema
        - Auth writes users AND customers/drivers/payroll/expenses
        - Waste reads users/roles AND writes business modules
        - Database functions aggregate payroll + billing + supplier + expenses
        - Fleet triggers create expense drafts

    Redis: gateway health connectivity, not a demonstrated job/event system
    OSRM: road geometry/distance for supplied stop order
    OpenStreetMap tiles: map display
    External payment provider: placeholder, no real charge initiation

Sources: [apps/api-gateway/src/routes/proxy.routes.ts](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/apps/api-gateway/src/routes/proxy.routes.ts); [services/waste-service/src/app.ts](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/waste-service/src/app.ts); [services/auth-service/src/repositories/organization-user.repository.ts](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/auth-service/src/repositories/organization-user.repository.ts); [services/auth-service/src/repositories/payroll.repository.ts](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/auth-service/src/repositories/payroll.repository.ts); [infrastructure/database/021_financial_controls.sql](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/infrastructure/database/021_financial_controls.sql); [infrastructure/database/022_fleet_expense_links.sql](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/infrastructure/database/022_fleet_expense_links.sql).

This is best understood as **several deployments over a tightly shared database**, not independently owned domain microservices. This is workable for an MVP if ownership and transactions are explicit; immediately splitting every module would make current coupling harder to manage.

Docker Compose initializes only init.sql, which creates extensions and a health table. The numbered domain migrations are not automatically applied by that setup. There is no demonstrated versioned migration runner or one-command reproducible application stack.

## 3. B — Feature matrix

Legend: ✅ complete for the stated narrow check; 🟡 partial; 🔴 missing; ⚠️ existing but incorrectly designed; 🔗 partial backend/DB capability without the required frontend workflow. “DB” refers to domain support, not simply a generic text column.

| Module | Existing | Backend | Frontend | DB | Working E2E | Missing / limitation |
|---|---|---|---|---|---|---|
| Health/connectivity | ✅ narrow check | Health endpoints | Login responds | DB/Redis health | Health verified | Not business readiness |
| Authentication | 🟡 | Register/login/me, bcrypt, JWT | Login, tab sessions | Users/global roles | Traced; not fresh login replay | Refresh rotation, revocation, MFA, recovery, rate limits |
| Tenant isolation | ⚠️ | Many org predicates, null bypass | Role navigation | Nullable org FKs; no RLS | Not safe as a whole | Fail-closed context, composite ownership constraints, tests |
| RBAC | ⚠️ | Role guards; unused permission middleware | Hard-coded roles | Global roles + permissions | Role gates tested, not custom RBAC | Tenant roles, module/action grants, assignment UI |
| Organization provisioning | 🟡 | List/detail/create | Organizations page | Organization type/status | Traced create; lifecycle incomplete | Admin invitation/provisioning, activation/update workflow |
| Organization administration | 🔴 | Opening balance is a narrow setting only | No central admin workspace | No general settings/modules/branches | No | Depots, catalogs, hours, integrations, feature flags |
| Staff management | 🟡 | Create driver/supervisor, status, team assignment | Team page | Users + drivers + supervisor_drivers | Narrow chain traced | Employee profile independent of login, broader/custom roles |
| Attendance/payroll | 🟡 / ⚠️ | Basic attendance/pay lines/period lifecycle | Team/payroll pages | Attendance, periods, lines | Traced; races remain | HR contracts/leave/documents, immutable approved payroll |
| Official zones | 🟡 / ⚠️ | Create/assign, spatial matching | Waste/GIS | Polygon/point; single org field | Traced assignment | Assignment history, polygon editing, division hierarchy |
| Internal sub-zones | 🔴 | None | None | No separate entity | No | Distinguish internal areas from KCCA areas |
| CRM/customer service | 🟡 / ⚠️ | Admin creates account/location; self-service | Customer management + My service | Profile + primary location | Traced | Configurable segments, bins, documents, multiple service relationships |
| Contracts/packages | 🟡 / ⚠️ | Package-controlled creation, activation + invoice | Contracts and package modals | Plans/contracts/subscriptions | Narrow chain traced | Lifecycle synchronization, calendar pricing, operational plan link |
| Pickup schedules | 🟡 | CRUD subset, manual date-range generation | Dispatch | Zone schedule/frequency | Traced zone-level jobs | Customer recurrence, worker, calendar exceptions, emergency workflow |
| Jobs/dispatch | 🟡 / ⚠️ | Create/assign/status | Dispatch tables | Zone/truck/driver/schedule | Narrow chain traced | Customer/service-location FK, supervisor, availability enforcement |
| Routes | 🟡 / ⚠️ | Create ordered jobs, OSRM geometry | Dispatch/GIS | Routes + join stops | Traced | Route/job assignment invariants, duplicate allocation prevention |
| Driver workspace | 🟡 | Self-scoped job/route execution | Dedicated view within shared page | Times/weight/notes | Traced | Own completed history, offline sync, GPS evidence, missed-stop resolution |
| Proof of collection | 🔗 partial | evidenceUrl accepted | No evidence upload in completion payload | URL column | Not full proof workflow | Upload storage, signed access, GPS/signature, required evidence policy |
| Supervisor workspace | ⚠️ | Org-wide APIs, team assignment stored | Shared dashboards | Team relation | Not assigned-team enforcement | Dedicated scoped view, escalations, assigned zone/vehicle responsibilities |
| Customer app | 🟡 / ⚠️ | Self service, billing, complaints | Shared Next pages | Basic profile/billing | Zone history only | Own pickup history, contract view, receipt download, extra-pickup execution |
| Fleet register/maintenance/fuel | 🟡 | Register/docs/costs/status, expense link | Fleet page | Fleet records + source-linked expenses | Latest link tested in previous session; traced here | Availability state machine, richer vehicle data, technicians/parts |
| Live fleet / telematics | 🔗 DB stub | current_location selected, no ingestion found | No live vehicle layer | Point only | No live flow | GPS samples, speed, freshness, replay, geofences, devices |
| Complaints/incidents | 🟡 | Citizen issues + driver problems | Issues/driver pages | Both tables | Traced | Attachments, notification delivery, SLA/escalation/rescheduling |
| Finance cash controls | 🟡 / ⚠️ | Cash/commitments, expense approval/payment | Billing + funding UI | Separate transaction tables/functions | Traced; not full accounting | Immutable ledger, stable opening baseline, reversals, cash accounts |
| Accounts payable/procurement | 🟡 / ⚠️ | Orders, bills, partial payments | Both pages | Supplier/order/bill/payment tables | Narrow chain traced | Duplicate PO billing constraints, receiving invariants, accrual handling |
| Inventory | ⚠️ | Items/requests; movement statement fails | Inventory page | Stock + movements | Manual movement blocked by SQL defect | Correct SQL, request/receipt synchronization, valuation |
| Customer billing | 🟡 / ⚠️ | Invoice generation + manual/pending payments | Income & billing | Plans/subscriptions/invoices/payments | Traced manual flow | Contract expiry coupling, credit balance, reconciliation |
| WMS payment platform | 🔴 / placeholder | Provider interface always returns pending | Provider selector | Basic payment record | No real provider flow | Intents, transactions, webhook, fees, refunds, receipts, settlements |
| General accounting | 🔴 | Cash arithmetic only | No accounting workspace | No COA/journal/ledger | No | AR/AP control accounts, trial balance, P&L, balance sheet |
| Reporting | 🟡 / ⚠️ | Combined aggregates/date filter | Dashboard, daily CSV | Queries over shared tables | CSV path traced; cash formula wrong | Private/regulatory separation, semantic fixes, dimensions, PDF/XLSX/scheduling |
| Notifications | 🔴 | No dispatch/delivery endpoints or worker found | Counts/alerts are not notifications | No inbox/outbox/delivery schema | No | In-app, email/SMS/push, templates, preferences, retries |
| KCCA integration/control room | 🟡 / ⚠️ | Global summaries, zones/orgs/incidents | Dashboard + separate GIS | Same operational/private tables | Partial monitor chain | Regulatory projections, directives, submissions, permission-limited drilldown |
| Recycler / waste buyer | 🔴 | Organization type values only | No actor workspace | No demand/order/material tracking | No | Separate profiles, demand, supply, quality, custody lifecycle |
| Platform super admin | 🟡 / ⚠️ | system_admin role; org create | Mostly same KCCA navigation | Global roles/orgs | Basic role access | Platform admin UI, providers/fees/modules/health/audit controls |
| Audit logging | 🔴 | Morgan/request ID, scattered actor fields | No audit viewer | No durable change-event ledger | No | Actor + tenant + entity + before/after + access/export history |

## 4. C/D — Critical problems and gap analysis

### F01 — P0: KCCA receives private company business data (confirmed in code)

KCCA is explicitly allowed by expenses, billing, contracts, payables, procurement, inventory, fleet and report routers. Their controllers commonly map KCCA to organizationId=null; repositories use “null OR organization match” and return all organizations. Reports include finance and attendance aggregates. Fleet reads include expense numbers/status and operating costs. The navigation even offers KCCA “Revenue oversight.”

Payroll's direct API is company-admin-only: **do not confuse that with privacy protection overall**. Paid payroll expenses and combined reporting can disclose salary outflows indirectly. Replace global access to private routes with explicit regulatory projections and audited grants. Company revenue must not become “regulatory” merely because a city administrator can request it.

Evidence: [services/waste-service/src/routes/expense.routes.ts](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/waste-service/src/routes/expense.routes.ts); [services/waste-service/src/controllers/billing.controller.ts](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/waste-service/src/controllers/billing.controller.ts); [services/waste-service/src/repositories/report.repository.ts](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/waste-service/src/repositories/report.repository.ts); [apps/admin-web/src/components/layout/AppShell.tsx](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/apps/admin-web/src/components/layout/AppShell.tsx).

### F02 — P0: missing organization can become an unrestricted scope (runtime + code)

requireRoles rejects an unlinked company_admin but not an unlinked supervisor. Controller scope helpers pass that supervisor's null organization to unrestricted query patterns. The in-memory test confirmed the guard calls next(). Several read routes are affected; generic operations writes also skip ownership checks when no organization is supplied. Citizen issue mutation has a similar null-filter hazard.

Deny missing tenant context for every tenant role before repository execution. Use explicit scope types (tenant, self, assigned team, regulatory projection), never null meaning both “not configured” and “all.” Recheck active organization membership on each request. Current middleware checks user activity but does not join organizations.is_active. Do not assume company deactivation will disable all its users.

Evidence: [services/waste-service/src/middlewares/auth.middleware.ts](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/waste-service/src/middlewares/auth.middleware.ts); [services/organization-service/src/middlewares/auth.middleware.ts](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/organization-service/src/middlewares/auth.middleware.ts); [services/waste-service/src/controllers/waste.controller.ts](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/waste-service/src/controllers/waste.controller.ts); [services/waste-service/src/services/waste.service.ts](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/waste-service/src/services/waste.service.ts).

### F03 — P1: RBAC is mostly hard-coded, despite permission tables

roles.name is globally unique with no organization scope; membership is users.organization_id, not a membership entity. Routes use literal role lists. requirePermission exists in Auth but no business route wiring using it was found. Frontend menus also use literal role arrays; login stores roles, not an effective module/action capability model. Organization staff creation only accepts driver/supervisor.

Preserve the role/permission foundation, but make tenant membership and scoped role assignment explicit. Add permission checks to backend actions first; then generate navigation/actions from effective permissions. Role names should be editable labels, not security rules.

Evidence: [infrastructure/database/001_auth_schema.sql](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/infrastructure/database/001_auth_schema.sql); [services/auth-service/src/middlewares/auth.middleware.ts](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/auth-service/src/middlewares/auth.middleware.ts); [services/auth-service/src/validators/auth.validator.ts](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/auth-service/src/validators/auth.validator.ts); [apps/admin-web/src/components/layout/AppShell.tsx](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/apps/admin-web/src/components/layout/AppShell.tsx).

### F04 — P1: pending payment confirmation can over-credit invoices

Each pending request independently checks the invoice balance at creation. confirmPayment marks a pending record successful, then subtracts its amount using GREATEST(0,...), without rechecking the remaining balance or invoice payable status. Example: two pending requests of 100 against an invoice of 100 can both become successful; receipts total 200 while the invoice is clamped to zero. This does not require a race.

Manual recording is stronger (locks the invoice), but reference deduplication across different invoices is a check-then-insert without a database unique constraint. A future real provider must be called only after ownership/amount validation and durable payment-intent creation; current service calls the placeholder before validating the invoice.

Evidence: [billing repository: createPendingPayment, confirmPayment, recordOrganizationPayment](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/waste-service/src/repositories/billing.repository.ts); [services/waste-service/src/services/billing.service.ts](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/waste-service/src/services/billing.service.ts).

### F05 — P1: cash reports double-count fleet costs

Reports page calculates received − paid operating expenses − supplier payments − raw fleet fuel − raw maintenance. Migration 022 now creates draft expenses for fleet costs, which enter paid operating expenses when paid. That same paid fuel/maintenance is therefore subtracted twice. Unpaid/scheduled fleet costs are also included as if cash outflows.

Fix the report to derive cash solely from authoritative cash events; show recorded/estimated fleet costs separately. Date semantics also differ: payment creation vs confirmation date, expense date vs paid date, maintenance scheduled vs completed date. “Net cash movement” is not profit.

Evidence: [apps/admin-web/src/app/dashboard/reports/page.tsx:13](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/apps/admin-web/src/app/dashboard/reports/page.tsx:13); [services/waste-service/src/repositories/report.repository.ts](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/waste-service/src/repositories/report.repository.ts); [infrastructure/database/022_fleet_expense_links.sql](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/infrastructure/database/022_fleet_expense_links.sql). This is a regression risk introduced by the recent finance linkage and must be corrected before the stakeholder finance demo.

### F06 — P1: customer ownership follows mutable location assignment

Customer profile has one global user identity, no independent organization service relationship. Company customer lists use the primary location's organization. A citizen moving their location can be rematched to another company. KCCA reassigning a zone mass-updates all customer locations in that zone, but leaves users, contracts, subscriptions, invoices, schedules and jobs with their former organizations.

That can move CRM visibility while historical contracts remain elsewhere and can break contract activation, whose join requires the current location organization to match the contract. Automatic zone selection also picks the nearest candidate even outside all boundaries.

Create an explicit customer-service relationship with tenant ownership and effective dates. Regulatory zone reassignment must not automatically transfer private customer contracts, debt or employee/user membership.

Evidence: [services/waste-service/src/repositories/customer-service.repository.ts](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/waste-service/src/repositories/customer-service.repository.ts); [services/waste-service/src/repositories/waste.repository.ts:119](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/waste-service/src/repositories/waste.repository.ts:119); [services/auth-service/src/repositories/organization-user.repository.ts](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/auth-service/src/repositories/organization-user.repository.ts).

### F07 — P1: demo collection chain stops at zones, not customers

collection_jobs has zone/truck/driver/schedule, but no customer_id, service_location_id, contract_id, service item or responsible supervisor. Generation makes one job per schedule/date. Driver routing uses zone centers. Customer overview queries all jobs in the primary zone for both history and next collection.

Do not present this as household proof of service. Preserve area-sweep jobs if needed, but distinguish them from customer pickups. Add service-plan → customer-location stops, schedule recurrence and fulfillment records, then derive customer history from actual fulfilled stops.

Evidence: [infrastructure/database/003_waste_operations_schema.sql](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/infrastructure/database/003_waste_operations_schema.sql); [services/waste-service/src/repositories/waste.repository.ts:476](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/waste-service/src/repositories/waste.repository.ts:476); [services/waste-service/src/repositories/customer-service.repository.ts](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/waste-service/src/repositories/customer-service.repository.ts); [services/waste-service/src/repositories/route-execution.repository.ts](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/waste-service/src/repositories/route-execution.repository.ts).

### F08 — P1: duplicate and contradictory operational states

- Generation checks existence then inserts, without a unique schedule/date constraint or atomic generation transaction. Concurrent calls can duplicate jobs; an error can leave partial generation.
- Monthly schedules use fixed day stepping rather than calendar recurrence.
- Route creation associates jobs but does not enforce driver/truck agreement with the jobs, one active route per job, matching service date or runnable status.
- Direct job completion and route-stop completion are separate pathways. Completing a job directly does not necessarily complete its route stop.
- Driver arrival updates a job only if pending/assigned; stop completion later sets the job completed unconditionally. A cancelled job can therefore be contradicted by a route stop.
- Truck/driver availability is not reserved/released consistently with assignments; assigning unavailable resources is not reliably prevented.
- Route completion checks pending stops without serializing the entire route; parallel stop completions need a race test.

Evidence: [services/waste-service/src/repositories/waste.repository.ts:398](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/waste-service/src/repositories/waste.repository.ts:398); [services/waste-service/src/repositories/waste.repository.ts:579](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/waste-service/src/repositories/waste.repository.ts:579); [services/waste-service/src/repositories/waste.repository.ts:744](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/waste-service/src/repositories/waste.repository.ts:744); [services/waste-service/src/repositories/route-execution.repository.ts](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/waste-service/src/repositories/route-execution.repository.ts).

### F09 — P1: supervisor team assignment does not restrict visibility

supervisor_drivers is written and displayed through Auth, but operational repositories do not use it to scope routes/jobs/incidents. Supervisors receive organization-wide access and several finance views. The UI statement that assigned teams define monitoring responsibility is stronger than the actual enforcement.

Use assigned team/zone scope for normal supervisor operations; make organization-wide oversight a separate permission. Give supervisors a focused queue for missed pickups, incidents, stalled routes and vehicle problems.

Evidence: [services/auth-service/src/repositories/organization-user.repository.ts](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/auth-service/src/repositories/organization-user.repository.ts); [apps/admin-web/src/app/dashboard/team/page.tsx:99](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/apps/admin-web/src/app/dashboard/team/page.tsx:99); [services/waste-service/src/controllers/route-execution.controller.ts](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/waste-service/src/controllers/route-execution.controller.ts).

### F10 — P1: inventory movement SQL is currently broken (database verified)

recordMovement supplies [itemId, org, user, delta], but SQL references $1, $2 and $4 only. PostgreSQL cannot infer $3. The exact statement's PREPARE failed with 42P18 during this audit; no UPDATE was executed. Fix the parameter list and add a real repository/database test before demonstrating receipts/issues.

Separately, purchase requests can be marked received via the request endpoint without a linked order/stock receipt. Purchase-order receipt creates stock only for linked requests; standalone receipt deliberately asks the user to record stock manually. Keep these paths clearly distinct.

Evidence: [recordMovement and changeRequest](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/waste-service/src/repositories/inventory.repository.ts); [services/waste-service/src/repositories/procurement.repository.ts](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/waste-service/src/repositories/procurement.repository.ts).

### F11 — P1: cash controls are not a complete accounting architecture

Positive: expense, payroll, PO and supplier-payment mutations use organization finance locks and funding checks. Cash, commitments and receivables are separate concepts.

Remaining defects/risks:

- Without a saved opening setting, CURRENT_DATE is the fallback baseline: yesterday's transactions disappear from today's derived cash.
- Opening amount/date can be overwritten without an adjustment history, reconciliation or the shared finance lock.
- Changing the date to today does not exclude earlier payments on that same date. Earlier advice to treat that as a way to set today's balance was incomplete; an opening amount is a baseline before included transactions.
- Supplier payment paid_on is user-controlled; a date before the baseline can reduce a bill without reducing calculated cash. There is no closed-period/date policy.
- Payroll saveLine does not lock the period or take the approval lock. A concurrent edit can race approval/payment. Period-overlap validation is check-then-insert, not an exclusion constraint.
- Bills are rejected merely because cash is insufficient, although a valid received supplier liability still needs to be recorded. Under a strict cash-budget policy, reserve before purchase; do not hide an incurred liability at invoice entry.
- Duplicate linked supplier bills are not prevented by a unique purchase-order constraint; duplicate payment references are not uniformly constrained.
- No bank/cash account ledger, debit/credit postings, refunds, reversals, journal approval, reconciliation or immutable statements.

Evidence: [infrastructure/database/021_financial_controls.sql](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/infrastructure/database/021_financial_controls.sql); [services/waste-service/src/repositories/expense.repository.ts](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/waste-service/src/repositories/expense.repository.ts); [services/auth-service/src/repositories/payroll.repository.ts](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/auth-service/src/repositories/payroll.repository.ts); [services/waste-service/src/repositories/payables.repository.ts](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/waste-service/src/repositories/payables.repository.ts).

### F12 — P1: contract, subscription and billing lifecycle diverge

Contract expiry is updated on GET, but subscription status is not expired/cancelled with it. Due-invoice generation checks active subscriptions, not contract validity, so expired contracts can continue billing. Independent subscription suspension/resumption can disagree with the contract or customer service status.

Contract value uses 30/90/365-day approximations while recurrence uses calendar intervals. For example, a 31-day monthly term can be valued as two periods. Activation does not consistently prevent expired/future-dated activation or recheck a package deactivated after drafting. Generation advances from max(due date, today), so missed periods and proration lack a defined policy.

Preserve package-selected pricing and package immutability when used, but create one contract/service entitlement lifecycle and explicit calendar-period billing rules.

Evidence: [services/waste-service/src/repositories/contract.repository.ts](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/waste-service/src/repositories/contract.repository.ts); [services/waste-service/src/repositories/billing.repository.ts](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/waste-service/src/repositories/billing.repository.ts).

### F13 — P1: company onboarding cannot be completed through the normal platform UI

Organization service exposes create/list/detail only. Creating an organization does not invite/create its administrator. Auth staff APIs require an existing company_admin and cannot create that role. Development seeding is not production onboarding. Organization editing, enable/disable lifecycle, configuration and branches have no complete admin workflow.

Evidence: [services/organization-service/src/routes/organization.routes.ts](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/organization-service/src/routes/organization.routes.ts); [services/auth-service/src/routes/organization-user.routes.ts](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/auth-service/src/routes/organization-user.routes.ts); [services/auth-service/scripts/seed-role-accounts.ts](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/auth-service/scripts/seed-role-accounts.ts).

### F14 — P1/P2: audit, session and deployment foundations

No durable business audit-event table, role-change history, opening adjustment log or regulatory access log was found. created_by/approved_by and Morgan are useful but insufficient. User tokens live in sessionStorage (useful tab testing, accessible to script). Refresh tokens are issued/stored but no refresh/revoke endpoint exists. No rate-limit, MFA or password recovery flow was found. /me verifies JWT but does not itself reject an inactive account; most protected service routes do recheck active users.

Public registration accepts organizationId while always assigning citizen. That is not direct admin escalation, but it allows unapproved membership association and should be replaced by verified invitations/customer onboarding.

Development Compose uses static credentials and exposes DB/cache ports. Do not use that setup unchanged for deployment. Waste error responses return raw exception messages, including SQL details. No automated migration runner, full CI pipeline or reproducible multi-service test setup was found.

Evidence: [services/auth-service/src/services/auth.service.ts](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/auth-service/src/services/auth.service.ts); [services/auth-service/src/routes/auth.routes.ts](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/auth-service/src/routes/auth.routes.ts); [apps/admin-web/src/lib/api.ts](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/apps/admin-web/src/lib/api.ts); [services/waste-service/src/app.ts](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/waste-service/src/app.ts); [infrastructure/docker/docker-compose.yml](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/infrastructure/docker/docker-compose.yml); [infrastructure/database/init.sql](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/infrastructure/database/init.sql).

### F15 — P2: frontend workflow and accessibility inconsistencies remain

- FleetPage does not wrap itself in AppShell; RootLayout does not provide AppShell either. Shared navigation/context is therefore missing on this route.
- Fleet reads sessionStorage in a state initializer with a server false/client role branch: hydration risk remains.
- Shared pagination is client-side; many APIs fetch entire tables, while some silently cap history at 100. A paginated table does not imply full server-pagination support.
- Reports daily table and fleet records use separate layouts; company/fleet still contain large rounded cards/green styling inconsistent with the newer minimal blue table patterns.
- Supervisor “back to organization overview” points to a page which requests company-admin-only staff data.
- Disabled actions have improved visible funding feedback, but validation, error placement inside modals, stale cross-tab state, focus behavior and accessible labels need a browser pass.
- “Live” dashboards are snapshots; no general polling/SSE/WebSocket transport was found.

Evidence: [apps/admin-web/src/app/dashboard/fleet/page.tsx](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/apps/admin-web/src/app/dashboard/fleet/page.tsx); [apps/admin-web/src/components/ui/Pagination.tsx](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/apps/admin-web/src/components/ui/Pagination.tsx); [apps/admin-web/src/components/layout/OrganizationWorkspaceNav.tsx](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/apps/admin-web/src/components/layout/OrganizationWorkspaceNav.tsx); [apps/admin-web/src/app/dashboard/company/page.tsx](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/apps/admin-web/src/app/dashboard/company/page.tsx).

### F16 — P2: customer/driver proofs, notifications and maps are incomplete

Driver completion UI submits weight and notes, not evidenceUrl. Backend accepts a URL but there is no demonstrated protected upload flow. Weight/evidence are optional, no signature/customer confirmation or GPS capture is required, and completed routes/jobs are excluded from normal driver lists. Stops support “skipped” in DB but no skip endpoint exists, so an inaccessible stop can block sequential execution.

The map uses zone markers and polylines, not editable/rendered official zone polygons or live vehicle positions. current_location exists but no ingestion/history/freshness pipeline was found. OSRM provides road geometry for supplied order, not capacity/time-window route optimization. Notifications/directives, expiry reminders, scheduled reports and a delivery worker are missing.

Evidence: [apps/admin-web/src/app/dashboard/driver-mobile/page.tsx:250](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/apps/admin-web/src/app/dashboard/driver-mobile/page.tsx:250); [services/waste-service/src/validators/route-execution.validator.ts](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/waste-service/src/validators/route-execution.validator.ts); [services/waste-service/src/repositories/route-execution.repository.ts](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/waste-service/src/repositories/route-execution.repository.ts); [apps/admin-web/src/components/gis/WasteMap.tsx](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/apps/admin-web/src/components/gis/WasteMap.tsx).

## 5. API and tenant boundary conclusions

Keep the existing successful pattern: authenticated user identity is reloaded from DB in Waste/Organization, ordinary company requests generally force the current organization, child references are checked for many creation flows, and driver job access commonly joins drivers.user_id.

However, tenant protection is not comprehensive:

| Resource group | Existing boundary | Audit conclusion |
|---|---|---|
| Organization list/detail | Own org for company/supervisor, global city/platform | Valid pattern for linked company; fail closed for unlinked supervisor |
| Customers | Primary location organization; citizen own user | Mutable ownership model; not a stable tenant CRM relationship |
| Staff/attendance/payroll | Company admin + current DB organization | Better scoped; profile/login conflation and financial concurrency remain |
| Drivers/trucks | Many own-org filters | Availability and user/role alignment incomplete; system/global writes need explicit cross-reference validation |
| Zones | One owner organization; city assignment | Not a versioned license/assignment model; reassignment transfers location visibility |
| Schedules/jobs/routes | Org filter + selected resource validation | No customer relationship; null bypass and lifecycle/assignment inconsistencies |
| Driver route stops | Parent driver ownership | Useful check; cannot compensate for cross-tenant/mismatched route-job relationships inserted elsewhere |
| Contracts/invoices/payments | Org predicates or customer self joins | KCCA disclosure; lifecycle and over-credit issues |
| Expenses/suppliers/procurement | Org predicates; finance locks on key writes | KCCA disclosure; no complete reference/deduplication/ledger guarantees |
| Reports/documents | Org/global reads | No private/regulatory projection separation; file URL is not a protected document system |

Do not claim “all endpoints safe” until a tenant A/B + customer/driver ownership suite passes against the gateway and directly against the services. Authorization must remain effective even if the gateway is bypassed.

## 6. E — Recommended architecture

    WMS PLATFORM
    ├── Platform Super Admin
    ├── KCCA Regulatory Control Room
    ├── Waste Collection Organizations
    │   ├── Administration / Membership / Configuration
    │   ├── Operations / Customer pickups / Dispatch
    │   ├── Customers / Contracts / Service entitlements
    │   ├── Staff profiles / Supervisor teams
    │   ├── Finance / Billing / Procurement
    │   ├── Fleet / Maintenance / Fuel
    │   └── Private Reporting
    ├── Driver Workspace (assigned work only)
    ├── Supervisor Workspace (assigned team/zone scope)
    ├── Customer Workspace (own service and payments)
    ├── Recycler / Processor / Buyer Workspace
    ├── WMS Payment Platform
    └── Shared identity, audit, files, notifications, configuration

### MVP deployment boundaries

Keep the gateway, Auth, Organization and Waste deployments initially. Establish module-owned repositories and explicit service interfaces before extracting more services.

- Auth owns identity, sessions and effective permission resolution—not customer creation SQL and payroll business posting long-term.
- Organization owns membership, tenant configuration, organization types/lifecycle and invitations.
- Operations owns zones/assignments, schedules, jobs, trips, route stops, proofs and operational exceptions.
- Fleet and Customer modules can remain inside the business deployment during the MVP, with clear ownership and transaction boundaries.
- Finance owns invoices, obligations, commitments and postings. Do not let Auth and arbitrary triggers become permanent finance owners.
- Payment is the first strong later extraction candidate: external callbacks, retries, secrets and reconciliation have distinct security/reliability needs.
- Notifications/reporting can begin as modules plus workers/read projections; extract only when load, ownership or independent delivery justifies it.
- Use a transactional outbox for reliable event delivery, not uncoordinated HTTP calls in the middle of local transactions.

Database-enforced invariants (unique source expense, tenant-aware FK constraints, valid money values) should remain. Cross-domain business orchestration should be testable and observable; document migration 022's trigger until replaced deliberately.

### Core target entities

| Domain | Recommended additions / corrections |
|---|---|
| Identity | users, organization_memberships, roles(scope, organization_id), permissions(module, action), scoped role assignments, sessions |
| Organization | organization_types, branches/depots, module enablement, typed settings, invitations, organization-scoped catalogs |
| Regulatory geography | official_zones, versioned boundaries, zone_assignments with validity/licenses, internal operational_areas referencing official zones |
| CRM | customers separate from optional app account; organization_customer_relationships; service_locations; bins/containers; documents |
| Service | contract versions, package snapshots, service entitlements, calendar recurrence, customer-location schedule items |
| Operations | customer pickup jobs, route/trip assignment, stop execution, proof metadata, missed/rejected reasons, waste observations |
| Workforce | employees with optional user link, departments/positions, supervisor assignments; later contracts/leave/performance |
| Fleet | vehicle master separate from current operational state, maintenance orders, fuel records, GPS samples/device identities |
| Finance | cash accounts, invoices/lines, liabilities, commitments, immutable adjustments/reversals; later chart/journal/journal_lines |
| Regulatory sharing | purpose-limited operational projections, submitted reports, compliance cases, directives and acknowledgements |
| Recycler | recycler profile, material taxonomy, demand, offers/orders, quality specs, batches and custody/transfer events |
| Platform | audit_events, notification outbox/delivery, file metadata/access policy, integrations and feature flags |

Use composite tenant ownership constraints where both parent and child belong to a tenant; require tenant IDs on private business rows. RLS may provide defense in depth once transaction-local tenant context is implemented correctly, but it does not replace endpoint authorization.

### Configurability without unsafe state machines

Make roles, catalogs, service types, customer categories, branches, working hours, provider availability and business settings data-driven. Keep invariant lifecycle transitions and permission semantics validated in code. “Avoid hard-coding” should not mean allowing arbitrary status strings to bypass financial or operational state machines.

### WMS Payment Platform design

Customer creates a WMS payment intent for an authorized invoice → WMS persists intent/attempt and idempotency key → provider adapter initiates collection → authenticated provider webhook is durably recorded → reconciliation/posting service allocates payment → receipt and organization balance update → settlement tracking.

Provider/bank/mobile money is the external rail, not an implied recipient after the organization. Organization is the beneficiary. Distinguish payment initiation, provider success, invoice allocation, cash recognition and settlement.

Model payment_intents, payment_attempts, provider_transactions, webhook_events, allocations, refunds, receipts, fee entries and settlements with amount in minor units, currency, tenant, customer/invoice references and immutable provider references. Support pending/processing/successful/failed/cancelled/refunded with explicit transitions; partial refund amounts need separate records, not a destructive status overwrite.

Use provider-scoped unique event/reference keys, request idempotency, signature verification, retries/dead-letter handling and reconciliation before relying on automated success. Never store card credentials; use provider-hosted/tokenized methods and server-side secret storage. Platform fees need separate gross/fee/net entries and settlement accounting, not a deduction hidden in invoice balance.

The existing adapter is a useful starting interface, **not a working WMS payment gateway**. Provider onboarding, custody/settlement responsibilities and regulatory requirements require a separate readiness review before real-money launch.

## 7. F — Proposed data ownership matrix

“Organization” means authorized members of the owning tenant, not every employee. “WMS Admin” below is not automatic private-data access; support access requires explicit purpose, approval and audit.

| Data | Organization | KCCA | Recycler | Customer | WMS Admin |
|---|---|---|---|---|---|
| Company public/license profile | Maintain allowed fields | License/approve/regulate | Public fields | Public fields | Platform lifecycle |
| Official zones/licenses | Assigned scope, read | Own/manage | Public/permitted scope | Relevant service zone | Technical administration |
| Internal branches/areas | Own/manage | Designated coverage only | None | None | Audited support only |
| CRM contacts/addresses | Own service relationships | Minimum authorized incident/coverage data | None without fulfillment need/consent | Own profile | Audited support only |
| Contracts/prices/invoices | Authorized customer/finance staff | No default access | Own trading contracts only | Own agreements/bills | Audited support only |
| Staff/HR/payroll | HR/finance-granted scope | None by default | Own employees in own tenant | None | Audited support only |
| Cash, expenses, journals, bank references | Finance-granted scope | None by default | Own finance only | Own receipt/payment data | Restricted payment ops/support |
| Jobs/stops/proof | Assigned org/team scope | Designated compliance evidence | Own handoff evidence | Own pickup proof/status | Audited troubleshooting |
| Vehicle location/history | Own fleet and authorized team | Only permitted operational projection | Own fleet/handoff ETA | Relevant ETA, not full tracking | Audited support only |
| Documents | Entity-specific permission | Explicit compliance submissions | Own documents | Own shared documents | Audited support only |
| Complaints/incidents | Assigned cases | Regulatory case scope | Own cases only | Own cases | Audited support |
| Reports | Private detailed reports | Submitted/regulatory projections | Own operational reports | Own statements | Platform aggregates, not blanket financial detail |
| Recycler demand/material offers | Own published offers/fulfillment | Designated waste-flow compliance | Own/manage; eligible offers | Public listings if enabled | Marketplace administration |
| Audit events | Own authorized audit view | Own actions/submissions | Own tenant scope | Own activity where appropriate | Security audit, privacy-filtered |
| Provider credentials | No raw secrets in UI | None | None | None | Dedicated integration secret-management permission |

## 8. G — Recommended roles and permissions

These are initial **database-seeded templates**, not hard-coded frontend roles. Custom roles can combine permitted actions, constrained by tenant and assignment scope.

| Role template | Administration/people | Operations/fleet | Customers/contracts | Finance | Visibility |
|---|---|---|---|---|---|
| Organization admin | Manage own settings, invite users, assign allowed permissions | Manage | Manage | Configurable grant; no automatic secret exposure | Own tenant |
| General manager | Read business metrics; delegated settings | Oversee | Oversee | Reports/budget approval if granted | Own tenant |
| Operations manager | Team assignments, no salary access | Plan, dispatch, resolve exceptions | Service eligibility read | Submit operating costs, no default payment approval | Own operations |
| Supervisor | Read assigned staff | Assigned drivers/routes/zones, acknowledge/escalate | Assigned service-location details | Submit cost only if granted | Assigned teams/areas |
| Driver | Own profile | Own jobs, execution, proof, incidents | Minimum assigned-stop contact | None | Own assignments |
| Finance/accountant | No role grants | Operational evidence read as needed | Bills/contracts relevant to finance | Invoice, reconcile, record payment, reports; separate approve/pay permissions | Own tenant finance |
| HR | Employee profiles/attendance/leave | Staffing availability | None | Prepare payroll; payment approval separately granted | Own workforce |
| Technician | Own assigned work | Maintenance orders/parts/fuel evidence | None | Submit cost, not mark paid | Assigned vehicles/work |
| Customer service | No global user grants | Track customer jobs, request reschedule | Manage own-tenant CRM/cases; contract drafting if granted | Read permitted invoice status | Own-tenant customers |
| Customer | Own allowed profile | Own pickup status/requests | Own contract | Own invoices/payment initiation/receipts | Self |
| KCCA regulator | Licensed companies/official assignments | Regulatory read/directives | Minimum designated cases | No private accounting | Regulatory projection |
| Recycler operator | Own recycler settings/team | Demand, materials, fulfillment | Own trade partners | Own invoices/settlements | Recycler tenant |
| Platform admin | Platform organization/module lifecycle | Platform health | No default private CRM | Provider config/platform fees via separate privilege | Platform control plane |

Example permission codes: organization.settings.update, membership.invite, role.assign, dispatch.plan, job.assign, job.execute, proof.upload, fleet.maintenance.manage, expense.submit, expense.approve, expense.pay, payroll.prepare, payroll.approve, payroll.pay, report.private.read, regulatory.coverage.read, directive.issue, payment.reconcile.

Backend evaluation: active identity + active membership + enabled module + permission + resource ownership + assignment scope + valid transition. Frontend consumes effective permissions and context only for presentation. Role assignment must prohibit granting permissions the delegating admin is not allowed to delegate.

## 9. H — Prioritized implementation roadmap

Each phase should ship exact source paths, migrations, endpoints, frontend routes and acceptance evidence. The following is a plan, not an implementation performed in this audit.

| Phase | Closely related work | Release gate |
|---|---|---|
| 0 — Contain current defects | F01/F02 private-data and null-scope controls; payment over-credit; report double count; inventory SQL; stable opening/date policy | No known private-data disclosure or money corruption in demo paths |
| 1 — Tenant + RBAC foundation | Membership, tenant-safe repository scopes, permission guards, organization activity, audit spine, A/B fixtures | Gateway AND direct-service negative ownership tests pass |
| 2 — Organization administration | Company lifecycle + first-admin invitation, staff profiles/login separation, role templates, core catalogs/settings | KCCA can create A; A admin independently configures staff/customers |
| 3 — Customer-specific planning | Official zone assignments separated from company areas; customer service relation; calendar schedules → customer-location jobs | Company A jobs correspond to eligible customers only |
| 4 — Dispatch + driver + supervisor | Assignment invariants; one execution state machine; proof upload; missed/rejected/reschedule; assigned-team monitor | One completed and one failed pickup demonstrated without contradictory states |
| 5 — KCCA integration/control room | Regulatory projections, city/division/zone drilldown, directives/acknowledgements, report submissions | Operational visibility works; private finance/HR remain denied |
| 6 — Reporting + notifications | Correct metrics/dates, dimensional filters, server pagination, CSV; in-app inbox and reliable event worker | Job changes update authorized dashboards and produce traceable notifications |
| 7 — Billing stabilization + payment sandbox | Contract/subscription consistency, immutable invoice period identity, intent/idempotency/webhooks/reconciliation/receipts | Invoice → verified sandbox payment → one receipt/allocation; duplicate callback harmless |
| 8 — Recycler MVP | Separate recycler actor, demand, recoverable materials, custody-linked supply offers and order acceptance | Recycler demand demo with no collector-private-data access |
| 9 — Advanced finance, HR and fleet | COA/journals/GL and statements; HR lifecycle; telematics, maintenance/fuel analytics | Domain-specific controls and performance/security acceptance |

Existing billing/fleet screens are retained throughout. Moving basic money safety to Phase 0 does not mean implementing full accounting before operations. Add real-money provider execution only after the security and reconciliation gates.

### Recommended next implementation session

Start with **Phase 0/1 access-boundary repair**, not another dashboard:

1. One shared, explicit tenant/self/regulatory scope contract; reject missing tenant for every tenant role.
2. Remove KCCA access to private expenses/billing/contracts/procurement/payables/workforce; expose only permitted operations summaries.
3. Require active organization membership; keep system_admin access explicit and auditable.
4. Add a two-tenant endpoint test suite for reads, writes, child IDs, driver ownership, supervisor assignment, and KCCA denied private data.
5. In the same stabilization milestone, repair inventory SQL and the payment/report defects. Do not broaden feature scope until the regressions are covered.

## 10. Demo-ready E2E acceptance plan

Do this in an isolated staging database with explicitly approved fixtures. This audit did not create Company B, credentials, transactions or jobs.

| Step | Action | Required observed result |
|---|---|---|
| 1 | Platform/KCCA creates and approves Waste Company A; invites first admin | A becomes independently usable; lifecycle/audit event exists |
| 2 | KCCA assigns official Makindye zone | Effective-dated assignment visible to A; no historical customer/debt transfer |
| 3 | A admin creates roles, supervisor, driver, technician/customer-service staff; assigns permissions | Each can see only intended modules; employee may exist without login |
| 4 | A creates two customers/locations and package-linked contracts | Service relationship, zone and recurrence explicit; A/B data separated |
| 5 | Operations creates schedule and generates jobs twice/concurrently | Exactly one pickup per eligible location/occurrence; duplicates prevented |
| 6 | Assign truck/driver/supervisor/route | Unavailable or other-tenant resources rejected; assignments consistent |
| 7 | Driver starts route, arrives and completes first stop with required proof/weight | Own-only route; timestamps, GPS/evidence ownership and fulfillment persisted |
| 8 | Driver reports a missed/rejected second stop | Reason recorded; route can progress according to policy; supervisor can resolve/escalate |
| 9 | Supervisor monitors | Assigned team only; timely updates; no private payroll/finance |
| 10 | Customer views service | Own stop history/proof, not all jobs in zone; own complaint/reschedule request |
| 11 | Invoice generated and paid through verified sandbox adapter | Amount/package period match; webhook authenticated; one allocation/receipt despite retries |
| 12 | Company reports refresh | Operational totals match jobs; cash equals authoritative cash events; no fleet double-count |
| 13 | KCCA city → division → zone → company → route → job | Only designated regulatory projection; expense/payroll/private documents denied |
| 14 | Recycler publishes waste demand | Separate actor, own scope, demand visible only as designed; no fake claim of existing marketplace |

### Required negative tests

- Use A token against every B record ID and child reference: 403/404, no record mutation, no leaked identifiers/amounts.
- Unlinked/inactive company member and supervisor: denied before any unscoped repository call.
- Driver tries another driver's job/stop; supervisor tries an unassigned team: denied.
- KCCA calls private finance/payroll/contract/file endpoints: denied even when navigating directly.
- Company admin tries creating another organization or escalating to platform permissions: denied.
- Confirm two pending payments against one invoice: no over-credit; unique/idempotent outcome.
- Concurrent expense/payroll/order approvals competing for the same available balance: no over-commit.
- Concurrent payroll edit/approval and duplicate supplier reference across different invoices: no corruption.
- Contract expiry/suspension: generation and customer entitlement obey one defined policy.
- Job cancelled while route is active: route cannot silently complete it as collected.
- Broken provider/OSRM/upload service: useful recoverable error, no false success or partial financial posting.
- UI failure after successful POST: refresh safely; idempotency prevents duplicate business records.

## 11. What to preserve

Preserve SQL-backed org/customer registration foundations, bcrypt/JWT identity, common API client, scoped driver ownership joins, job/route execution timestamps, issue workflows, package-linked contracts, manual billing, finance commitment checks, PO-to-bill replacement concept, source-linked fleet drafts, shared table/pagination components, and OSRM abstraction.

These provide real value. Repair ownership and state transitions around them; do not discard them in a redesign.

## 12. Audit deliverables and implementation status

Added only:

- /Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/docs/WMS_ORGANIZATION_AUDIT_2026-09-03.md
- /Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/docs/WMS_API_AUDIT_2026-09-03.md

Application endpoints added/modified: **none**.
Frontend routes added/modified: **none**.
Database migrations applied during this audit: **none**.
Business records created/updated/deleted during this audit: **none**.

The existing [finance test guide](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/docs/FINANCE_TESTING.md) describes partial workflows, not proof of full accounting or platform readiness. Use this audit's release gates to decide what may honestly be demonstrated.
