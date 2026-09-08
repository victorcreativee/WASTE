# Phase 2B — company contact settings and setup checklist

Completed 4 September 2026. This is a focused contact/profile and setup-navigation slice, not a complete operational configuration catalog.

## Delivered

**Company settings** in the company sidebar opens `/dashboard/company-settings`.

- Company administrators can edit email, phone and address in a modal. Existing data prefills; Cancel discards the unsaved form. Success closes the modal and reloads the saved profile.
- Registered name, organization type and active status are read-only. The API rejects extra input fields rather than allowing changes to platform-owned identity or activation.
- Scope comes from the freshly authenticated account, not an organization ID supplied by the browser. KCCA, system-only, supervisor, driver and citizen actors do not receive this company-admin workflow.
- Writes recheck active account/membership/company/admin role inside the organization access transaction lock, compare the expected contact snapshot and record before/after values with the acting administrator.
- An outdated edit returns 409 with instructions to reload; it does not silently overwrite another administrator's contact edit.

Contacts remain the existing organization contact fields, visible to platform administration. They are not private HR fields or login credentials; do not store confidential notes in them.

## Checklist meaning

Five fixed rows use existing records in the current organization:

| Row | Recorded when | Linked workflow |
| --- | --- | --- |
| Company contact | Email or phone exists | Contact-edit modal |
| Operational staff | At least one active account/membership with driver or supervisor role | Staff management |
| Service packages | At least one active service plan | Income & billing |
| Customer service locations | At least one recorded company location | Customer management |
| Fleet records | At least one recorded company vehicle | Fleet control |

**Recorded is not Ready for dispatch.** This checklist does not certify contracts, customer collection eligibility, vehicle availability, route assignments, legal compliance or funding. Customer locations and vehicles are counted as records, including records that need further operational review. Refresh after completing another workflow. The fixed five-row checklist has no unnecessary pagination; existing module lists retain their own pagination.

## Deployment and testing

No migration, no new feature flag, no data reset. Restart **Organization service** and reload the frontend. Rebuild first if serving compiled output. The existing membership/audit schema and billing/operations tables must already be installed.

1. Log in as a company administrator. Open **Company settings** and confirm the displayed company is your own.
2. Click **Edit contact details**. Change email/phone/address, Save, and confirm the modal closes and values persist after refreshing.
3. Reopen, make an unsaved change, Cancel, and reopen: saved values should be restored.
4. Confirm name/type/status are not editable. Direct PATCH requests with fields such as `name`, `type`, `is_active` or `organizationId` must be rejected.
5. Open the page in two administrator sessions. Save one contact change, then submit the other session's stale form. Expect a conflict; close the modal, refresh, then reopen to review current details.
6. Inspect **Access & permissions → Audit history** with an authorized account: `contact updated` should include actor and prior/new contact values.
7. Follow checklist links to staff, packages, customers and fleet. Create only intentional test records, return and Refresh setup; the corresponding recorded count should update.
8. Log in as a second company administrator and confirm their profile and counts remain separate. A supervisor/driver/KCCA account's direct request to the workspace endpoint must return 403.
9. Submit an invalid email or overlong fields and confirm a readable error. Blank fields are allowed; removing both email and phone returns the contact step to Not started.

## Endpoints

- `GET /api/organizations/workspace`: current company profile plus scoped setup counts.
- `PATCH /api/organizations/workspace`: `{email,phone,address,expected:{email,phone,address}}`.

These routes are registered before the existing `/:id` route. No existing routes were removed. Expected values are the loaded contact snapshot, with null contact fields represented by empty strings.

## Verification

- **292** real PostgreSQL/service HTTP assertions passed: 17 workspace checks in addition to the preceding 275 financial/access/onboarding checks.
- Organization-service and frontend TypeScript checks passed; frontend lint passed; seven existing frontend unit tests passed.
- `git diff --check` passed. All integration fixtures rolled back. No persistent financial/account test records were left behind.
- Browser interaction/visual QA was not performed; use the steps above. Checklist reads are informational snapshots, not a transactionally certified readiness report.

```sh
# services/waste-service
npm run test:workspace
# services/organization-service
npx tsc --noEmit
# apps/admin-web
npx tsc --noEmit --incremental false
npm run lint
node --test tests/*.test.cjs
```

## Changed files

- `services/organization-service/src/routes/workspace.routes.ts`
- `services/organization-service/src/app.ts`
- `apps/admin-web/src/app/dashboard/company-settings/page.tsx`
- `apps/admin-web/src/components/layout/AppShell.tsx`
- `services/waste-service/scripts/company-workspace-tests.cjs`
- `services/waste-service/scripts/test-stabilization.cjs`
- `services/waste-service/package.json`
- This guide and `docs/IMPLEMENTATION_PROGRESS.md`

Next: Phase 3A, customer/service ownership and collection-planning eligibility, following the original audit findings. Full operational catalogs, time-zone/currency policies, organization lifecycle recovery, remaining RBAC and production invitation delivery remain outside this batch.
