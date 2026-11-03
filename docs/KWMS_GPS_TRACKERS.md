# KWMS — GPS trackers on trucks

Concept note KWMS-CN-001-2026, module 2 (fleet and GPS tracking): input from GPS tracker hardware alongside the driver
app. Migration **121**. Nothing in recycling changes.

## What it does

A company registers a tracker against one of its trucks and gets a **device key** (`kwt_<id>_<secret>`) once. KWMS
keeps only a hash of it. The tracker sends positions to:

```
GET or POST /api/v1/trackers/osmand
```

This is the OsmAnd protocol, with the device key as the device identifier. It works with:
- the Traccar Client app, for example on a phone fixed in the cab
- trackers that send OsmAnd over HTTP
- a Traccar server that forwards positions from trackers with their own protocols (Teltonika, Concox)

Both forms are read:
- **Query or form fields:** `id, lat, lon, timestamp` (unix seconds, milliseconds or ISO), `speed` in knots, `bearing`
  and `accuracy`.
- **JSON body:** what newer Traccar Client versions send, `device_id` and `location.coords`, with speed in metres a
  second.

## Which positions are kept

`kwms_record_tracker_position` checks the key and files the position. It answers with one of these results:

| Result | When |
|---|---|
| `stored` | the truck was on a trip at that moment, and the position is kept under that trip and its driver |
| `no_trip` | the truck was not on a trip. A trip runs from its start until its load is weighed, at most six hours after completion; a cancelled trip runs until it was cancelled |
| `no_consent` | the trip's driver had not agreed to the location notice (114), or has no app account and so could not agree. A trip with no driver assigned is recorded |
| `duplicate` | a position for the truck is already kept within 10 seconds, for example from the driver's phone |
| `rejected` | outside Greater Kampala, more than 2 minutes in the future, or more than 24 hours old |
| `unknown_key` | the key is wrong, the tracker was retired, or the company is inactive (HTTP 401) |

- **Answers.** Every result except `unknown_key` is answered with HTTP 200, so a tracker does not keep resending a
  position that was deliberately not kept.
- **Buffered positions.** Positions sent late, after the tracker regains signal, are accepted for 24 hours. They fill
  the gaps counted in 120, because summaries are refreshed for two days after a trip ends.
- **Live map.** Only a position from the last five minutes moves the truck on the live map.
- **Limits.** Each tracker may send 120 positions a minute. An address sending 20 invalid keys a minute is refused for
  the rest of that minute.

Positions from trackers are stored with `source = 'vehicle_tracker'`. They follow the same retention (114), track
checks (102) and GPS completeness summaries (120) as positions from phones.

## Screens

**GPS trackers** (`/dashboard/trackers`) appears for:
- the company admin (*Service delivery*, fleet package), who can register and retire trackers
- the supervisor (*Operations*), who can view them

The page shows the setup values (server URL, device identifier, interval) and each tracker with:
- when it was last heard and what happened to its last position (amber after 15 minutes of silence)
- positions kept today, positions not kept today with the reasons, and positions kept in the last 7 days

Each truck has at most one working tracker. A tracker cannot be moved or rekeyed: retire it and register it again.
Registrations and retirements are in the audit log.

| Endpoint | Who |
|---|---|
| `GET /api/waste/fleet/trackers` | company admin, supervisor |
| `POST /api/waste/fleet/trackers` `{ truckId, label, serialNumber? }` | company admin |
| `POST /api/waste/fleet/trackers/:id/retire` `{ reason }` | company admin |
| `GET/POST /api/v1/trackers/osmand` | trackers, with their device key |

## Not covered yet

- Trackers' own binary protocols (Teltonika Codec 8, Concox GT06) and MQTT. These need a gateway such as Traccar
  in front of KWMS.
- Fuel, ignition and battery readings that trackers send are ignored.
- KCCA does not see trackers. Positions from trackers count in its GPS completeness figures like any others.
