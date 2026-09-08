# Phase 1B — delegated read-only access review

Completed 3 September 2026. This batch deliberately implements a bounded first custom-role workflow; broader operational and financial permission conversion remains unfinished.

## What works

Company administrators with `access.manage` can create and edit named review roles, then assign/remove them on staff memberships. Each role includes membership/template viewing (`access.read`) and may include audit viewing (`audit.read`). This exposes staff names/emails, membership/account statuses and, optionally, recorded administration changes: grant it only to staff who should see this information.

The roles do not grant staff editing, payroll, payments, membership management or administrator status. Existing operational roles are unchanged. Administrators cannot edit built-in roles, assign those roles through this workflow, change their own/admin review assignments, grant rights they lack, or cross company boundaries. Built-in role names are reserved even before the corresponding tenant template exists. Stale role edits return a conflict rather than overwriting newer values.

Changes use the existing organization access transaction lock and actor-attributed audit triggers. Removing a grant takes effect on the next API request, including requests with an already-issued token. Rights are additive across roles: removing one role does not remove permissions supplied by another role.

## UI and deployment

Open **Access & permissions** → **Role templates** → **Create review role**. Creation and editing use a modal, which closes and clears after a successful save. Role tables and assignment tables support search and shared pagination. Membership/audit pagination remains server-side; role-list pagination operates on the loaded role overview.

Use **Memberships** → **Review roles** beside a non-administrator member to assign/remove a role. Each assignment action saves immediately and closes the dialog. Built-in role assignments are not changed. Audit history and management controls are permission-gated. The sidebar checks current server permissions on page navigation; reload an already-open staff page after changing its grants to update navigation.

No new migration is needed. Migration 024 from Phase 1A is a prerequisite. No existing accounts or financial records were reset. Restart Auth and reload the frontend; rebuild first if using compiled output. Other services still require the Phase 1A membership guards already installed.

## Manual testing steps

1. Sign in as company administrator. Open Access & permissions → Role templates.
2. Create **Access reviewer** and select optional audit access. Save. Confirm the modal closes, the new role appears, and reopening Create gives an empty form.
3. Try the same name with different capitalization: the API must reject the duplicate. Names such as `driver` are reserved.
4. Open Memberships. On a dedicated driver/supervisor account, choose Review roles → Assign role.
5. In a separate isolated session, sign in as that staff member (or reload their existing session). The Access & permissions sidebar entry should appear.
6. Confirm they can view organization memberships, role templates and audit history, but cannot see role-creation, assignment or suspension controls. Direct write attempts must return 403. Existing driver work should still function.
7. As administrator, edit Access reviewer and remove audit access. Save. Reload the staff page: Audit history should disappear; a direct audit API call returns 403. Membership viewing remains allowed.
8. As administrator, remove the review-role assignment. Reload the staff page: access-review navigation disappears and the access API returns 403. Their original operational role remains functional.
9. Attempt two edits from separate administrator sessions: save one first, then save the stale second form. The second save must report that the role changed; reload and reopen it before retrying.
10. Confirm administrator memberships remain protected and another company cannot view, edit or assign this role. Verify the recorded actor/role/assignment changes in Audit history.
11. For a pagination check, create enough review roles or use an existing larger fixture set; verify search, page size and page changes on both role tables. Do not use real staff for permission experiments unnecessarily.

## Endpoints

All paths start with `/api/auth/organization-access`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/me` | Current active tenant staff member's own effective permission codes |
| POST | `/roles` | Create a read-only review role: `name`, `permissions` |
| PUT | `/roles/:roleId` | Edit role with `name`, `permissions`, and `expected: {name, permissions}` |
| PUT | `/memberships/:membershipId/roles/:roleId` | Assign/remove one custom role using `assigned: true/false` |

Existing overview, memberships and audit GET endpoints now accept explicitly authorized tenant staff, not only company administrators. No grants are automatically added to drivers or supervisors. KCCA, platform-only and citizen roles remain excluded. All mutations still require company-admin identity plus `access.manage`, rechecked within role-write transactions.

## Verification

- 197 real PostgreSQL/service HTTP regression assertions passed, including previous financial/access checks and 30 new review-role assertions.
- Test fixtures rolled back; no persistent test users, roles or financial records.
- Auth and frontend TypeScript checks passed. Frontend lint and 7 existing frontend unit tests passed.
- `git diff --check` passed. Browser visual/interaction testing was not performed; follow the manual steps above.

Commands from the respective service directories:

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

## Files changed

- `services/auth-service/src/repositories/organization-access.repository.ts`
- `services/auth-service/src/routes/organization-access.routes.ts`
- `services/waste-service/scripts/organization-access-tests.cjs`
- `apps/admin-web/src/app/dashboard/access/page.tsx`
- `apps/admin-web/src/app/dashboard/access/ReviewRoles.tsx`
- `apps/admin-web/src/components/layout/AppShell.tsx`
- This guide and `docs/IMPLEMENTATION_PROGRESS.md`

## Next

Map and convert the next non-financial staff/attendance workflows to scoped permissions, including frontend action visibility, without allowing staff administrators to promote themselves. Custom financial roles, role deletion/archival, administrator transfer, multi-organization context switching and full module-level RBAC are not implemented in this batch. General modal keyboard/focus behavior and browser accessibility review also remain follow-up work.
