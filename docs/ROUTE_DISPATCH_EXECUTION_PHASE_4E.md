# Phase 4E — controlled route dispatch and execution

Completed 6 September 2026.

## Outcome

Planned work now follows one guarded operational lifecycle:

`planned → dispatched → in progress → completed`

An organization supervisor dispatches a ready route. Only its assigned driver can start it. Ordered stop execution updates the linked collection job, and completing the final resolved stop completes the route. Driver and vehicle availability is then released only when no other active work still depends on them.

## Operations workflow

1. Build a route in **Dispatch & collections → Routes**.
2. Review its date, driver, vehicle, and number of jobs.
3. Select **Dispatch**. The system revalidates operational readiness at that moment.
4. The assigned driver opens **Driver mobile** and starts the dispatched route.
5. The driver processes stops in order. Household stops must be completed, skipped with a reason, or cancelled before the area stop can complete.
6. The final completed route stop closes its collection job and route together.

## Dispatch safeguards

- Only company administrators and supervisors can dispatch.
- Cross-organization dispatch returns not found without exposing private route data.
- Only a planned, current-or-future route with at least one job can be dispatched.
- Every job must match the route date, driver, and vehicle and remain pending/assigned.
- Vehicle status and document expiry are rechecked at dispatch time.
- Driver status is rechecked at dispatch time.
- Dispatch reserves the driver and vehicle by setting their status to assigned.
- Drivers can start only a dispatched route assigned to their own account.
- Route completion releases a driver or vehicle only when no other dispatched/in-progress route or assigned/in-progress job needs it.

## Manual test

1. Create a route for today with one open job and an available crew.
2. Log into the assigned driver account in a separate browser profile. Confirm **Start route** is unavailable or rejected while the route is still planned.
3. As the company administrator, select **Dispatch** in the route table.
4. Return to the driver session and start the route.
5. Record arrival, resolve any household stops, and complete the area stop.
6. Confirm the job and route show completed.
7. Confirm the vehicle becomes available when it has no other active work.

Negative checks should include a maintenance vehicle, off-duty driver, expired document, past route, empty route, mismatched job assignment, foreign organization, and a driver other than the assigned driver.

## Automated coverage

The customer-stop regression module now covers pre-dispatch start rejection, tenant isolation, dispatch, assigned-driver enforcement, ordered arrival, final route completion, and safe vehicle release. The suite remains transaction-based and rolls fixtures back.

The integration suite requires PostgreSQL at `localhost:5434`. It was not executable during this session because both PostgreSQL and the Docker daemon were stopped. Static service/frontend checks remain mandatory until it is run.

## Remaining work

This increment does not yet add supervisor cancellation/recovery, skipped area-stop handling, live GPS telemetry, route deviation alerts, or historical execution reconciliation. Those remain explicit later phases.
