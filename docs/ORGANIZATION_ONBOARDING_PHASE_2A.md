# Phase 2A — company onboarding and first-administrator setup

Completed 4 September 2026. This is the local-development first-admin onboarding workflow, not a production email-delivery or account-recovery system.

## Delivered

KCCA/system administrators can register a company and issue a first-admin setup link from **Organizations → Administrator setup**. The recipient opens `/setup/company-admin`, enters the invited email, their name and their own password, then signs in normally. A company administrator cannot issue invitations or create another organization.

Only active `waste_collection_company` organizations qualify. Any existing company-admin account, even suspended, blocks this first-admin path. Existing email accounts cannot be transferred or overwritten. Other organization types retain their existing registration behavior but cannot use this company-admin setup.

Setup links use 32 random bytes, expire after 24 hours and are accepted once. The database stores only a SHA-256 digest. Reissuing revokes the pending link; explicit revocation is also available. Acceptance checks email binding, expiry, organization activity and existing administrator state inside a transaction using the organization access lock. It creates the user/global role, existing membership/permission bindings and audit event atomically.

The token is carried in a browser URL fragment rather than a query/path and removed from the address bar after capture. It is not saved to browser storage or returned by status/history endpoints. Raw links appear only in the issuing modal's in-memory result. **No email is sent.** Copy the link and share only with the intended recipient through a trusted channel. Possession of the link plus the invited email is sufficient to accept; this is not independent email-ownership verification.

The Organizations page now uses shared pagination, a blue primary action and an Add organization modal instead of an always-open side form. The create modal clears/closes after success. Setup status shows the latest 10 invitations, not an exhaustive paginated history.

## Local deployment performed

- Started the existing `smart_waste_postgres` container on localhost:5434 after Docker became available. No container or database was recreated.
- Validated migration **025_company_onboarding.sql** in a rollback transaction, then applied it after passing integration tests. Existing accounts were unchanged; no financial data was reset.
- Enabled `WMS_ONBOARDING_ENABLED=true` in the local Auth `.env` after validation/application. Code defaults to disabled if the flag is absent or not `true`.
- **Restart Auth and reload the frontend.** Rebuild first when running compiled output. Organization service/gateway must also be running for company registration and normal UI API traffic.

For another environment: apply migrations through 024, validate/apply 025, run acceptance checks, and only then enable the flag. The included migration runner intentionally rejects production/non-local database hosts.

```sh
# services/waste-service
npm run migrate:onboarding:check
npm run migrate:onboarding
npm run test:onboarding
```

## Manual testing

1. Restart Auth. Sign in as KCCA or system administrator. Open Organizations.
2. Click **Add organization**, select **waste collection company**, and create a clearly named test company. Confirm the form resets/closes and the organization appears. Search/page through the table as needed.
3. On that company, click **Administrator setup**. Enter a new unused email and issue a link. Confirm the modal says no email was sent. Copy the link before closing.
4. Open the copied link in a separate browser/session. Enter the same invited email, your test administrator name and matching password (at least 12 characters; maximum 72 UTF-8 bytes).
5. Submit. Confirm success, follow the sign-in link and log in. The account should use Organization Operations and be scoped to the new company. It should have no other company's private records.
6. Reopen the original link and submit again: it must fail. Return to Administrator setup: the company now has an administrator and cannot be re-onboarded through this page.
7. With another test company, issue a link, then issue a replacement. The old link must fail. Revoke the replacement and confirm it also fails. No user should be created by either failure.
8. Try the wrong invited email: rejection must not create an account. Existing registered emails must be rejected at issuance, without transferring the existing account.
9. Confirm inactive companies and companies with existing administrators cannot receive a setup link. Company/driver accounts must receive 403 on platform invitation APIs; unauthenticated issuance is not permitted.
10. After more than five acceptance attempts from one IP within a minute, expect 429; wait a minute before continuing. This includes invalid/reused-link tests.
11. Review the recorded invitation-issued/replaced/revoked/accepted events as an authorized company audit viewer. Neither tokens nor password hashes belong in event payloads.

Refreshing the setup page after the fragment has been removed requires reopening the original link. If a copied link is lost before acceptance, issue a replacement; raw tokens cannot be recovered from the database.

## Endpoints

All start with `/api/auth/organization-onboarding` and return `Cache-Control: no-store`.

| Method | Path | Authorization |
| --- | --- | --- |
| GET | `/:organizationId` | KCCA/system: first-admin state and latest 10 invitations |
| POST | `/:organizationId/invitations` | KCCA/system: body `{email}`; raw token returned once |
| DELETE | `/:organizationId/invitations/:invitationId` | KCCA/system: revoke pending link |
| POST | `/accept` | Public bearer-link flow: `{token,email,fullName,password}` |

Issuance/revocation recheck the active platform actor inside their transaction. No public invitation inspection endpoint reveals organization or recipient details. Existing routes and login semantics are preserved.

## Verification

- **275 real PostgreSQL/service HTTP assertions passed**, including 24 new onboarding assertions and the prior financial/staff/access suite. All fixture accounts, organizations, invitations and financial records rolled back.
- Auth/frontend TypeScript and frontend lint passed. Seven existing frontend unit tests passed. `git diff --check` passed.
- Browser interaction/visual testing and multi-instance/concurrent acceptance stress testing were not performed. Follow the manual steps above.

## Changed files

- `infrastructure/database/025_company_onboarding.sql`
- `services/waste-service/scripts/migrate-onboarding.cjs`
- `services/waste-service/scripts/onboarding-tests.cjs`
- `services/waste-service/scripts/test-stabilization.cjs`
- `services/waste-service/package.json`
- `services/auth-service/src/repositories/onboarding.repository.ts`
- `services/auth-service/src/routes/onboarding.routes.ts`
- `services/auth-service/src/app.ts`
- `services/auth-service/.env` (non-secret onboarding feature flag only)
- `apps/admin-web/src/app/dashboard/organizations/AdminSetup.tsx`
- `apps/admin-web/src/app/dashboard/organizations/page.tsx`
- `apps/admin-web/src/app/setup/company-admin/page.tsx`
- This guide and implementation progress.

## Limits and next batch

Public acceptance uses a conservative **process-local** IP limiter: five attempts per minute. Multi-instance deployment needs a shared limiter and correctly configured trusted-proxy behavior; HTTPS and trusted delivery are production prerequisites. Invitation delivery, verified-email ownership, password recovery, administrator transfer and complete lifecycle deactivation/reactivation are not implemented. Do not use first-admin setup as recovery for an existing account.

Next: Phase 2B company profile/settings and a guided setup checklist, without expanding company creation rights. Remaining foundation/gateway-wide tests, full module permissions and team-only supervisor monitoring remain tracked separately.
