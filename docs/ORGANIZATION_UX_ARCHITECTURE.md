# Waste Organization System — Simplified Product Architecture

## Decision

The employee-facing operational concept is **Trip**.

Schedules, generated collection jobs, route-job joins, dispatch state changes and stop snapshots may remain internal implementation concepts, but they must not be separate steps in the normal employee journey.

The operating model is:

`Division → Zone → Service route → Customers → Trip → Collection outcomes`

## Existing-system audit

### What can be reused

- `kampala_divisions` provides the regulated division register.
- `waste_zones` already belongs to a division and an accountable organization.
- `customer_service_locations` already stores address and GPS coordinates.
- Customer-provider relationships, contracts and subscriptions already provide eligibility checks.
- Trucks, drivers, GPS events and fleet availability already exist.
- `collection_routes` already provides most of the dated execution record required for a trip.
- `customer_collection_stops` already records customer-level progress, timestamps, proof and exceptions.
- Route start, stop arrival, customer completion and live-location APIs can be reused behind a simpler trip API.

### What currently causes confusion

1. The company sidebar exposes too many peer modules and separates closely related daily work.
2. Daily Operations exposes schedules, jobs, assignments, routes and dispatch as employee actions.
3. A `collection_route` is a dated execution record, not a reusable service route.
4. Customers are assigned to a zone but not to a persistent route.
5. Customer stops are generated from area jobs after planning instead of loading automatically when a route is selected.
6. Driver, vehicle and job information can be entered more than once during the same planning flow.
7. Supervisors and helpers are not first-class members of a trip team.
8. Driver and manager screens use both “route” and “job” for work that employees understand as one trip.
9. Trip completion is partly implicit; the user does not receive a clear final review and completion action.
10. Setup records and daily work are mixed on one page.

## Product information architecture

### Company administrator

- Dashboard
- Operations
  - Today
  - Trip history
- Customers
  - Customers
  - Contracts
- Service areas
  - Divisions
  - Zones
  - Routes
- Fleet
  - Vehicles
  - Drivers
  - Maintenance
- Staff
- Finance
- Reports
- Settings

Administration-only pages such as roles, integrations, payroll configuration, procurement and inventory remain available through their parent module rather than appearing as equal daily-work destinations.

### Operations manager

- Dashboard
- Operations
- Customers
- Service areas
- Fleet
- Reports

### Supervisor

- Today
- Trips
- Team
- Issues
- Reports

### Driver

- Today
- Trip history
- Notifications
- Profile

### Finance employee

- Dashboard
- Billing
- Payments
- Expenses
- Reports

## Required domain additions

### Reusable service route

Add `service_routes` as a configuration record:

- organization
- division
- zone
- route name/code
- optional default vehicle
- optional default driver
- optional default supervisor
- active status
- estimated duration and distance
- optional route geometry

Add `service_route_customers` to assign service locations to a route with a stable stop order. A service location can have one active route assignment for the same provider.

This route is the operational backbone and is created occasionally.

### Trip

Keep `collection_routes` as the execution storage initially, but expose it as a **Trip**. Add:

- `service_route_id`
- `supervisor_user_id`
- trip number
- planned start time
- created/dispatched by
- optional completion review

Add `trip_team_members` for optional helpers and loaders.

Customer stops are snapshots. Changing a route after a trip has started must not silently rewrite that trip's historical customer list.

## Create Trip transaction

One employee action performs the existing internal work:

1. Select division.
2. Show only zones inside that division authorized for the organization.
3. Select a reusable route.
4. Load the route's active, contract-valid and subscription-valid customers automatically.
5. Select available truck, driver and supervisor; show defaults first.
6. Validate crew and vehicle availability for the trip time.
7. Show one confirmation summary.
8. Create the dated trip, internal jobs/joins where still required, and customer-stop snapshots in one database transaction.
9. Start immediately or save as not started.

The user never manually generates customer stops or separately assigns the same driver and truck to jobs.

## Trip states and natural language

| Stored/internal state | Employee label | Primary action |
| --- | --- | --- |
| planned | Not started | Start trip |
| dispatched | Ready to start | Start trip |
| in_progress | In progress | Open trip |
| completed | Completed | View summary |
| cancelled | Cancelled | View details |

Customer stop states:

| Stored state | Employee label |
| --- | --- |
| pending / arrived | Next or pending |
| completed | Collected |
| skipped | Not collected |
| cancelled | Removed from trip |

## Employee-facing APIs

Introduce a task-oriented facade while retaining existing endpoints during migration:

- `GET /api/waste/operations/today`
- `GET /api/waste/service-routes`
- `GET /api/waste/service-routes/:id/customers`
- `POST /api/waste/trips`
- `GET /api/waste/trips`
- `GET /api/waste/trips/:id`
- `PATCH /api/waste/trips/:id/start`
- `PATCH /api/waste/trips/:id/complete`
- `PATCH /api/waste/trips/:id/cancel`
- `PATCH /api/waste/trip-stops/:id/collected`
- `PATCH /api/waste/trip-stops/:id/not-collected`

The facade owns transaction boundaries, eligibility validation and natural error messages. Existing collection job and route APIs remain internal until all consumers migrate.

## Screen structure

### Operations — Today

The page header contains the date and one primary action: **Create trip**.

The first compact summary answers:

- trips today
- not started
- in progress
- completed
- customers scheduled
- collected
- not collected

Below it, one table shows today's trips. The default sort is in progress, ready, not started, completed. Selecting a row opens the trip workspace.

Schedules, jobs, route generation and assignment tabs are removed from this screen.

### Create Trip

Use one focused four-step flow in a side panel or dedicated page:

1. Area — division, zone, route
2. Team — truck, driver, supervisor, optional helpers
3. Review — route, customer count and readiness warnings
4. Create — save as not started or start trip

Do not use a long form. Preserve choices when moving backward.

### Trip workspace

Keep the trip identity, status, progress and primary action visible at the top. Use a table for customers with address, status and one contextual action. Exceptions use a short reason selector, optional note and optional proof.

The final action is **Complete trip**. It opens a short review showing collected and not-collected totals before confirmation. Completion creates an immutable summary for management and compliance reporting.

### Setup pages

Service Areas owns division, zone and reusable route configuration. Customers owns customer-to-route assignment. Fleet owns vehicle, driver and maintenance configuration. None of these forms appear inside the Today screen.

## Validation and safeguards

- Only KCCA-authorized divisions and organization-owned zones are selectable.
- Only active, eligible customer service locations appear in a trip.
- A truck or driver cannot be committed to overlapping active trips.
- A supervisor must belong to the same organization and have operational permission.
- A trip cannot start with zero eligible customers.
- A trip cannot complete while a customer stop is unresolved.
- “Could not collect” requires a reason; notes and proof remain optional.
- Completed trips and collection outcomes are append-only operational records.
- Customer receipt generation and KCCA reporting must consume completed customer-stop records, not editable planning data.

## Delivery sequence

1. Add reusable service-route and route-customer schema.
2. Add service-route management APIs and customer assignment.
3. Add transactional Trip API over the existing execution tables.
4. Replace Daily Operations with Today, Create Trip and Trip History.
5. Simplify the driver workspace around the current trip and next customer.
6. Add explicit trip completion and immutable summary.
7. Reduce and role-filter company navigation.
8. Connect completed customer stops to electronic receipts, billing and KCCA reporting.
9. Remove old employee-facing schedule/job controls after migration tests pass.

## Acceptance test

A newly trained dispatcher must be able to:

1. Sign in.
2. Open Today.
3. Create and start a trip by selecting area, route and team.
4. See the automatically loaded customers.
5. Follow the active trip without opening another module.

A driver must be able to complete or mark each customer as not collected, then complete the trip, without seeing jobs, generated assignments or configuration modules.
