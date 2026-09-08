# Phase 4G — route history and operational review

Completed 6 September 2026.

## Outcome

The Routes workspace now supports day-to-day monitoring and later investigation without exposing a dense dashboard. Users can search, filter and paginate the same compact table, then open one structured route record containing operational status, area-job outcomes, customer-service completion, proof notes/evidence and cancellation history.

## UI/UX structure

- Search accepts route name, driver or vehicle.
- One status filter covers planned, dispatched, in-progress, completed and cancelled work.
- Result count and the shared pagination control behave consistently with customers, contracts, payroll, procurement and billing.
- The table keeps a predictable minimum width and horizontal scrolling on smaller screens instead of compressing content.
- The row action begins with **View**; state-changing actions remain visibly separate.
- Details open in a right-side panel so users keep the context of their filtered list.
- Information hierarchy follows the review task: current status first, service outcomes second, audit trail last.
- KCCA/system oversight uses the same read-only detail view without receiving company dispatch actions.

## Detail record

The route record shows:

- route date, assigned driver and vehicle;
- planned/dispatched/in-progress/completed/cancelled state;
- start and close timestamps;
- structured cancellation reason and operational note;
- ordered area jobs and their status/weight;
- resolved household-service count for each area job;
- completion notes or linked evidence;
- actor-attributed status-history records.

## API behavior

`GET /api/waste/driver-routes/:routeId` now returns cancellation metadata and `history` in addition to route stops and customer-stop summaries. Existing driver scoping and company/regulatory access boundaries remain in place.

## Verification

Waste-service TypeScript, admin frontend TypeScript, ESLint and whitespace validation passed. Migration 031 must be applied before loading history because it creates the history table and cancellation columns. Full PostgreSQL regression execution remains pending while the local Docker daemon/database is stopped.

## Test guide

1. Apply migration 031 and restart waste-service.
2. Open **Dispatch & collections → Routes**.
3. Search by route, driver and registration; verify the result count changes.
4. Filter each status and verify pagination resets to page one.
5. Select **View** on planned, active, completed and cancelled routes.
6. Confirm timestamps, job totals, customer outcomes and evidence match the execution records.
7. Cancel a fixture route, reopen it, and confirm the reason, note, actor and transition appear.
8. Log in as KCCA in a separate browser profile and confirm route details are visible but Dispatch/Cancel actions are absent.
