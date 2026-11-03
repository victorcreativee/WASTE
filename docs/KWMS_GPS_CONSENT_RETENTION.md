# KWMS — GPS consent and retention

Concept note KWMS-CN-001-2026, data governance: GPS data consent at driver onboarding and retention schedules
compliant with Uganda's Data Protection and Privacy Act 2019. Migration 114.

## What is collected

Drivers' phones send a position about every 15 seconds only while they have a trip in progress, and until the load is
weighed (`POST /api/waste/fleet/live/location`, already limited to the driver's own active trip). Each position has
location, accuracy, speed, direction and time, and is stored in `vehicle_location_events`.

## Consent

- **Notice.** KCCA publishes the location notice drivers read (`gps_privacy_notices`, versioned, cannot be edited).
  Version 1 explains what is collected and when, why, who sees it, how long it is kept, and the driver's rights to
  see and download their data and to withdraw. The retention period is shown under it.
- **Answer.** In the driver app (*Today's route*), a driver who has not answered sees the notice and chooses *Allow
  during trips* or *Not now*. Afterwards a short line shows that sharing is on or off, with *Download my data*, *Read
  notice* and *Turn off* / *Turn on*. Every answer is kept (`gps_consents`, append-only) with time, notice version,
  IP address and device.
- **Enforced by the database.** A trigger refuses any position from a driver whose latest answer is not a yes to the
  newest notice. The app only starts sharing after a yes, and the API answers 403 with an explanation otherwise.
  Positions from a tracker with no driver attached are not affected.
- **New version.** When KCCA publishes a new version (with a summary of what changed), every driver's sharing pauses
  until they answer again, and drivers get a notification.
- **Withdrawing** stops sharing from then on. It does not delete positions already recorded; those follow the
  retention period. A driver who has not agreed simply has no live position or disposal track on their trips.

## Retention

- **Period.** KCCA sets how long individual positions are kept for every operator: default 90 days, between 30 days
  (disposal track checks look back 3 days, and disputes need time) and 2 years.
- **Deletion.** Once a day the scheduler deletes positions older than the period, in batches
  (`purge_expired_gps_points`), and records each run (`gps_retention_runs`: cutoff, deleted, kept on hold). KCCA can
  also run it from the page. What stays: each trip's track-check summary (`trip_track_checks`: point count, first and
  last point, disposal site visit, stops), receipts and the trip record.
- **Holds.** A trip under investigation (penalty appeal, dumping report, dispute) can be put on hold by trip number,
  with a reason, by KCCA or by the company that ran it. Its positions are kept until the hold is released with a note.
  A company cannot release a hold KCCA placed.

## Screens and API

- **GPS data protection** — KCCA (*Regulation*), system admin (*Reference*), company admin (*Administration*):
  retention period, positions stored, drivers who agreed, last deletion run; consent by operator (KCCA) or by driver
  (company); trips on hold; notice versions; deletion runs (KCCA). KCCA changes the period, publishes notices and runs
  the deletion.
- Driver: `GET /api/waste/privacy/gps/mine`, `POST /api/waste/privacy/gps/consent`, `GET /api/waste/privacy/gps/mine/export` (CSV of every stored position).
- `GET /api/waste/privacy/gps/notice`, `GET /api/waste/privacy/gps/overview`,
  `PUT /api/waste/privacy/gps/retention`, `POST /api/waste/privacy/gps/notices`, `POST /api/waste/privacy/gps/retention/run` (KCCA),
  `POST /api/waste/privacy/gps/holds`, `POST /api/waste/privacy/gps/holds/:id/release` (KCCA, company admin).
- Consents and holds are isolated per company (migration 113); notices, the retention setting and holds are in the
  audit log.

## Before going live

- **Every current driver must answer before their location is shared again.** Tell operators before deploying, so
  drivers open the driver app and answer at the start of their next shift; until they do, their trips have no live
  position and the disposal check reports no GPS track.
- KCCA should review the notice text (version 1 is a reasonable starting point, not legal advice) and confirm the
  retention period with its data protection officer, then publish its own version if needed.
- The first daily deletion run removes all positions older than 90 days.

## Not covered yet

- The Expo mobile app (`apps/recycling-mobile`) has no consent screen; its *Share location* button shows the server's
  refusal and asks the driver to answer in the driver app.
- Other one-off locations (household service locations, recycling purchase points, dumping reports) are not trip
  tracking and are not covered by this schedule.
- Hardware trackers (MQTT) are not built yet; when they are, positions without a driver are accepted, and a driver
  assignment on the vehicle would bring them under the same consent rule.
