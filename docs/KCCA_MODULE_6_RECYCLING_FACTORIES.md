# Module 6: recycling factories and chain of custody

Delivered 21 October 2026. Adds the last actor from the original brief, recycling factories, and connects them to recyclers
and to KCCA. Builds on Modules 1–5; migration **097**.

## Who does what

| Role | Gets |
|---|---|
| **Platform admin** | Creates an organization of type *Recycling factory* (`processing_plant`, already allowed by the schema) and invites its first administrator with the existing onboarding invitations (previously collectors only). |
| **KCCA** | Issues factory permits with two new activities (*recycled material processing*, *recycled product manufacturing*); sees a **Recycling factories** section and a **Chain of custody** table in Recycling oversight; receives factory monthly returns; raises compliance cases against factories. |
| **Factory admin** | Factory workspace: overview, material intake, processing, product dispatch; staff management (supervisors); the KCCA regulatory portal (permit, compliance, returns). Voids intakes. |
| **Factory supervisor** | Same workspace without staff management and voiding. |
| **Recycler** | When recording an industrial sale, can name the **licensed recycling factory** buying it. |

## Factory workspace

- **Factory overview** (`/dashboard/factory`): this month's accepted and rejected material, material processed, product
  output, yield, residue and dispatched product; stock waiting to be processed by material; **expected deliveries** from
  recyclers, with **Receive**; recent batches.
- **Material intake** (`/dashboard/factory/intake`): every intake with supplier, material, received, accepted (received
  minus rejected at the gate) and remaining weight. **Record intake** covers suppliers that are not licensed recyclers on the
  platform. An unprocessed intake can be voided with a reason; the record stays.
- **Processing** (`/dashboard/factory/processing`): each batch names the intakes it used and how much of each, the product,
  output, residue and how the residue was disposed of. Yield is shown live while entering a batch.
- **Product dispatch** (`/dashboard/factory/dispatch`): finished product leaving the factory, optionally linked to its batch
  (a batch cannot dispatch more than it produced).
- Lists use server-side paging (the Module 5 pagination API).
- Factory administrators and supervisors land in the factory workspace when they sign in.

## Chain of custody

1. A recycler records an industrial sale and selects the licensed factory as the buyer. Only an active recycling factory is
   accepted (database check). The directory shows whether each factory's processing permit is in force.
2. The sale appears in the factory's **expected deliveries**.
3. The factory **receives** it, entering the weight that actually arrived and anything rejected at the gate. The supplier,
   material and declared weight come from the sale.
4. From then on, the sale's buyer, quantity and material cannot change on the recycler's side (database trigger).
5. KCCA's oversight lists **custody exceptions** for the period:
   - **Overdue:** not received more than 7 days after the sale.
   - **Shortfall:** received more than 5% (and at least 10 kg) below the sold weight.

A voided intake keeps its link to the delivery for the record and frees the delivery to be received again; only one
*received* intake per delivery is possible (partial unique index).

Rules live in `services/waste-service/src/services/factory.rules.ts` (`CUSTODY_RULES`). **KCCA should confirm the 7-day and
5% / 10 kg thresholds.**

## Regulation

- **Permit enforcement:** recording an intake requires a permit in force with *recycled material processing*; the same
  transitional rule as other operators applies (no permit on record → not blocked, listed for KCCA). Expiry notices for
  factories say that new intake cannot be recorded.
- **Monthly returns:** material accepted, rejected at the gate, processed, product output, residue (with disposal method,
  required when there is residue), product dispatched and staff. Output plus residue cannot exceed material processed.
  Prefilled from the factory's records; compared with them in the KCCA register like other returns.
- **Compliance cases:** factories are eligible (category *Recycling operations* fits most cases).
- **City report:** the recycling section carries the factory totals.

## Database — migration 097 (`infrastructure/database/097_recycling_factories.sql`)

Additive and idempotent; requires 092–096.

- `processing_plant` added to the organization-type checks on permit activities, returns and platform packages; two factory
  permit activities; a *Factory Standard* package.
- `recycling_material_sales.buyer_organization_id` with a check that it is an active factory, and a lock once received.
- Tables `factory_intakes` (accepted weight generated as received − rejected; remaining weight never exceeds accepted),
  `factory_batches` (output + residue ≤ input), `factory_batch_inputs`, `factory_dispatches`, each guarded so records belong
  to a factory and are recorded by its own staff.
- `organization_permit_block_reason` covers factories; intake trigger enforces the processing activity;
  `expire_lapsed_permits` writes factory-specific notices.

```bash
cd services/waste-service
npm run migrate:recycling-factories:check
npm run migrate:recycling-factories
```

## API (under `/api/waste`)

| Method & path | Who |
|---|---|
| `GET /organization-context` | Any signed-in user (their organization's type, used by the web shell) |
| `GET /factories/directory` | Recycler staff, company staff, KCCA, system admin |
| `GET /factory/overview`, `/factory/expected-deliveries` | Factory admin, supervisor |
| `GET /factory/intakes`, `POST /factory/intakes` — `{sourceSaleId}` or `{supplierName, materialCategory, materialDescription, declaredKg?}` plus `{receivedKg, rejectedKg, receivedOn, vehicleRegistration?, notes?}` | Factory admin, supervisor |
| `PATCH /factory/intakes/:id/void` — `{reason}` | Factory admin |
| `GET /factory/batches`, `POST /factory/batches` — `{processedOn, productName, inputs:[{intakeId,kg}], outputKg, residueKg, residueDisposal?, notes?}` | Factory admin, supervisor |
| `GET /factory/dispatches`, `POST /factory/dispatches` — `{batchId?, productName, quantityKg, buyerName, destination?, dispatchedOn, notes?}` | Factory admin, supervisor |
| `POST /recycling/sales` / `PATCH /recycling/sales/:id` — now accept `buyerOrganizationId` | Recycler staff (existing permissions) |

List endpoints accept `?page=&pageSize=` or `?limit=&offset=`.

## Verification

- `npm test` (waste-service): **114/114** (5 new: overdue after 7 days, shortfall thresholds, yield, valid batch draws,
  refused draws).
- `npm run test:e2e:factories`: **15/15**:
  - **Licensing and access:** factory-only activities; recycler denied the factory workspace.
  - **Permit enforcement:** intake blocked until the processing activity is added.
  - **Directory and buyer:** directory with permit status; buyer must be a factory.
  - **Chain of custody:**
    - expected delivery, then receipt with shortfall (800 kg sold, 740 received, 40 rejected)
    - duplicate receipt refused
    - received sale locked on the recycler's side
    - overdue delivery after 10 days
  - **Processing and dispatch:**
    - batch drawing on two intakes (yield 77.8%); overdraw, missing residue disposal and future date refused
    - void rules
    - dispatch capped at batch output
  - **Overview:** figures and paged lists.
  - **KCCA:** factory figures and both custody exceptions in oversight; factory return validation and register; compliance
    case; expiry blocking intake with a factory-specific notice.
- Full `npm run release:check` passes:
  - **Build and tests:** 5 type checks; 7 + 114 unit tests; dependency audit; production build of **63** pages.
  - **Migrations:** **97** applied to a fresh database, and 092–097 re-applied.
  - **End-to-end:** seven suites, **110 checks**.
- Browser, with test data kept temporarily: factory navigation and overview, receive form with its live shortfall
  warning (not submitted), processing list with traceable inputs, KCCA recycling oversight factories section. Test data
  removed afterwards.

## Not in this module

- Factory-to-factory transfers and finished-product buyers on the platform (dispatch buyers are free text).
- Weighbridge-ticket linking for factory intake.
- A separate factory onboarding application (factories are created by the platform admin).
- The recycler-side sale form shows the factory choice only in industrial-sale mode; recycler collectors' local sales do not
  offer it.
