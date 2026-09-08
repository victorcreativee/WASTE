# Phase 3B — reviewed provider linking and transfer

Implemented and applied locally 4 September 2026. This is the controlled workflow built on migration 026's explicit customer–provider relationships.

## Workflow

### Customer without a provider

1. The customer saves a primary service address.
2. The system lists only active waste companies with an active polygon covering that address.
3. The customer submits one provider request.
4. The requested provider reviews and either accepts or rejects it.
5. Acceptance rechecks live coverage, creates an active `reviewed_link` relationship, updates the compatibility location fields and activates service.

### Customer changing provider

1. The customer chooses another covered provider and submits the request.
2. The current provider must review release first. The target cannot skip this step.
3. Release is blocked while the current company has a draft/active/expiring/suspended contract, a pending/active/suspended subscription, a non-zero unsettled invoice balance or a pending payment for the customer.
4. After those obligations are resolved, current-provider approval moves the request to the new provider.
5. The new provider accepts or rejects. Acceptance rechecks coverage and rechecks that no obligation or relationship changed during review.
6. Successful acceptance ends the previous relationship with its history intact and creates a `reviewed_transfer` relationship. Contracts, subscriptions, invoices and payments are never reassigned.

The customer may cancel either pending stage. Unrelated organizations receive not found and cannot discover or review another company's request.

## UI structure

- Customer Services has one clear Connect/Change service provider section with covered-provider selection and a compact request-history table.
- Customer Management places a Provider review queue above the existing searchable customer register.
- Review actions use plain Release, Accept and Reject language. Backend errors explain unresolved agreements, balances, payments or changed coverage.
- Contracts & service levels now exposes Cancel for draft or suspended contracts, allowing administrators to complete a legitimate release workflow. Active contracts must be suspended before cancellation.

## Migration and files

- `infrastructure/database/027_provider_relationship_requests.sql`
- `services/waste-service/scripts/migrate-provider-requests.cjs`
- `services/waste-service/src/repositories/provider-request.repository.ts`
- `services/waste-service/src/controllers/provider-request.controller.ts`
- `services/waste-service/src/routes/provider-request.routes.ts`
- `services/waste-service/src/validators/provider-request.validator.ts`
- `apps/admin-web/src/app/dashboard/customer-service/page.tsx`
- `apps/admin-web/src/app/dashboard/contracts/page.tsx`
- `services/waste-service/scripts/provider-request-tests.cjs`

Migration 027 was validated inside a rollback transaction and then applied locally. It adds request/audit records only; existing relationships and all financial records were unchanged.

## Existing endpoints added

Citizen:

- `GET /api/waste/customer-service/provider-options`
- `GET /api/waste/customer-service/provider-requests`
- `POST /api/waste/customer-service/provider-requests`
- `DELETE /api/waste/customer-service/provider-requests/:id`

Company administrator:

- `GET /api/waste/customers/provider-requests`
- `PATCH /api/waste/customers/provider-requests/:id` with `approve` or `reject`

## Manual testing guide

Restart Waste service and refresh the frontend. Use disposable customer/company records and separate browser sessions.

1. Create or use a citizen with a saved address but no provider. Confirm Connect a service provider lists only companies whose active boundary contains that address.
2. Submit a request. Confirm a second request is prevented and the request table says Awaiting new provider. Cancel it and confirm it cannot later be approved.
3. Submit again, sign in as an unrelated company administrator and confirm the request is absent. A direct review attempt must return not found.
4. Sign in as the requested provider. Open Customer management → Provider review queue and accept. Confirm the citizen now appears in that company's customer table with an active relationship.
5. As the citizen, request a different covered provider. Confirm the status says Awaiting current provider and the new provider has no available action yet.
6. As the current provider, try Release while an active/draft/suspended contract, open subscription, outstanding invoice or pending payment exists. Confirm the system blocks release and explains what must be resolved.
7. In Contracts & service levels, suspend an active contract, then cancel it. Resolve any legitimate outstanding invoice and pending payment through the existing finance workflow; do not delete or rewrite financial history. Retry Release.
8. As the target provider, deactivate/move the test coverage before acceptance and confirm acceptance is blocked. Restore valid coverage and accept.
9. Confirm the customer moves to the new provider's directory, the old relationship remains as ended history, and no old contract, subscription, invoice or payment changed organization.
10. Confirm Reject at either review stage ends the request without changing the current provider.

## Verification

- 337 full integration assertions passed against real local PostgreSQL and service HTTP.
- 89 focused provider-workflow assertions passed.
- All fixtures rolled back; no persistent test customer or finance data was created.
- Waste TypeScript, frontend TypeScript, ESLint, 7 frontend tests and `git diff --check` passed.

## Remaining work

- Relationship-history detail UI and optional reason capture in the company review dialog.
- Notification delivery for new review work; the queue currently updates on page load/action.
- Defined accounting policy for invoice write-offs/refunds where a transfer is legitimate but a balance cannot be paid normally.
- Customer-specific collection-stop generation and household proof of service remain the next core product phase.
