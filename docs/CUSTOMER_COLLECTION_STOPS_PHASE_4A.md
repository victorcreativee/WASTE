# Customer collection stops — Phase 4A

## Outcome

Collection work is now recorded at the serviced customer location, not inferred from an area-level job. An area job can contain multiple customer stops and cannot be completed until every planned stop is completed, skipped, or cancelled.

## Workflow

1. A company administrator or supervisor creates and assigns an area collection job.
2. **Plan customer stops** selects only customers that currently have all required service evidence: an active provider relationship in the job's zone, active customer and location records, a current active contract, its linked active subscription, and an active compatible package.
3. The assigned driver starts the area job and records **Arrived** and **Collected** for each household.
4. The driver completes the area stop and job only after every household stop is resolved.
5. The resident sees only their own household pickup record and upcoming pickup, while the company sees progress in dispatch.

The generated stop keeps the exact relationship, contract, subscription, and service-location identifiers used to establish eligibility. Running planning twice does not duplicate a stop. Cancelling an area job automatically cancels its unresolved household stops.

## API surface

- `GET /api/waste/customer-collection-stops` — resident self-scope or company scope
- `POST /api/waste/collection-jobs/:jobId/customer-stops` — plan eligible stops
- `PATCH /api/waste/customer-collection-stops/:id` — assigned-driver arrival, completion, or skip

Tenant and driver ownership are enforced in the database queries. A driver from another company or an unassigned driver cannot update a stop.

## Test guide

### Prepare service eligibility

1. Sign in as the organization administrator.
2. In **Customer management**, confirm the resident is active, has an active service address, and is linked to this organization in the same zone used by dispatch.
3. In **Income & billing**, confirm the selected package is active.
4. In **Contracts & SLAs**, confirm the resident has a current active contract connected to that package and an active subscription.

### Plan and perform the pickup

1. Open **Dispatch & collections** and create an area job for that zone.
2. Assign an available truck and the intended driver.
3. Click **Plan customer stops**. The table shows `resolved / total` customer-stop progress. Clicking the action again must report zero newly created stops.
4. In a separate browser profile, sign in as the assigned driver and open **Driver route**.
5. Start the route/job, mark the area stop as arrived, then use **Arrived** and **Collected** on each household row.
6. Try completing the area job before resolving all household rows; completion must be refused.
7. Resolve every household row, then complete the area stop and job.
8. In another browser profile, sign in as that resident. **Customer service** must show the completed household pickup with its collection details. Another resident must not see it.

### Cancellation check

1. Plan customer stops for a pending or assigned job.
2. Cancel the area job.
3. Verify its unresolved household stops are cancelled and no longer block work.

## Verification

- Waste-service TypeScript check passed.
- Admin frontend TypeScript and lint checks passed.
- Full PostgreSQL/HTTP rollback suite passed with 349 assertions; all fixture data was rolled back.
- Migration `028_customer_collection_stops.sql` was applied locally without changing existing operational or financial records.

## Deliberately deferred

- Automatic generation from recurring schedules
- Route-order optimization and vehicle-capacity planning
- Photo/file storage for collection evidence (the API can already retain an evidence URL)
- Driver skip-reason modal and notification delivery
- Backfilling customer stops for historical area jobs
