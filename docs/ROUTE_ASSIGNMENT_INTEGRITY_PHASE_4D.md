# Phase 4D — route assignment integrity

Completed 6 September 2026.

## Outcome

Route planning now creates one operational commitment instead of a separate route record that can disagree with its collection jobs. A route requires a date, an available driver, an available and compliant vehicle, and at least one compatible job. When it is created, every selected job is assigned to that same crew and vehicle in the same database transaction.

## Dispatcher workflow

1. Open **Dispatch & collections** and select **Routes**.
2. Enter a clear route name and working date.
3. Choose the vehicle and driver. Only operational resources appear in the form.
4. Select from the jobs shown. The list contains only open, unrouted work on the chosen date that does not conflict with an existing job assignment.
5. Select **Create route**. The route and all selected job assignments are saved together.

Changing the date, driver, or vehicle clears the current job selection. This prevents a dispatcher from accidentally submitting jobs that were selected for an earlier crew choice.

## Enforced rules

- Only company administrators and supervisors can create routes. KCCA and system administrators retain oversight access but cannot dispatch a private company route.
- A vehicle in maintenance/inactive state, a driver who is off duty/inactive, or a vehicle with a document expired before the route date is rejected.
- The same driver or vehicle cannot have two planned, dispatched, or in-progress routes on one date.
- A job must belong to the organization, be pending or assigned, have the same date, and not already belong to another route.
- An existing job-level driver or vehicle assignment must match the route crew.
- Per-job transaction locks prevent simultaneous route requests from allocating the same job twice.
- The collection-jobs response exposes `is_routed` so the frontend can remove allocated work from the selection list.

## Test guide

### Successful route

1. Make sure at least one pending collection job exists for a future date.
2. Make sure an available driver and available vehicle exist.
3. Open **Routes**, choose that same date and crew, then select the job.
4. Create the route.
5. Confirm the route appears in the table and the job now shows **assigned** with the selected driver and vehicle.
6. Open the route details and confirm the selected jobs appear in stop order.

### Guard checks

Repeat with each case and confirm a clear error is shown without creating a partial route:

- select a vehicle placed in maintenance;
- take the driver off duty before submitting;
- attempt to add a job dated differently from the route;
- attempt to place an already-routed job on another route;
- attempt to reuse the same driver or vehicle for another active route on the same date.

### Automated verification

From `services/waste-service`, with the project PostgreSQL service running:

```bash
node -r ts-node/register/transpile-only scripts/test-stabilization.cjs --finance --access --onboarding --workspace --ownership --provider-requests --customer-stops
```

The added checks create temporary fixtures inside the suite transaction and roll them back at the end. They verify route creation, synchronized assignments, duplicate-allocation rejection, date rejection, maintenance rejection, and `is_routed` visibility.

## Verification state

- Waste service TypeScript check: passed.
- Admin frontend TypeScript check: passed.
- Admin frontend lint: passed.
- Integration suite: added, but this session could not execute it because PostgreSQL on `localhost:5434` was unavailable and the Docker daemon was not running. Run the command above after starting Docker Desktop and `docker compose up -d postgres` in `infrastructure/docker`.

This phase completes route-planning consistency. It does not claim that route dispatch, live execution, GPS routing, proof of service, or route reconciliation are fully complete; those remain separate operational increments.
