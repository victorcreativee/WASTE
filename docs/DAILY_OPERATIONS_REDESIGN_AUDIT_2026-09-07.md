# Daily operations and administrative hierarchy audit

## Product decision

The database concepts `pickup_schedules`, `collection_jobs`, `customer_collection_stops`, and `collection_routes` remain useful implementation records. They should no longer be presented as four unrelated tasks. The primary operator experience will become **Daily Collections**, where one guided review creates and dispatches the necessary records transactionally.

The intended hierarchy is:

`Platform Admin → KCCA regulatory approval → Organization activation → Organization setup → Daily operations`

KCCA approval authorizes operation. Only the Platform Admin activates an organization and creates its initial Organization Admin. Organization staff then control their own company.

## Current implementation findings

| Area | Useful implementation to preserve | Material gap |
|---|---|---|
| Platform/KCCA separation | Global roles and organization-scoped reads exist | KCCA could create organizations and issue onboarding; corrected in this phase |
| Permits | Organization records and status exist | No permit application, review checklist, document, renewal, suspension, or approval ledger exists |
| Divisions | GIS zones exist | No Kampala division master or organization-division authorization exists |
| Zones | Tenant-owned geometry and service assignment exist | Zone creation is currently reserved for KCCA/system; organization creation cannot safely open until division authorization is enforced |
| Staff | Memberships, organization roles, permissions, drivers, attendance and payroll exist | Operational permissions remain incomplete and supervisor is not an assignable daily-operation resource |
| Customers | Locations, provider relationships, packages, contracts and subscriptions exist | Customer locations are assigned to zones but not stable route templates |
| Schedules | Recurrence and 30-day idempotent job generation exist | Schedule has no route template, collection weekdays, preferred crew, capacity, or automatic worker |
| Jobs/stops | Eligibility-backed dated jobs and customer stops work | Operators see backend concepts and can still repeat manual planning actions |
| Routes | Safe driver/vehicle assignment, conflict checks, dispatch and execution work | `collection_routes` is a dated execution record, not a reusable geographical route; no supervisor assignment |
| Driver work | Assigned execution, ordered stops, exceptions and completion exist | Route-centric “next customer” guidance and optional evidence upload remain incomplete |
| Monitoring | Live GPS, trails, alerts and review audit exist | Escalated assistance assignment and supervisor-specific monitoring remain planned |
| Reporting | Route details and organization reports exist | No supervisor closure report or immutable automatic daily-operation summary exists |

## Concepts after redesign

1. **Service route** — reusable organization-owned path inside one authorized zone, with geometry and ordered customers.
2. **Collection schedule** — recurrence attached to a service route, with preferred resources.
3. **Daily collection** — dated execution instance with truck, driver, supervisor, customer stops, status, tracking and closure report.
4. **Exception** — the only routine item requiring manual intervention.

Existing `collection_routes` will become the daily-collection execution record rather than being discarded. A new service-route template will supply its area, map path, customer membership and defaults.

## Delivery sequence

### Phase A — regulatory geography foundation

- Permit applications, review states, requirements and audit history.
- Kampala division master data.
- KCCA organization-division authorization.
- Platform activation gated by approved permit.
- Organization zone creation constrained to authorized divisions.

### Phase B — reusable operational design

- Service-route templates belonging to zones.
- Customer-to-route assignment and collection order.
- Schedule weekdays, preferred truck, driver and supervisor.
- Dedicated operational permissions for dispatcher and supervisor.

### Phase C — Daily Collections workspace

- One guided **Create Daily Collection** workflow.
- Area → route → available vehicle → available team → automatic eligible customers → review and dispatch.
- Transactional creation of underlying job, stops, route assignment and audit record.
- Readiness and exception explanations before confirmation.

### Phase D — automatic preparation and closure

- Background planning worker with idempotency and organization timezone.
- “Ready” and “Needs attention” queues.
- Supervisor assignment, daily report and closure evidence.
- Automatic operation report shared with KCCA under explicit regulatory visibility.

## Non-negotiable safeguards

- Platform Admin does not run collections.
- KCCA cannot create organization accounts or manage private company staff/finance.
- Organizations cannot operate outside KCCA-authorized divisions.
- Drivers and vehicles cannot be double-booked.
- Customers load only from active relationship, contract, subscription, service date and route membership.
- Automation prepares work but does not silently dispatch unsafe or incomplete operations.
- Every privilege and lifecycle transition remains tenant-scoped and auditable.

## Change made during audit

Organization creation and first-administrator onboarding are now restricted to `system_admin` in both the API and UI. KCCA retains organization visibility but no longer receives the creation control.
