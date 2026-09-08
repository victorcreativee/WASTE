# Phase 1C — staff directory and attendance delegation

Completed 4 September 2026.

## Delivered scope

Custom roles can now explicitly include staff directory viewing, attendance viewing, and attendance recording. Existing Phase 1B roles keep exactly their previous grants; no data migration or automatic permission expansion occurred.

Permission choices in **Access & permissions → Role templates → Create custom role / Edit role**:

| Choice | API permission | What it allows |
| --- | --- | --- |
| Included membership/template viewing | access.read | Organization membership list and role templates |
| Optional audit viewing | audit.read | Recorded administration changes |
| Staff directory | staff.read | Staff names, emails, phones, licences, account/membership status and team assignment details |
| View attendance only | attendance.read | Organization attendance records, including stored notes |
| View and record attendance | attendance.manage plus attendance.read | Record attendance for eligible staff across the organization |

Attendance grants require staff viewing. Recording requires attendance viewing. These dependencies are enforced by the API, not just the form. Administrators still cannot grant permissions they lack. Custom-role editing and assignments retain tenant scoping, administrator protection, stale-edit detection and auditing.

**This does not delegate account creation, account suspension, supervisor team changes, customer creation, payroll, payments or administrator powers.** Those mutations retain their existing company-administrator gate and scoped permissions. Custom attendance recording is organization-wide, not limited to the actor's supervisor team; an eligible recorder may also record their own attendance. Grant it only to trusted attendance coordinators. Attendance approval, period locking, payroll reconciliation and team-only recording policies are not added here.

## Attendance safeguards and UI

- Targets must be in the same organization, have an active account and membership, and hold an eligible driver/supervisor/IoT operational role. Customer and administrator/regulatory identities are excluded.
- Attendance writes recheck effective permission inside a transaction using the same organization lock as role changes. Permission revocation via these application workflows cannot interleave between that check and the write.
- Each successful recording includes an actor-attributed audit entry with previous/new operational attendance values. Free-text notes are deliberately omitted from audit payloads.
- Dates and shift times are validated and return readable errors.
- Staff and attendance views have search and shared client-side table pagination. Existing list API response shapes are preserved.
- Directory viewers do not see Add staff or Supervisor teams controls. Attendance viewers cannot use recording controls. Sidebar access is based on effective server grants.
- The attendance view ignores out-of-order date responses, shows loading/unavailable states and disables recording if loading fails. Changing a status preserves the loaded shift and notes.
- Duplicate Add staff navigation was removed; the page header retains the main action for authorized administrators.

## Deployment

No new migration is needed; migration 024 remains required. Restart **Auth** and reload the frontend. Rebuild if using compiled service/frontend output. No existing accounts, payroll, payments or expenses were reset. Integration test fixtures were rolled back.

## Testing steps

1. As company administrator, open **Access & permissions → Role templates → Create custom role**. Name it **Attendance coordinator**.
2. Check **View staff directory**. Choose **View attendance only**, save, then assign the role to a dedicated driver/supervisor from **Memberships → Assigned roles**.
3. In that staff member's separate session, reload. **Staff management** should appear in the sidebar. Confirm staff search/pagination works and that Add staff, account activation/suspension and Supervisor teams controls are unavailable.
4. Open Attendance. Select a date. Confirm status controls are disabled for this viewing-only role.
5. As administrator, edit the role and explicitly choose **View and record attendance**. Save, then reload the staff session. Mark another eligible staff member present. Reload the date and confirm the saved status.
6. If the record already has a different shift or notes, change only the status and verify that the shift/notes remain intact.
7. As administrator with audit access, inspect Audit history for `attendance recorded`: the actor should be the staff coordinator, with before/after status/shift details and no copied free-text notes.
8. Suspend the target's membership and reload Staff management. They should disappear from eligible attendance rows. Direct attendance attempts for a customer, administrator, foreign-company member or suspended membership must return 404 without a write.
9. Change the role back to **View attendance only**. A write using the existing staff token must return 403, while reads remain allowed. Reloading the page should disable the control.
10. Remove the assignment. Reload the staff session: Staff management disappears and its API returns 403. Their original driver/supervisor work remains available.
11. Confirm an old review-only role has not gained staff or attendance access. Payroll and staff-account writes remain forbidden for the coordinator.
12. Switch dates quickly and simulate an unavailable attendance endpoint. Old date responses must not replace the selected date's results; recording must remain disabled after a failed load. Browser interaction checks are manual for this batch.

## Endpoints changed

- `GET /api/auth/organization-users`: accepts active tenant staff with `staff.read`; includes `membership_status` and only operational staff identities.
- `GET /api/auth/organization-attendance?date=YYYY-MM-DD`: accepts `attendance.read`, validates the filter.
- `PUT /api/auth/organization-attendance`: accepts `attendance.manage`, rechecks it transactionally, validates eligible staff and audits the write.
- Existing `/api/auth/organization-access/roles` create/edit and membership assignment endpoints accept the three additional, explicitly selected permissions. No route removal or new endpoint was necessary.

## Verification

- **223** PostgreSQL/service HTTP regression assertions passed (26 added to the previous 197), covering delegation, dependencies, account-write denial, customer/admin/foreign/inactive targets, audit attribution, validation and live permission revocation.
- Auth and frontend TypeScript checks passed. Frontend lint passed without warnings. Seven existing frontend unit tests passed.
- `git diff --check` passed. No browser visual/interaction QA or exhaustive concurrent-session authorization test was performed.

Commands:

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

- `services/auth-service/src/routes/organization-user.routes.ts`
- `services/auth-service/src/routes/organization-access.routes.ts`
- `services/auth-service/src/repositories/organization-access.repository.ts`
- `services/auth-service/src/repositories/organization-user.repository.ts`
- `services/auth-service/src/repositories/attendance.repository.ts`
- `services/auth-service/src/controllers/attendance.controller.ts`
- `services/auth-service/src/validators/attendance.validator.ts`
- `services/waste-service/scripts/organization-access-tests.cjs`
- `apps/admin-web/src/components/layout/AppShell.tsx`
- `apps/admin-web/src/app/dashboard/access/ReviewRoles.tsx`
- `apps/admin-web/src/app/dashboard/team/page.tsx`
- This guide and `docs/IMPLEMENTATION_PROGRESS.md`

Next: controlled staff-account/team management delegation, with self/admin protection, transactional permission rechecks, matching UI and regression tests. Broader financial permissions and full organization RBAC remain unfinished.
