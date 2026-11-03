# KWMS — GPS data completeness and driver records

Concept note KWMS-CN-001-2026, module 2 (fleet and GPS tracking, "driver performance tracking") and the Phase 1
acceptance target "no data gaps > 5 minutes". Migration **120**.

## Purpose limits

The location notice drivers agreed to (114, version 1) gives three reasons for collecting positions:
- dispatch and support
- showing households when collection is near
- showing KCCA that waste reached a licensed disposal site

It does not name rating drivers or monitoring their speed, and the Data Protection and Privacy Act 2019 limits data
to the purposes stated. So:

- **GPS completeness describes the data, not the driver.** It is reported per trip, vehicle and operator.
- **Driver records use collection and disposal records only:** stops, receipts and weighbridge tickets, with no
  positions or speed.
- **Using GPS for driver rating or speeding** needs KCCA to publish a new notice version that names that purpose.
  Every driver's sharing then pauses until they agree again (114). This is a decision for KCCA and the operators, not a
  code change.

## GPS completeness

- **What is stored.** Each trip that has ended is summarised in `trip_gps_quality`:

  | Field | Meaning |
  |---|---|
  | `trip_minutes` | trip length, from start to completion or cancellation |
  | `points` | positions received |
  | `gaps` | stretches over 5 minutes without a position, including before the first and after the last |
  | gap minutes, longest gap | the total time and the longest stretch in those gaps |
  | `coverage_pct` | the share of the trip outside those gaps |

- **Sharing state:**
  - `shared`: positions were received.
  - `not_shared`: the driver had not agreed to location sharing when the trip started. This is not counted as a gap
    and is left out of the percentages.
  - `no_points`: the driver had agreed but nothing arrived, for example because the phone was off or had no data.
    This counts as one gap covering the whole trip.
- **When summaries are made.** The scheduler summarises trips hourly (`refresh_trip_gps_quality`). A trip is
  summarised again while it ended in the last two days, and once otherwise. Summaries stay after positions are
  deleted under the retention period. The migration summarises trips that had already ended.
- **Time zones.** Trip times are stored without a time zone, written as UTC, and the function reads them as UTC
  explicitly.

## Screens

**GPS and driver records** (`/dashboard/fleet-quality`) appears for the company admin (*Service delivery*; fleet
package) and the supervisor (*Operations*). It shows:
- **Totals:** trips with no gap over 5 minutes (the pilot target), average coverage, the longest gap, and trips
  without sharing.
- **By vehicle**, and the trips with gaps, worst first.
- **Drivers:** trips completed and cancelled; collections done and missed on the driver's jobs, with the most common
  reason; completed trips weighed at a KCCA weighbridge; receipts.

**GPS data completeness** is the same page for KCCA (*City oversight*) and system admin (*Reference*), by operator and
without driver records.

| Endpoint | Who |
|---|---|
| `GET /api/waste/fleet/gps-quality?from&to` (up to 3 months) | company admin, supervisor (own); KCCA, system admin (city) |
| `GET /api/waste/fleet/driver-scorecards?from&to` | company admin, supervisor |

## Not covered yet

- Geofence alerts (a truck leaving its service area). Track checks (102) already flag stops off route and disposal
  site visits after a trip.
- Telling the cause of a gap apart (signal, battery, app closed). The page lists the common causes.
- Positions from trackers fitted to trucks (121) are summarised the same way as positions from phones.
