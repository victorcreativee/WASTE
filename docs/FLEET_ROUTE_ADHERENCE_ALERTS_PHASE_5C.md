# Fleet route adherence and live exception triage — Phase 5C

## Outcome

Fleet control now converts verified vehicle telemetry into a small set of operational warnings. The map remains the live spatial view; a compact table underneath is the work queue for exceptions.

## Warning rules

- **Missing signal:** an active dispatched or in-progress route has never reported, or its latest verified signal is older than five minutes.
- **Off route:** a signal received within five minutes, with reported accuracy of 100 metres or better, is more than 500 metres from the assigned route geometry.
- **Stopped too long:** an in-progress route has at least three signals with measured speed in the last ten minutes and none reports movement above 2 km/h.

These checks deliberately avoid warnings when route geometry or trustworthy accuracy is unavailable. Signal freshness is returned by the API as `current`, `delayed`, `stale`, or `never` so every client uses the same definition.

## Operator workflow

1. Open **Fleet control**.
2. Red vehicle signals indicate a verified exception; ordinary signal colours still communicate freshness.
3. Review **Vehicles needing attention** for the vehicle, warning, route, driver and last signal.
4. Select **Inspect movement** to load the vehicle and its two-hour trail in the existing map detail panel.
5. Contact or redirect the responsible driver through the established dispatch workflow. This phase does not invent a resolution when the system has no evidence.

## Access and integrity

- Company administrators and supervisors receive warnings only for their organization.
- KCCA and system administrators retain read-only city-wide monitoring.
- Alert calculations use the same assigned active route and GPS history already protected by the live-fleet endpoints.
- A regression fixture verifies that a recent accurate position more than 500 metres from its route is reported as off route.

## Verification

- Waste-service TypeScript check passes.
- Admin-web ESLint passes.
- Admin-web production build and its TypeScript stage pass.
- `git diff --check` passes.
- Database-backed regression execution still requires the local PostgreSQL service and migration 032 to be running.
