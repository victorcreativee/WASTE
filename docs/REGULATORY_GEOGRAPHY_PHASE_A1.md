# Permit and regulatory geography foundation — Phase A1

## Delivered

- Public pre-account permit submission with company, registration, contact, service and document metadata.
- Controlled permit states: submitted, under review, information required, approved, rejected, suspended and expired.
- KCCA-only review transitions with notes, reviewer and timestamps.
- The five Kampala divisions as governed master data.
- KCCA-only organization/division authorization tied to an approved, current permit.
- A database trigger that rejects new organization zones without a valid division authorization.
- System Admin read access to applications for the following activation phase.

KCCA cannot create the platform organization or its initial administrator. Platform activation is deliberately the next separate phase.

## Endpoints

- `POST /api/waste/public/permit-applications`
- `GET /api/waste/regulatory/permit-applications`
- `PATCH /api/waste/regulatory/permit-applications/:id`
- `GET /api/waste/regulatory/divisions`
- `POST /api/waste/regulatory/division-authorizations`

## Apply and test

```bash
cd services/waste-service
npm run migrate:regulatory-geography:check
npm run migrate:regulatory-geography
npm run typecheck
```

Existing zones are not deleted or guessed into divisions. They remain with a null division until an authorized administrator classifies them in the later migration workflow.

## Verification

Waste-service TypeScript, migration script syntax, and `git diff --check` pass. Database execution requires the local PostgreSQL service.
