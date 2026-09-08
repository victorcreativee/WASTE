# Phase 5B — fleet movement history and signal triage

Completed 6 September 2026.

## Outcome

Fleet monitoring now supports investigation as well as current position. Selecting a vehicle loads its verified movement trail for a controlled period. Signal filters help operations distinguish current, delayed, stale and never-reporting vehicles without introducing decorative dashboard cards.

## Workflow

1. Open **Fleet control**.
2. Filter the map by signal freshness or refresh immediately.
3. Select a map marker. Vehicles without a first signal remain selectable from the waiting-signal list.
4. Review provider, driver, active route, last signal, speed and accuracy.
5. Choose a 30-minute, 2-hour, 8-hour or 24-hour trail.
6. The verified points appear as a blue movement line on the map.

## Controls and trust

- History is tenant-scoped for companies and city-wide only for KCCA/system oversight.
- A foreign company receives no movement points.
- Drivers can publish only after their assigned route is in progress.
- Client timestamps more than five minutes from receipt are rejected to reduce stale/future spoofed events.
- History queries are limited to 15–1,440 minutes and 2,000 points.
- Automatic refresh continues every 15 seconds, with a manual Refresh action.

These protections are an application-level foundation, not anti-tamper telematics. Production assurance still requires authenticated hardware/native-app device identity, secure background tracking, impossible-travel checks, retention policies and privacy governance.

## UI/UX review

- Map remains the dominant workspace.
- The live map uses a dark control-room presentation with a subtle coordinate grid, high-contrast telemetry trail, persistent vehicle plate/speed labels and pulsing current signals.
- The visual language remains data-bound: animation means a recent verified signal, not decoration, and reduced-motion preferences disable it.
- Filters and refresh sit together in the map header.
- Selected-vehicle facts and trail-period control stay in one narrow context panel.
- Never-reporting vehicles are not assigned fake coordinates but remain actionable.
- Signal language is human-readable and consistent with map colors.
- Company maintenance records stay below the map; KCCA sees monitoring only.

## Verification

Backend/frontend TypeScript, ESLint and whitespace checks passed. Regression coverage includes movement-history retrieval, company isolation and KCCA access. Migration 032 remains required and database execution is pending until local PostgreSQL is running.
