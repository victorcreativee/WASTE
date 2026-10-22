# KampalaWMS current-state audit

Audit date: 12 October 2026

This audit describes the repository as it exists. A module is called **working** only when source code contains a connected UI, API route, validation and database workflow. Runtime database migrations and environment health must still be verified before production release.

## A. Connected modules

- Authentication: registration, login, current identity, account status checks and refreshed database roles.
- Organization onboarding: applicant identity, permit application, evidence review, account approval and organization-administrator invitation.
- Organization access: memberships, organization roles, permission grants and immutable access audit events.
- Waste service setup: KCCA division authorization, zones/service areas, service routes and customer assignment.
- Daily collection: schedules/jobs, trip creation, vehicle/driver/supervisor assignment, driver route execution, customer stop outcomes and problem reporting.
- Fleet: vehicle register, readiness/status, documents, maintenance, fuel and live-location records.
- Customer operations: profiles, service locations, provider relationships, contracts, subscriptions, invoices and payments.
- Weighbridge: authorized workers, vehicle transactions, tare/gross completion, trip linking, voiding and organization-visible tonnage.
- Recycling trade: partners, material catalogue, purchasing, field location proof, sorting, stock adjustments, sales, partial payments, payment follow-up and daily closing.
- Operational finance: organization expenses, available-funds checks, supplier bills/payments, procurement, inventory, payroll and recycling cash-position calculations.
- Reporting: organization operating reports, KCCA collector performance, compliance and city command summaries.

## B. Partially working modules

- HR: staff accounts, attendance and payroll exist; employee contracts, leave, shifts, timesheets, documents, advances, performance and disciplinary workflows do not.
- Procurement/inventory: suppliers, requests, orders, receipt-to-stock, stock movement and payables exist; warehouse locations, transfers, reorder controls and formal stock valuation are incomplete.
- Accounting: operational cash, income, expenses, receivables, payables and payroll commitments are connected; double-entry journals, chart of accounts, ledger, trial balance, balance sheet, periods and tax are not implemented.
- Organization configuration: company contact settings and package/module access exist; branding, invoice/receipt configuration, multi-activity organization configuration and feature flags are incomplete.
- KCCA reporting: permits, assignments, collection results, weighbridge and compliance views exist; regulatory data-sharing policy and broader disposal/diversion aggregation require completion.
- Offline field operations: the mobile app stores its session, caches role-scoped reference data in SQLite, queues safe operational writes by user, replays them in order with idempotency keys, and exposes pending/conflict synchronization state. Financial settlement and administrative approvals intentionally remain online-only.

## C. UI-only or presentation-heavy areas

- Several dashboard summaries are projections over operational tables rather than a formal analytics store.
- Public homepage dashboard examples are explicitly illustrative sample data.
- Some navigation entries expose existing administrative screens before the deeper ERP workflow requested in the product brief exists.

## D. Missing APIs

- Full HR lifecycle: leave, employment contracts, shifts, timesheets, staff documents, advances and performance.
- General accounting: accounts, journals, posting periods, ledger, trial balance, P&L and balance sheet.
- Warehouses, bin/location stock, inter-warehouse transfers and stock valuation.
- Asset register beyond vehicles/inventory items.
- Organization branding, business document templates and multi-activity module configuration.
- Extend the shared idempotent offline contract only when additional role-specific mutations are approved for offline execution; keep settlement and access-control mutations online-only.
- Dynamic tenant/subdomain lookup and provisioning API.

## E. Missing or weak database relationships

- No broad PostgreSQL row-level-security policy framework currently exists. Tenant protection is primarily enforced by API scopes and organization predicates.
- Historical schemas contain nullable `organization_id` columns in core collection tables. New writes are scoped in the API, but production hardening should migrate valid rows and make ownership non-null where domain rules permit.
- Recycling child records previously referenced lots, sales and partners by ID alone. Migration `072_recycling_tenant_integrity.sql` adds preflight detection and composite `(record_id, organization_id)` foreign keys.
- Cross-tenant actor ownership (for example `created_by`) is not yet protected consistently by composite database constraints.

## F. Missing role and permission rules

- Organization membership permissions currently cover administration, staff, attendance, payroll and customers. Most waste-service modules still use coarse legacy roles such as `company_admin` and `supervisor`.
- The requested finance manager, accountant, cashier, HR, procurement, warehouse, fleet, customer-care, sales, auditor and crew roles are not fully represented as configurable permission bundles.
- Recycling field and sales roles are tenant-restricted. Migration `073_recycling_permissions.sql` now grants explicit read, purchasing, local-sales, industrial-sales, inventory, finance and daily-close permissions, and every recycling API route resolves those permissions from the user's active organization membership.

## G. Tenant-isolation risks

- The API refreshes current user, role, organization and membership state for protected operational requests, which avoids trusting stale organization claims.
- Private organization repositories generally use an explicit organization predicate.
- KCCA/system routes intentionally allow citywide scope, represented as a null operational filter. Every new endpoint must opt into this explicitly; null must never become an accidental default.
- Database-level protection is incomplete. Composite tenant foreign keys and later row-level security are required as defence in depth.
- There is no automated repository-wide integration suite that creates two organizations and proves every read/write endpoint cannot cross the boundary.

## H. Duplicated functionality

- Legacy global roles and new organization membership roles coexist as a compatibility bridge. Consolidation should be gradual; removing either now would break working access.
- Daily operations, trip monitoring and driver views show the same trip at different responsibility levels. They should share services and records, but remain separate role-focused screens.
- Recycling finance calculations are embedded in operational SQL functions while general finance has separate repositories. These need a shared accounting-posting layer, not another dashboard.

## I. Waste-collection workflow gaps

- The core setup-to-trip-to-driver-to-customer-outcome path exists.
- Electronic service receipts and customer history need a clearer end-to-end document workflow.
- Mobile Money confirmation needs a production provider integration and webhook reconciliation.
- Tipping/disposal, waste composition and landfill confirmation need completion around the existing weighbridge link.
- GPS navigation/tracking exists but requires production map/routing availability, retention rules and field-device testing.

## J. Recycling workflow gaps

- Purchasing, configurable materials, suppliers, GPS, stock, sorting, sales, payments and daily closure exist.
- Gross/tare/net field weighing, electronic receipt delivery, signatures and purchase photos require a complete persisted workflow.
- Warehouses, transfers, baling/processing stages, finished-goods lots and formal valuation are incomplete.
- Offline queueing and duplicate-safe synchronization are required before field use in unreliable connectivity.
- Accounting postings are calculated operationally rather than written as balanced journals.

## K. Finance and accounting gaps

- Current finance supports real operational balances and prevents some unfunded commitments.
- Missing double-entry foundations prevent calling it full accounting.
- Required sequence: chart of accounts -> journals/posting engine -> periods -> operational posting adapters -> ledger/trial balance -> P&L/balance sheet -> reconciliation and tax configuration.
- Existing operational tables should remain sources; finance adapters must prevent duplicate entry and use reversals/voids rather than destructive deletion.

## L. HR and ERP gaps

- Staff, attendance and payroll are the current HR baseline.
- Procurement and simple inventory are the current ERP baseline.
- HR lifecycle, warehouse topology, asset management and approval policies remain substantial work.

## M. Mobile status

- One Expo/React Native application exists under `apps/recycling-mobile`.
- It uses the platform authentication and APIs and selects driver, supervisor, recycling field or recycling sales experiences from the signed-in role.
- Android export/type checking has been validated in earlier work.
- Native store signing/distribution, iOS build verification, push notifications, background GPS and robust offline synchronization are not production-complete.

## N. Subdomain and multi-tenancy status

- Data tenancy exists through `organization_id`, authenticated memberships and scoped repositories.
- There is one shared deployment architecture, which is the correct basis for SaaS tenancy.
- Dynamic host-to-organization resolution, slug uniqueness, domain provisioning, tenant branding and host/identity mismatch rejection are not implemented end to end.
- The current production Nginx material is deployment groundwork, not complete automated tenant provisioning.

## Prioritized implementation sequence

1. **P0 — authentication, tenant isolation and permissions**
   - Add database tenant-integrity constraints to connected operational domains.
   - Add two-tenant endpoint integration tests.
   - Expand organization permission codes and move coarse route roles toward module/action permissions.
   - Introduce request-scoped database tenant context and row-level security incrementally, beginning with recycling and finance.
2. **P1 — organization and subdomain provisioning**
   - Add organization slug/configuration, host resolution, branding and module activation.
   - Reject authenticated host/organization mismatches and automate provisioning from approved applications.
3. **P2 — waste collection end to end**
   - Finish service receipts, tipping/disposal, mobile payment reconciliation and cross-role trip acceptance tests.
4. **P3 — recycling purchase and inventory**
   - Finish proof/receipt fields, warehouses, transfers, processing stages and valuation.
5. **P4 — mobile field operations**
   - Add an idempotent offline outbox/sync API, device registration and production field QA.
6. **P5 — finance integration**
   - Build the shared journal/posting engine and connect existing operational events once.
7. **P6 — HR and ERP**
   - Complete employee lifecycle, leave, shifts, timesheets, assets and advanced procurement.
8. **P7 — analytics and regulatory reporting**
   - Add reconciled operational/financial KPIs, regulatory sharing rules and scalable reporting projections.

## Work started from this audit

P0 database tenant integrity is the first implementation slice. Migration 072 prevents recycling sales, sorting, stock adjustments, partner links, payment follow-ups and payments from referencing another organization's parent records even if a future API defect omits its tenant predicate.

The rollback-only two-tenant HTTP/database suite now also proves that recycling workspaces exclude foreign lots and partners, foreign sales and partner mutations are rejected, and PostgreSQL independently rejects a deliberately attempted cross-tenant sale relationship. The shared stabilization fixtures were updated to respect current package entitlements and KCCA-controlled geography instead of bypassing those production rules.

The second P0 slice replaces recycling's broad route-role lists with organization permissions. Existing recycling-company administrators and supervisors retain full operational access; collectors receive read, purchase and approved local-sale actions; industrial sales staff receive read and industrial-sales actions. The migration backfills current accounts and provisions the same grants for future staff without leaking recycling permissions into waste-collection organizations.

The third P0 slice extends database tenant integrity into billing, inventory, procurement and accounts payable. Migration `074_finance_supply_tenant_integrity.sql` binds inventory movements to their organization's item, purchase orders to their request and supplier, supplier bills and payments to the same organization, and the subscription-to-invoice-to-payment chain to one customer and organization. A preflight check blocks the migration if any legacy cross-company relationship exists.

The fourth P0 slice binds recycling audit actors to their organization. Migration `075_recycling_actor_tenant_integrity.sql` prevents a user from another company being stored as the creator or recorder of a recycling purchase, sale, float movement, sorting batch, partner, stock adjustment, payment follow-up, payment, material-catalog entry or daily closure.

The fifth P0 slice applies the same actor boundary to finance and supply records. Migration `076_finance_supply_actor_integrity.sql` binds expense creators and approvers, inventory recorders, procurement requesters and approvers, purchase-order and supplier-bill creators, supplier-payment recorders, and finance-opening-balance editors to the organization owning each record.

The sixth P0 slice replaces coarse administrator/supervisor checks across finance, inventory, procurement and accounts payable with explicit organization permissions. Migration `077_finance_supply_permissions.sql` backfills current roles and keeps future role provisioning consistent; sensitive approval, opening-balance, procurement-management and supplier-payment actions are separate from read and data-entry access.

The seventh P0 slice separates citizen self-service billing from company billing administration. Migration `078_billing_permissions.sql` introduces distinct permissions for billing visibility, plan management, invoice generation, subscription management, payment recording and payment confirmation; citizen subscription and payment-initiation routes remain explicitly citizen-only.

The eighth P0 slice replaces coarse company-role checks for customers, contracts, fleet and organization reporting. Migration `079_company_operations_permissions.sql` separates read access from customer and contract management, vehicle management and fleet-alert review; it backfills existing organization roles and preserves the same grants for future administrators and supervisors. Citizen customer self-service, driver location reporting, and KCCA/system citywide fleet and collector reporting remain explicit role-scoped exceptions.

The customer-to-contract workflow now uses one guided sequence. Migration `080_customer_contract_workflow.sql` gives every existing and future customer a unique readable customer number, introduces controlled contract numbering and adds an overlap lookup index. Registration captures the account and mapped service location together, then links directly to a preselected contract form. Contract creation validates its date sequence, derives price and service levels exclusively from the selected package, and rejects overlapping live or draft agreements before activation creates the subscription and first invoice.

Customer service, contracts and billing now share one lifecycle. Suspending a customer's service also suspends the current contract and billing subscription; making the service inactive cancels them. Expired contracts close their linked subscriptions, future contracts cannot be activated early, and inactive customer relationships cannot activate billing. Expiring and expired agreements expose a renewal action that prepares a non-overlapping follow-on term using the same customer and service package. Customer and contract status changes are written to the organization audit trail.

Customer billing is now period-controlled. Migration `081_customer_billing_periods.sql` adds traceable service periods and controlled invoice numbering. Contract activation issues the first period, recurring generation catches up every due period without duplicating a subscription period, and generation stops at the contract end date. Invoice generation and confirmed receipts are audited; the billing workspace shows the customer number and billed service period.

Successful customer payments now receive immutable readable receipt numbers through migration `082_customer_payment_receipts.sql`. Company users and the paying customer can open the same tenant-scoped receipt from existing billing history and print it without introducing another sidebar destination.
