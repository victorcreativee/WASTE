# Platform User Management — Phase A2

## Purpose

After the one-time browser bootstrap, System Admins manage platform-level identities from **Platform Administration → Platform users**. This workspace creates only System Admin and KCCA System Admin accounts. Organization employees remain under each Organization Admin.

## Workflow

1. Create the first System Admin at `/setup/system-admin` and sign in.
2. Open **Platform users**.
3. Select **Add platform user**.
4. Choose KCCA System Admin or Platform System Admin explicitly.
5. Enter the person's identity and a strong temporary password, then create the account.
6. Share that password through a trusted channel. The form clears and closes after success.
7. Use Suspend/Restore when access changes. The current user cannot suspend themselves, and the last active System Admin cannot be suspended.

KCCA administrators are attached automatically to the seeded KCCA organization. System administrators remain organization-free. An immutable audit list records actor, target, action, role/status metadata and time without passwords.

Migration 035 has been applied to the clean local database. For another local environment:

```bash
cd services/auth-service
npm run migrate:platform-users:check
npm run migrate:platform-users
```

## Verification

Auth-service TypeScript, migration script syntax, frontend ESLint, production frontend build, and `git diff --check` pass.
