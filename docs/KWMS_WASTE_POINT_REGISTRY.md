# KWMS Module 1 — Waste point registry

Concept note KWMS-CN-001-2026, module 1: "GIS mapping, profiling, and database management of all waste generation
points — households, businesses, institutions", giving a verified, geocoded database of every collection point, service
history per client and tariff tier classification. Phase 1 target: 200+ points registered. Migration **119**.

A collection point is a customer's service location (`customer_service_locations`). Nothing in recycling changes.

## What each point gets

- **Registry number** `KWP-<division>-<sequence>` (e.g. `KWP-CEN-000001`). It is given when the point is created,
  never reused, and existing points were numbered oldest first. Points with no division use `KLA`.
- **Kind of point:**
  - household, shop, market stall, market, restaurant, hotel
  - office, school, health facility, place of worship, government
  - factory, construction, other

  Existing points get *household*, *factory* or *office* from the customer type where that is unambiguous; commercial
  customers need a kind chosen.
- **Estimated waste** in kg a week. This is optional.
- **Verified on site.**
  - Staff at the point take a GPS fix with a phone. It must be inside Greater Kampala and accurate to 50 m.
  - The fix becomes the point's position, with who verified it, when, the accuracy, how far the point moved and an
    optional note.
  - If the position is later moved more than 50 m without a new visit, the verification is cleared.
  - Every verification is in the audit log.

## Registry view

`waste_point_registry` (row-level security applies) adds to each point:
- the operator serving it
- its area, division and constituency (118)
- its active plan and KCCA tariff band
- the last completed collection
- `tariff_mismatch`: the plan's customer type is not the one the kind of point is normally billed as:

| Kind | Expected customer type |
|---|---|
| household | residential |
| shop, market stall, market, restaurant, hotel | commercial |
| office, school, health facility, place of worship, government | office and institution |
| factory, construction | industrial |
| other | any |

## Screens

**Waste point registry** (`/dashboard/registry`) appears in these menus:
- Company admin: *People & customers*
- Supervisor: *Customers*
- KCCA: *City oversight*
- System admin: *Reference*

The page shows:
- **Totals:** points registered, the share verified on site, estimated waste a week, and points needing attention.
- **Breakdowns:** points by kind, and by division (city-wide view).
- **Filters:** not verified, tariff does not fit, no kind, no area, not collected in 30 days, verified. You can also
  search by number, name, address or area.
- **One point:**
  - operator, place, plan and tariff (with the mismatch explained), bills and position
  - the last 30 scheduled collections, and the latest receipts
  - for companies, setting the kind and estimate, and *Verify on site*

KCCA reads the whole city but does not edit or verify points.

| Endpoint | Who |
|---|---|
| `GET /api/waste/registry/summary`, `GET /registry/points?status&category&search&page&pageSize`, `GET /registry/points/:id` | company admin, supervisor (own points); KCCA, system admin (city) |
| `PATCH /api/waste/registry/points/:id` `{ pointCategory?, estimatedKgWeek? }` | company admin, supervisor |
| `POST /api/waste/registry/points/:id/verify` `{ latitude, longitude, accuracyM ≤ 50, note? }` | company admin, supervisor |

## Not covered yet

- Points that are not customers yet (for example a KCCA enumeration of unserved markets) have no place in the registry.
  It only holds service locations.
- The Expo driver app does not verify points; verification is done in the web app on a phone's browser.
- Bulk import of point kinds and estimates from a spreadsheet.
