# Phase 1D — delegated driver-account and team management

Completed 4 September 2026. Existing roles are unchanged unless an administrator explicitly adds `staff.manage`.

## Delivered

Administrators can select **Manage driver accounts and assign drivers to existing supervisors** in the custom-role modal. Staff viewing is required. The new grant enables:

- Creating driver accounts, including their driver profile and active organization membership.
- Activating/suspending ordinary driver accounts in the same organization.
- Assigning eligible drivers to existing supervisors, or removing assignments.

Delegates cannot create supervisors, change non-driver staff, change their own account, change administrators or other staff/access-management accounts, or edit their own supervisor team. Customer accounts cannot be changed through the staff-status API. Payroll, customer creation and access administration remain separately restricted. Granting staff management does not grant any financial permission.

These are organization-wide staffing powers, not a team-only permission: a delegate may manage other supervisors' driver assignments. Supervisors still retain the existing organization-wide operational visibility described in the original audit; this batch does not implement assigned-team-only monitoring.

## Transaction and eligibility controls

Provisioning, status changes and team replacement now acquire the organization access lock and recheck effective `staff.manage` inside the write transaction. Role removal through the application cannot interleave between this check and the write. The actor is set for existing audit triggers; team changes record before/after driver IDs explicitly.

Supervisor/team selection requires an active user and membership in the same organization. Drivers with an inactive driver profile are also rejected. Invalid replacements leave the previous team intact. Account activation does not restore a separately suspended membership; both must be active for login.

The driver selection UI is now a searchable, paginated table with selected count and eligibility feedback. Ineligible existing selections can be removed. Self/protected account actions are labelled rather than shown as editable. Delegates see only Driver in the account-creation role selector; company administrators keep the Supervisor option. Successful creation retains the existing form reset behavior.

## Deployment

No new migration. Migration 024 is still required. Restart **Auth** and reload the frontend, rebuilding if using compiled output. No existing accounts, financial records or payroll data were reset. Regression fixture accounts/assignments were rolled back.

## Test this workflow

1. As company administrator, open Access & permissions → Role templates. Create **Driver staff manager**, enable staff viewing and driver/team management, then save.
2. Assign the role to a dedicated driver or supervisor via Memberships → Assigned roles. Reload that user's separate session.
3. Open Staff management → Add staff member. Only Driver should be available for a delegated user. Create a test driver with a unique email and securely chosen password. Confirm the fields clear and the new user appears.
4. In a separate session, sign in as the new driver. Their normal driver workspace should work. This does not create a supervisor or administrator.
5. As delegate, suspend and reactivate the ordinary test driver. Confirm the user account changes, while membership status remains independent. Own/admin/other staff-manager accounts must not expose these actions. Direct API attempts must be rejected.
6. Open Supervisor teams. Select an existing active supervisor other than yourself. Search/select the test driver and Save team. Reload and confirm the assignment.
7. With enough test drivers, change page size and pages; selections should remain selected across pages. Searching should not clear selections.
8. Make a selected driver's membership or account unavailable, then reload the staffing page. The selection table should explain its ineligibility and allow removal. Attempts to submit an ineligible or foreign-company driver must fail without replacing the old team.
9. Check Audit history as an authorized reviewer/admin: delegated provisioning, account status and team changes should identify the acting delegate, without password fields.
10. Remove the delegate's custom role. Subsequent account/team API writes must return 403; reload the page to update controls. The delegate's original operational role remains functional.
11. As company administrator, verify supervisor creation/status management still works. A delegate's direct attempt to create a supervisor returns 409; administrator-role input is rejected by validation.

## API changes

No routes removed or added. Existing routes now permit appropriately authorized tenant staff with the documented limits:

- `POST /api/auth/organization-users`: `staff.manage`; non-administrators may create only drivers.
- `PATCH /api/auth/organization-users/:userId/status`: `staff.manage`; scoped, self/admin/customer and privileged-target checks.
- `PUT /api/auth/organization-users/supervisors/:supervisorUserId/drivers`: `staff.manage`; protected self-team and eligibility checks.
- Custom-role create/edit accepts `staff.manage` only alongside `staff.read`.
- Staff list adds `management_protected`; permission discovery adds `currentUserId` and `isAdministrator` for matching UI controls. Server checks remain authoritative.

## Verification

- **251** real PostgreSQL/service HTTP assertions passed: 28 new checks beyond the previous 223, including new-driver login, protected targets, foreign/invalid teams, audit attribution and revoked write access.
- Auth and frontend TypeScript checks passed. Frontend lint passed. Seven existing frontend unit tests passed.
- `git diff --check` passed. Browser visual/interaction QA remains manual; no exhaustive multi-session authorization race test was performed.

```sh
# services/waste-service
npm run test:access
# services/auth-service
npx tsc --noEmit
# apps/admin-web
npx tsc --noEmit --incremental false
npm run lint
node --test tests/*.test.cjs
```

## Changed files

- `services/auth-service/src/repositories/staff-authorization.ts`
- `services/auth-service/src/repositories/organization-user.repository.ts`
- `services/auth-service/src/services/organization-user.service.ts`
- `services/auth-service/src/repositories/organization-access.repository.ts`
- `services/auth-service/src/routes/organization-access.routes.ts`
- `services/auth-service/src/routes/organization-user.routes.ts`
- `services/waste-service/scripts/organization-access-tests.cjs`
- `apps/admin-web/src/app/dashboard/access/ReviewRoles.tsx`
- `apps/admin-web/src/app/dashboard/team/page.tsx`
- This guide and `docs/IMPLEMENTATION_PROGRESS.md`

## Remaining boundaries and next batch

Team saves are atomic replacements, not optimistic-versioned edits: two authorized saves can replace each other in sequence. Staff passwords still use the existing administrator/delegate-created temporary-password flow; invitation/password-change workflows are not added here. Role archival, full module RBAC, gateway-wide negative coverage and supervisor team-only visibility remain outstanding; Phase 1 is not claimed complete.

Next product slice: Phase 2A company onboarding and first-administrator setup, as prioritized by the audit roadmap. Inspect current company lifecycle and implement a controlled invitation/setup flow with tenant boundaries, single-use/expiry checks and testing. Company users must still never be able to create another organization or grant themselves administrator powers.
