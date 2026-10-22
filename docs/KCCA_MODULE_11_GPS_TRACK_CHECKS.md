# Module 11: GPS track checks

Delivered 22 October 2026. Compares each completed collection trip's GPS track with the disposal facilities and with its
KCCA weighbridge ticket, so KCCA can see whether trucks really took their loads to a facility. Builds on the live fleet
tracking (migration 032) and Modules 8 and 10; migration **102**.

## Closing a gap first: tracking the disposal leg

The driver app shared location only while a trip was *in progress*. The drive to the landfill usually happens after the
last pickup, when the trip is already completed, so that leg was never recorded. Now:

- the server accepts a driver's location for a trip completed in the last **6 hours** until a completed KCCA ticket is
  linked to it;
- the driver's trip screen keeps sharing during that time and tells the driver to keep it open until the truck is weighed.

## What is checked

Once a trip's disposal leg is over (6 hours after completion), the checker reads the truck's GPS points from 30 minutes
before the trip started to 6 hours after it ended (points less accurate than 150 m are ignored) and gives the trip one
result:

| Result | Meaning |
|---|---|
| **Reached a facility** | The track entered a disposal facility's area, and agrees with the ticket if there is one. |
| **No GPS track** | Fewer than 5 points: sharing was off or the phone was offline. Shown as coverage, not as a fault. |
| **Never reached a facility** | The track never entered any facility's area. |
| **GPS contradicts ticket** | Within 20 minutes of the ticket's arrival time, every GPS point was more than 2 km (or three times the facility radius, if larger) from that facility. |

**Long stops** are also recorded: the truck staying within 75 m for 30 minutes or more, away from facilities. A stop is
**off route** when it is more than 500 m from the planned route line (only judged when the route has a line).

Checks run hourly with the other scheduled checks. Trips from the last 3 days are checked again, because phones that were
offline send their points later; KCCA can also check a trip again on demand. Only trips on service routes from the
disposal start date (Module 8) are checked.

Rules live in `services/waste-service/src/services/track.rules.ts` (`TRACK_RULES`). **KCCA should confirm the 6-hour
disposal leg, the 20-minute and 2 km ticket test, the 30-minute stop and the 500 m off-route distance.**

## Facility areas

A facility needs a location before trips can be checked against it. **No coordinates are seeded: KCCA must set the
location of Kiteezi, Buyala and any other facility** on the GPS track checks page (click the gate or weighbridge on the
map, choose the radius, 50–3,000 m, default 300 m). Until at least one facility has a location, no trips are checked, and
the page says so.

## Who sees what

| Role | Gets |
|---|---|
| **KCCA** | *GPS track checks* (City oversight): trips checked and not yet checked, GPS coverage, share of tracked trips that reached a facility, trips that never did, tickets the GPS contradicts, off-route stops; a table per collector; work lists by result; a map for each trip with the track, the planned route, facility areas (the ticket's facility in blue) and long stops; *Check again*; *Issue penalty* (unverified disposal, grounds prefilled); facility locations. |
| **Collector admin and supervisor** | A *GPS checks* tab in *Disposal records* with their own trips to explain and the same map. |
| **Driver** | Keeps sharing location after completing a trip until it is weighed, with a note on the trip screen. |

## Notifications

In the existing **Disposal** category: KCCA admins when a track contradicts a ticket (once per trip), and the company
administrators once a day when trips never reached a facility or contradict their ticket.

## Database — migration 102 (`infrastructure/database/102_trip_track_checks.sql`)

Additive and idempotent; requires 092–101.

- `disposal_facilities.location` and `radius_m` (50–3,000 m).
- `trip_track_checks`: one result per trip (result, number of points, first and last point, facility reached and when,
  ticket and its distance from the GPS, long stops as JSON, off-route stops, longest stop, the window read, when checked).
- An index on `vehicle_location_events(truck_id, recorded_at)` for reading a truck's track.

```bash
cd services/waste-service
npm run migrate:track-checks:check
npm run migrate:track-checks
```

## API (under `/api/waste`)

| Method and path | Who |
|---|---|
| `GET /tracks/facilities` | KCCA, system admin, weighbridge operator |
| `PUT /tracks/facilities/:code/location` | KCCA admin |
| `GET /tracks/overview`, `GET /tracks/checks` (`?view=exceptions|stops|<result>&organizationId=`), `GET /tracks/checks/:tripId` | KCCA; collector admin and supervisor for their own trips |
| `POST /tracks/checks/:tripId/recheck` | KCCA, system admin |
| `POST /tracks/run` | system admin |

## Verification

- Unit tests (`tests/track.test.ts`): distance, the four results, ticket contradiction and its absence without nearby
  points, stops (off route, unknown without a line, not at the facility, not under 30 minutes), the track window.
- `npm run test:e2e:tracks` (7 checks): facility location set only by KCCA within limits; five trips with real GPS points
  and weighbridge tickets giving each result and a 45-minute off-route stop, with the open trip not checked; KCCA notified
  once of the contradiction and one company digest; trip detail with track, facility and route line; late GPS data turning
  a trip consistent on recheck; drivers sharing location after completion until weighed; company isolation and KCCA
  coverage and consistency figures.
- Runs in `npm run release:check` and in CI; the fresh-database check includes the new table.
- Full `npm run release:check` passes:
  - **Build and tests:** 5 type checks; 7 + 137 unit tests; dependency audit; production build of **71** pages.
  - **Migrations:** **102** applied to a fresh database, 092–102 re-applied, new table present.
  - **End-to-end:** twelve suites, **158 checks**.
- Browser, with test data kept temporarily: KCCA overview, collector table, facility warning, and the map of a trip whose
  GPS contradicts its ticket. Test data removed afterwards.

## Not in this module

- GPS from vehicle trackers (telematics boxes): only the driver app's location is used.
- Snapping tracks to roads or estimating distance driven.
- Automatic penalties: KCCA decides, with the grounds prefilled.
- The driver app's new note was not tried on a phone; the server side is covered by the end-to-end suite.
