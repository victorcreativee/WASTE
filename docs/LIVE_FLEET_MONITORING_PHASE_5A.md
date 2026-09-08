# Phase 5A — live fleet monitoring foundation

Completed 6 September 2026.

## Outcome

The Fleet page now contains a real map-based monitoring workflow. Company administrators and supervisors see only their organization’s vehicles. KCCA and system administrators receive city-wide provider-fleet oversight without receiving company maintenance, cost or editing controls.

This is live operational data, not simulated movement. A marker appears only after the assigned driver starts a dispatched route, grants browser location permission and the driver workspace successfully publishes a verified signal.

## How it works

1. Company operations creates and dispatches a route with a driver and vehicle.
2. The assigned driver opens **Driver mobile**, starts the route and allows location access.
3. The browser watches device GPS and submits at most one update every 15 seconds.
4. The backend verifies the authenticated driver owns that dispatched/in-progress route before accepting the signal.
5. The event is retained as history and the vehicle’s latest location is updated transactionally.
6. Fleet monitoring refreshes every 15 seconds.

## Map experience

- Blue: signal no older than one minute.
- Amber: delayed signal between one and five minutes.
- Grey: stale signal older than five minutes.
- Selecting a marker shows provider, vehicle, driver, route, last signal, speed and GPS accuracy.
- Vehicles that have never reported are counted but are not placed at an invented map coordinate.
- Empty and connection states explain what must happen next.

## Access boundaries

- Company administrator/supervisor: live positions for their organization only.
- KCCA/system administrator: city-wide operational positions across providers.
- Driver: may publish only for a route assigned to their own driver account and only while dispatched/in progress.
- Citizen and unrelated roles: no access.
- City oversight does not expose company maintenance costs or management controls.

## Migration

Migration `032_vehicle_live_tracking.sql` creates append-only vehicle location events with spatial indexing. Existing vehicle records are preserved.

```bash
cd services/waste-service
npm run migrate:live-fleet:check
npm run migrate:live-fleet
```

## Testing guide

1. Use separate browser profiles for the company administrator, assigned driver and KCCA administrator.
2. Create a route for today, dispatch it and start it as the assigned driver.
3. Grant location permission in the driver browser. Keep that page open during the test.
4. Confirm **Live location sharing is active** appears in Driver mobile.
5. Open **Fleet control** as the company administrator and confirm the vehicle appears at the device position.
6. Select the marker and verify driver, route, signal time, speed and accuracy.
7. Open Fleet control as KCCA and confirm the provider name appears with the same vehicle.
8. Confirm another company cannot see the signal.
9. Disable browser location access and confirm the driver sees a useful blocked message; the map should age the last marker to amber and then grey rather than pretending it is current.

Location access normally requires `localhost` or HTTPS. Background updates can be restricted when a phone locks or the browser suspends the page; production-grade always-on tracking will require a native driver app or installed telematics device, authenticated device credentials, retention policies and WebSocket/SSE delivery. This phase intentionally does not claim those later capabilities.

## Verification

Backend/frontend TypeScript and ESLint passed. Integration coverage includes foreign-driver rejection, verified driver publishing, company isolation and KCCA visibility. Full database execution remains pending while the local Docker daemon/PostgreSQL service is stopped.
