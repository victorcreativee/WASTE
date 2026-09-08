# Phase 4F — route cancellation and recovery

Completed 6 September 2026.

## Outcome

Company administrators and supervisors can cancel planned, dispatched, or in-progress routes without deleting operational history. The cancellation records the actor, prior state, structured reason, note, and timestamp. Completed work remains complete; unfinished work returns to the dispatch queue without its former crew assignment.

## User workflow

1. Open **Dispatch & collections → Routes**.
2. Find an open route and select **Cancel** in the right-aligned Action column.
3. Choose a reason and add a useful operational note.
4. Review the explanation of what will happen, then confirm **Cancel route**.
5. Replan the returned jobs on another route when a replacement crew is ready.

The cancellation form is a focused modal, not a permanent form repeated inside every table row. It uses explicit labels, a clear safe action (**Keep route**), and a visually distinct destructive action.

## Recovery rules

- Only company administrators and supervisors can cancel within their organization.
- Completed and already-cancelled routes cannot be cancelled again.
- Completed/skipped route work remains historical.
- Pending or arrived route-stop records become cancelled.
- Unfinished collection jobs return to pending and lose the cancelled route's driver and vehicle assignment.
- Pending/arrived household stops return to pending for replanning; completed/skipped outcomes remain untouched.
- Cancelled historical route membership no longer prevents a job from being placed on a replacement route.
- Vehicles and drivers become available only when no other active route or job still uses them.
- Every cancellation creates `collection_route_status_history` evidence.

## UI/UX review included

- The route table uses a stable seven-column hierarchy and a minimum width for predictable alignment.
- Status remains separate from actions.
- Primary **Dispatch** and secondary **Cancel** controls share one right-aligned action area.
- KCCA/system oversight accounts see view-only rows rather than unusable company actions.
- The confirmation explains consequences before the destructive action.
- Small, sentence-case content is used; no extra cards or duplicate navigation were introduced.

## Database migration

Migration `031_route_cancellation_recovery.sql` adds cancellation metadata, permits a cancelled route-stop state, and creates the append-only status-history table. Existing routes and jobs are not modified.

Apply locally from `services/waste-service`:

```bash
npm run migrate:route-recovery:check
npm run migrate:route-recovery
```

## Verification

Backend/frontend TypeScript, lint, script syntax, and whitespace checks passed. Regression coverage now includes cross-tenant denial, job recovery, assignment clearing, cancellation audit evidence, and replacement-route eligibility. PostgreSQL integration execution remains pending until Docker Desktop and the database on port 5434 are running.
