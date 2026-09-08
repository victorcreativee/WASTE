# Phase 3B — explicit customer–provider relationship foundation

Implemented and applied locally 4 September 2026. This establishes provider responsibility independently from the customer's editable address. It does not yet add a provider-transfer action.

## Delivered

- Migration 026 creates `customer_service_relationships` with customer, service location, organization, status, source, effective dates and lifecycle audit fields.
- Each service location can have only one current active or suspended provider relationship. Ended relationships can remain as history.
- Existing assigned locations were copied exactly as `legacy_backfill` relationships. No ownership value, identity, contract, subscription, invoice, payment or balance was changed.
- New customers created by a company receive an explicit `company_onboarding` relationship in the same transaction as their account and service location.
- Citizen address edits obtain provider responsibility from the current relationship, never from the legacy location organization or geographic proximity.
- Customer directory visibility and company service-status authorization now use the explicit relationship. Another provider cannot view or mutate it.
- Suspending or reactivating customer service updates the current relationship transactionally. Inactive service remains a suspended relationship because provider responsibility has not ended.
- Customer management presents Service area, Relationship and Planning check as a clear table workflow. Relationship status and effective date are visible without adding dashboard cards.

The legacy `customer_service_locations.organization_id` remains unchanged as a compatibility mirror for existing contract and billing code. It is no longer the authority for customer directory visibility or citizen address ownership.

## Migration and files

- `infrastructure/database/026_customer_service_relationships.sql`
- `services/waste-service/scripts/migrate-customer-relationships.cjs`
- `services/waste-service/src/repositories/customer-service.repository.ts`
- `services/auth-service/src/repositories/organization-user.repository.ts`
- `apps/admin-web/src/app/dashboard/customer-service/page.tsx`
- `services/waste-service/scripts/customer-ownership-tests.cjs`

Migration commands from `services/waste-service`:

```sh
npm run migrate:customer-relationships:check
npm run migrate:customer-relationships
```

The validation runs in a rollback transaction and snapshots financial row counts. It validated 2 existing assignments; application preserved both.

## Manual test guide

Restart Auth and Waste services after migration, then refresh the frontend. Use disposable test users and separate browser sessions for roles.

1. Sign in as a company administrator and open Customer management. Confirm every existing company customer has a Relationship value, status, provider and start date.
2. Search and paginate the table. Confirm Service area describes coverage, Relationship describes provider responsibility, and Planning check explains operational eligibility.
3. Add a disposable customer. Confirm the modal closes, clears and refreshes the table after success. The new row should have an active relationship sourced from the creating company; its zone may still require review when no company polygon covers the address.
4. Sign in as that citizen and change the address. Confirm the provider remains the same. Moving outside its polygon should change coverage/planning information, not the relationship.
5. As the original company, suspend service. Confirm both customer service and Relationship show suspended. Reactivate it and confirm both return to active.
6. Sign in as a different company administrator. Confirm the customer is absent and direct status mutation returns not found.
7. Review existing contracts, subscriptions, invoices and payments before and after these tests. Address and status operations must not transfer them to another company.
8. Do not attempt to model a provider transfer by editing the address, zone or database. A reviewed transfer workflow with explicit approvals and financial-history rules is the next phase.

Automated verification:

```sh
node -r ts-node/register/transpile-only scripts/test-stabilization.cjs --finance --access --onboarding --workspace --ownership
```

Result: 320 integration assertions passed against real local PostgreSQL and service HTTP; all fixture changes were rolled back. Waste, Auth and frontend TypeScript checks, frontend ESLint, 7 frontend tests and `git diff --check` passed.

## Deliberate limits and next work

- Existing unassigned citizens still need a reviewed linking flow; company staff cannot search arbitrary platform identities by email.
- Provider transfer is not exposed. It needs customer intent, source/target review rules, effective dates, coverage validation and clear handling of active contracts and balances. No financial history should ever be moved silently.
- Relationship history exists in the database but does not yet have a history drawer/page.
- Customer-specific pickup generation and proof of household service remain pending after relationship workflow completion.
