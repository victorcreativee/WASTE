# WMS stabilization — Phase 0A
Date: 3 September 2026

## Continuation agreement

The user has confirmed that “done”, “next”, and equivalent continuation messages mean implement the next planned batch, with verification and testing instructions. Follow the [audit roadmap](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/docs/WMS_ORGANIZATION_AUDIT_2026-09-03.md). Do not interpret a continuation as permission to clear existing data, publish externally, or run real-money payments.

## Delivered

- Missing organization is rejected for company_admin, supervisor, driver and iot_operator at the Waste and Organization service guards.
- Active organization is checked against the database, not trusted from JWT/sessionStorage. Auth staff management, login and /me also enforce the organization check.
- Shared private-organization scope rejects null tenant, unknown roles and unauthenticated controller calls. Separate operational scope admits city-wide queries only for explicitly permitted KCCA/platform identities; driver scope retains organization and existing user filters.
- KCCA and system_admin can no longer read organization-private CRM, packages/billing, expenses, contracts, payables, procurement, inventory, detailed fleet records or combined financial/workforce reports.
- Existing company_admin/supervisor permissions are retained for this stabilization batch. This is NOT configurable RBAC, and supervisor assignment restrictions remain pending.
- Removed city navigation links to private CRM/billing. Organization-only readiness links are not shown to city users. Supervisor back-navigation now returns to the operational dashboard rather than company-admin-only overview.
- Pending payment confirmation locks the pending record, uses an organization finance transaction lock shared with manual receipts, rejects stale/nonpayable invoices and duplicate successful references, and updates the invoice and receipt atomically. No balance clamping.
- A rejected confirmation leaves both invoice and pending payment unchanged. Pending external attempts are not automatically cancelled or refunded; settlement/reconciliation is later work.
- Inventory receipt/issue UPDATE uses consecutive SQL parameter numbers; no unused $3 parameter.
- Reports subtract confirmed receipts minus paid expenses minus supplier payments. Fleet costs are informational, not an additional cash deduction.
- Reports use confirmation/payment dates; legacy records without those dates fall back to created/expense dates consistently with the existing cash-position calculation.

## API changes (existing paths preserved)

All paths below are gateway-visible paths. No new business API was introduced.

| Endpoints | Behavior change |
|---|---|
| All protected /api/waste and /api/organizations routes | Reject missing/inactive tenant context for existing organization roles |
| POST /api/auth/login; GET /api/auth/me; organization staff/payroll routes | Reject unavailable organization context; /me also rejects inactive user |
| GET /api/waste/billing/plans, /billing/overview | KCCA/system_admin denied; customers retain their self-scoped view |
| GET /api/waste/finance/expenses, /finance/payables | KCCA/system_admin denied |
| GET /api/waste/contracts, /inventory, /procurement, /customers | KCCA/system_admin denied |
| GET /api/waste/fleet/overview, /fleet/trucks/:truckId | KCCA/system_admin denied; basic regulatory truck listing remains available |
| GET /api/waste/reports/organization | Organization-private scope; corrected cash dates |
| PATCH /api/waste/billing/payments/:paymentId/confirm | Invalid/stale/duplicate/foreign confirmation returns 409; successful confirmation remains 200 |
| POST /api/waste/billing/payments/record | Shares finance lock with confirmation to serialize receipt/reference checks |
| POST /api/waste/inventory/items/:itemId/movements | Correct SQL execution; foreign item/insufficient stock remains 409 |

KCCA operational zones, basic vehicles, collection jobs and command center remain available under their existing route policies. There is no new privileged support override for private company data. A platform account needing legitimate support access must wait for explicit, audited access in the membership/RBAC phase.

Frontend routes changed: /dashboard/reports and /dashboard/driver-mobile; shared sidebar/back-navigation affects existing pages. No frontend route was added or removed.

Database migrations: **none required or applied**. No application business records were reset or repaired. Test fixtures were rolled back.

## Verification

- Waste tests: 28 passed (includes 10 new scope/role regression tests).
- Frontend tests: 7 passed (includes 3 cash-report regression tests).
- Real PostgreSQL and HTTP: 72 assertions passed using two temporary organizations, both company admins, supervisor, unlinked supervisor, two drivers, customer, KCCA and platform admin.
- Auth, Organization, Waste and frontend TypeScript checks passed; frontend lint passed.
- Whitespace validation: git diff --check passed.

The integration test uses the actual Express applications, authentication middleware, controllers, repositories and database schema. It starts temporary loopback HTTP servers. Repository transactions are represented by savepoints inside one outer rollback transaction. It does not contact a payment provider, create persistent login credentials, or export real customer records.

**Limits:** representative service-level ownership tests, not all 100 endpoints or a concurrent multi-session stress test. The running gateway forwarding path and browser UI were not exercised by this automated suite. This is not a claim that all audit security/finance findings are resolved.

## Repeat automated tests

Prerequisites: existing local PostgreSQL database with current migrations through 022, seeded roles, installed dependencies and each existing service environment configured. Do not run these tests against production. The integration runner rejects non-loopback database hosts and NODE_ENV=production.

Backend:
```sh
cd "/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/waste-service"
npm test
npm run typecheck
npm run test:stabilization
```

Expected: 28 unit tests pass; integration ends with “PASS: 72 stabilization assertions” and “All fixture records rolled back”. No manually running services are required for the integration test: it creates temporary HTTP servers using random ports.

Frontend:
```sh
cd "/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/apps/admin-web"
node --test tests/*.test.cjs
npm run lint
./node_modules/.bin/tsc --noEmit --incremental false
```

Auth and Organization type checks:
```sh
cd "/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/auth-service"
./node_modules/.bin/tsc --noEmit
cd "/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/organization-service"
./node_modules/.bin/tsc --noEmit
```

The root npm test remains the pre-existing placeholder; run the service commands above.

## Manual acceptance — use testing records only

Restart Auth, Organization and Waste services after these changes. Reload the frontend. If using production-built services, rebuild before npm start; source changes do not update old dist files automatically.

For development, run npm run dev in a separate terminal for each required directory:
- /Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/auth-service
- /Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/organization-service
- /Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/waste-service
- /Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/apps/api-gateway
- /Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/apps/admin-web

Use existing test accounts in separate tabs (sessions remain tab-scoped). Do not paste access tokens into shared logs.

| Step | Action | Expected result |
|---|---|---|
| 1 | Log in as KCCA. Open Control room, City operations and GIS coverage. | Existing operational pages remain accessible; no Revenue oversight or private Customers sidebar entry |
| 2 | While KCCA is logged in, directly open /dashboard/billing or /dashboard/reports. | API access denied; no private financial data returned. Hiding navigation alone is not the control |
| 3 | Log in as a company administrator. Open Inventory, Income & billing, Reports, and Fleet control. | Existing organization data remains accessible |
| 4 | On a test inventory item with zero stock, receive 10 units, issue 4, then try issuing 7. | Quantities become 10 then 6; last request blocked and quantity stays 6 |
| 5 | For a test invoice with balance UGX 10,000, customer initiates two pending payments of UGX 10,000 before either is confirmed. | Pending attempts may coexist; initiating an attempt does not count as successful income |
| 6 | Company administrator confirms the first attempt, then the second. | First succeeds and invoice balance becomes zero; second returns a clear conflict; only UGX 10,000 successful receipts recorded |
| 7 | Try confirming the same payment again or reusing its successful reference on another invoice in the same organization. | Conflict; no extra receipt and no invoice change |
| 8 | Log a test fleet cost, then approve/pay its linked expense using sufficient test funds. | Report cash movement subtracts that paid expense once, not again as a separate fleet cash cost |
| 9 | Select a report range containing payment day but excluding the earlier logged expense/payment-initiation day. | Paid expense/confirmed receipt appears on the cash date |
| 10 | Log in as supervisor; use Back to operations overview. | Returns to /dashboard, not the company-admin-only overview |
| 11 | Log in as driver and start an assigned job. | Own assigned job still works. Foreign job IDs are rejected |
| 12 | Run npm run test:stabilization for Company A/B and disabled-account scenarios. | Test automatically creates and rolls back fixtures; no need to edit real users/organizations manually |

Do not “correct” historical financial discrepancies by deleting records. The fixes prevent these specific future mistakes but do not silently reverse previously overcredited receipts or repair old contradictory data.

## Next batch — Phase 0B before completing Phase 1

1. Stabilize opening-balance cutoff (no moving CURRENT_DATE fallback), opening-balance history/change rules, and shared locking.
2. Close supplier backdating/cash-cutoff and payroll-edit-versus-approval races with integration tests.
3. Then introduce explicit organization memberships, permission-based module/action authorization and append-only audit events, with a safe migration from existing users/roles.
4. Expand negative tests across every module and through the gateway, including concurrent transaction tests.
5. Complete first-administrator onboarding, then customer-location collection planning and driver/supervisor execution.

Do not mark Phase 0 or Phase 1 fully complete based only on this batch. Remaining audit findings include supervisor team scoping, customer ownership changes, contract/subscription expiry divergence, real payment reconciliation and collection execution state consistency.

## Exact application and test files changed

- [services/auth-service/src/middlewares/auth.middleware.ts](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/auth-service/src/middlewares/auth.middleware.ts)
- [services/auth-service/src/services/auth.service.ts](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/auth-service/src/services/auth.service.ts)
- [services/auth-service/src/services/organization-access.service.ts](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/auth-service/src/services/organization-access.service.ts)
- [services/organization-service/src/middlewares/auth.middleware.ts](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/organization-service/src/middlewares/auth.middleware.ts)
- [services/waste-service/src/middlewares/auth.middleware.ts](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/waste-service/src/middlewares/auth.middleware.ts)
- [services/waste-service/src/middlewares/organization-scope.ts](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/waste-service/src/middlewares/organization-scope.ts)
- [services/waste-service/src/controllers/billing.controller.ts](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/waste-service/src/controllers/billing.controller.ts)
- [services/waste-service/src/controllers/expense.controller.ts](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/waste-service/src/controllers/expense.controller.ts)
- [services/waste-service/src/controllers/contract.controller.ts](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/waste-service/src/controllers/contract.controller.ts)
- [services/waste-service/src/controllers/payables.controller.ts](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/waste-service/src/controllers/payables.controller.ts)
- [services/waste-service/src/controllers/inventory.controller.ts](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/waste-service/src/controllers/inventory.controller.ts)
- [services/waste-service/src/controllers/procurement.controller.ts](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/waste-service/src/controllers/procurement.controller.ts)
- [services/waste-service/src/controllers/fleet.controller.ts](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/waste-service/src/controllers/fleet.controller.ts)
- [services/waste-service/src/controllers/report.controller.ts](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/waste-service/src/controllers/report.controller.ts)
- [services/waste-service/src/controllers/customer-service.controller.ts](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/waste-service/src/controllers/customer-service.controller.ts)
- [services/waste-service/src/controllers/waste.controller.ts](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/waste-service/src/controllers/waste.controller.ts)
- [services/waste-service/src/controllers/command-center.controller.ts](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/waste-service/src/controllers/command-center.controller.ts)
- [services/waste-service/src/routes/billing.routes.ts](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/waste-service/src/routes/billing.routes.ts)
- [services/waste-service/src/routes/expense.routes.ts](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/waste-service/src/routes/expense.routes.ts)
- [services/waste-service/src/routes/contract.routes.ts](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/waste-service/src/routes/contract.routes.ts)
- [services/waste-service/src/routes/payables.routes.ts](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/waste-service/src/routes/payables.routes.ts)
- [services/waste-service/src/routes/inventory.routes.ts](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/waste-service/src/routes/inventory.routes.ts)
- [services/waste-service/src/routes/procurement.routes.ts](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/waste-service/src/routes/procurement.routes.ts)
- [services/waste-service/src/routes/fleet.routes.ts](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/waste-service/src/routes/fleet.routes.ts)
- [services/waste-service/src/routes/report.routes.ts](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/waste-service/src/routes/report.routes.ts)
- [services/waste-service/src/routes/customer-service.routes.ts](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/waste-service/src/routes/customer-service.routes.ts)
- [services/waste-service/src/repositories/billing.repository.ts](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/waste-service/src/repositories/billing.repository.ts)
- [services/waste-service/src/repositories/inventory.repository.ts](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/waste-service/src/repositories/inventory.repository.ts)
- [services/waste-service/src/repositories/report.repository.ts](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/waste-service/src/repositories/report.repository.ts)
- [services/waste-service/package.json](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/waste-service/package.json)
- [services/waste-service/tests/organization-scope.test.ts](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/waste-service/tests/organization-scope.test.ts)
- [services/waste-service/scripts/test-stabilization.cjs](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/waste-service/scripts/test-stabilization.cjs)
- [apps/admin-web/src/app/dashboard/reports/page.tsx](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/apps/admin-web/src/app/dashboard/reports/page.tsx)
- [apps/admin-web/src/app/dashboard/driver-mobile/page.tsx](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/apps/admin-web/src/app/dashboard/driver-mobile/page.tsx)
- [apps/admin-web/src/components/layout/AppShell.tsx](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/apps/admin-web/src/components/layout/AppShell.tsx)
- [apps/admin-web/src/components/layout/OrganizationWorkspaceNav.tsx](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/apps/admin-web/src/components/layout/OrganizationWorkspaceNav.tsx)
- [apps/admin-web/src/lib/reporting.ts](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/apps/admin-web/src/lib/reporting.ts)
- [apps/admin-web/tests/reporting.test.cjs](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/apps/admin-web/tests/reporting.test.cjs)

Documentation added:
- [docs/STABILIZATION_PHASE_0A.md](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/docs/STABILIZATION_PHASE_0A.md)

The original audit documents remain the dated baseline, not a live claim that the now-fixed defects still exist.
