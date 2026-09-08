# Phase 1A — organization access foundation

Completed 3 September 2026. This is an incremental access-control foundation, not completion of the full organization platform or configurable RBAC.

## Delivered

- New **Access & permissions** sidebar page at `/dashboard/access`: searchable, server-paginated memberships; read-only role templates; server-paginated audit history with expandable change details.
- Separate organization membership status from user account status. Suspending membership blocks subsequent authenticated requests across Auth, Organization and Waste, including requests using an already-issued token.
- Company administrator memberships cannot be suspended through this endpoint, including another administrator in the same company. Self-suspension is also rejected.
- Tenant-scoped role bindings and administration permissions, checked alongside existing global-role guards. Cross-organization role bindings are rejected by composite database foreign keys.
- Actor-attributed audit events for membership/role changes, staff status, customer creation and supervisor team assignment. Audit payloads exclude password hashes and tokens; ordinary UPDATE/DELETE attempts are blocked.

## Database and deployment

`infrastructure/database/024_organization_access.sql` adds memberships, role templates, permissions, scoped assignments, audit events, effective-permission lookup and legacy-assignment synchronization triggers.

Migration 024 has been validated and applied to the local development database. It backfilled 3 memberships and 3 role templates. Validation compared identities, passwords and global roles before/after; they were preserved. No financial data or accounts were reset.

**On another environment, install migration 024 before deploying the new membership guards.** Missing membership tables will prevent authentication queries from working. Use the normal controlled migration process outside local development; the included runner rejects production and non-local hosts.

From `services/waste-service`:

```sh
npm run migrate:access:check
npm run migrate:access
npm run test:access
```

The check runs in a rollback transaction; the apply command commits. The migration is already installed locally. Restart **Auth, Organization and Waste services**, then reload the frontend. If serving compiled output, rebuild those services and the frontend first.

## API changes

New Auth endpoints:

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/api/auth/organization-access` | access.read |
| GET | `/api/auth/organization-access/memberships` | access.read |
| GET | `/api/auth/organization-access/audit` | audit.read |
| PATCH | `/api/auth/organization-access/memberships/:membershipId/status` | access.manage |

All retain company-admin authentication and tenant scoping. Lists accept bounded `page`/`pageSize`; membership search is supported. Existing staff, customer creation, team, attendance and payroll administration endpoints now also require their corresponding tenant permissions.

## Manual testing

1. Log in as a company administrator. Open **Access & permissions** in the sidebar. Confirm only that company's staff appear.
2. Search for a staff name/email. Change page size and move between pages when enough records exist. An unmatched search should show a helpful empty state.
3. Create a dedicated driver or supervisor through **Staff management**. Check that their organization membership appears automatically.
4. Log in as that staff member in a separate isolated session/tab. Keep the administrator session open.
5. As administrator, choose **Suspend** for the staff membership and confirm the dialog. Refresh or perform an authenticated action in the staff session: access should be denied. Logging in again should also fail while suspended.
6. Restore the membership. If the user account itself is active, login and the user's normal operational actions should work again. Restoring membership does not reactivate a suspended user account; check both columns.
7. Confirm administrators show a protected state rather than a suspension button. Direct attempts to suspend an administrator should return 409. An ID belonging to another company should return 404 without changing it.
8. Open **Audit history**. Review actor, action and before/after values for the changes. Create a customer or change a staff account status/team and check the resulting entries.
9. Open **Role templates**. These are intentionally read-only in this batch; operational roles do not acquire administrator permissions.
10. Log in as a different company administrator and confirm the first company's memberships/audit are unavailable. KCCA, citizen, driver and supervisor accounts must not access these administration APIs.

## Verification performed

- 167 integration assertions passed against real PostgreSQL and service HTTP, including prior financial stabilization checks, tenant isolation, revoked permissions, existing-token suspension, membership restoration, protected administrators, audit isolation/immutability and staff/customer provisioning.
- Integration fixtures were rolled back: no persistent test accounts or financial records.
- Waste unit tests: 28 passed. Frontend unit tests: 7 passed.
- Auth, Organization, Waste and frontend TypeScript checks passed; frontend lint passed.
- Browser visual and interaction QA was not performed in this batch; use the manual steps above.

## Main files

- `infrastructure/database/024_organization_access.sql`
- `services/waste-service/scripts/migrate-organization-access.cjs`
- `services/waste-service/scripts/organization-access-tests.cjs`
- `services/waste-service/scripts/test-stabilization.cjs`
- `services/waste-service/package.json`
- `services/auth-service/src/repositories/organization-access.repository.ts`
- `services/auth-service/src/routes/organization-access.routes.ts`
- `services/auth-service/src/middlewares/organization-permission.middleware.ts`
- `services/auth-service/src/app.ts`
- `services/auth-service/src/services/organization-access.service.ts`
- `services/auth-service/src/services/auth.service.ts`
- `services/auth-service/src/middlewares/auth.middleware.ts`
- `services/auth-service/src/routes/organization-user.routes.ts`
- `services/auth-service/src/controllers/organization-user.controller.ts`
- `services/auth-service/src/services/organization-user.service.ts`
- `services/auth-service/src/repositories/organization-user.repository.ts`
- `services/organization-service/src/middlewares/auth.middleware.ts`
- `services/waste-service/src/middlewares/auth.middleware.ts`
- `apps/admin-web/src/app/dashboard/access/page.tsx`
- `apps/admin-web/src/components/layout/AppShell.tsx`

## Boundaries and next phase

Existing global roles still gate modules; only administration domains have the new fine-grained grants. Current `users.organization_id` remains the active organization context. Custom role editing, multi-organization context switching, invitations and first-administrator provisioning are not included. Legacy-role synchronization preserves current provisioning without granting citizen or regulatory accounts operational memberships. Reusing a role template does not reset removed permissions.

Audit history starts with this migration; it does not reconstruct old actions. Database-superuser tamper resistance is not claimed. This test suite is not an exhaustive concurrent authorization stress test.

Next: Phase 1B, controlled role administration and remaining module-permission mapping, with anti-escalation protections and matching frontend action visibility.
