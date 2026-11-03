# KWMS — Constituency dashboards

Concept note KWMS-CN-001-2026, module 6: constituency-level dashboards and operator KPI scorecards. Read-only over
existing data; nothing in recycling changes. Migration **118**.

## How households are placed in a constituency

- **The constituencies.** Kampala's nine parliamentary constituencies are seeded under their divisions
  (`kampala_constituencies`):
  - Kampala Central Division
  - Kawempe North and South
  - Makindye East and West
  - Nakawa East and West
  - Rubaga North and South
- **Areas make up constituencies.** Each area of the catalogue (`kampala_division_areas`, the 91 named places from
  migration 044) belongs to one constituency of its own division. A database trigger refuses any other assignment.
  Household service locations already record their area, so a household is counted in its area's constituency.
- **Assigning areas.**
  - Central Division is a single constituency, so its 14 areas are assigned by the migration.
  - KCCA assigns the other divisions' 77 areas on the page (*Assign areas*). Parish boundaries vary by source, so the
    platform does not guess them.
  - Each assignment is recorded with who made it and when, and goes to the audit log.
- **Not yet assigned.** Until an area is assigned, its households are counted on a "*division*, areas not assigned"
  row, and households without an area on "No area recorded". The rows always add up to the city.
- **Always current.** Figures are calculated when the page loads, so assigning an area also moves its past
  collections and bills.

## What KCCA sees

**City oversight → Constituencies** (`/dashboard/constituencies`) is for KCCA; system administrators see it under
*Reference*, read-only. Pick a date range (30 days by default).

City totals at the top, then one row per constituency:

| Figure | Meaning |
|---|---|
| Households | service locations with an active operator |
| Operators | companies serving at least one of those households |
| Collections done | completed stops of those due in the period (amber below 85%) |
| Missed | stops skipped, or still open after their day |
| Receipts | receipts issued in the period (voided ones left out), with the weight on them |
| Bills paid | the share of bills issued in the period that has been paid (amber below 70%) |
| Overdue | what households in the constituency owe past the due date today (from the arrears view, 117) |
| Areas served | areas with at least one household an operator serves; the rest are coverage gaps |

**Open** shows a constituency's:
- **operator scorecards:** households, collections done, missed and receipts for each company, counting only that
  company's households there
- **areas:** the same figures by area, with areas nobody serves marked

A household's bills and payments count at its primary service location.

## API

| Endpoint | Who |
|---|---|
| `GET /api/waste/constituencies?from&to` | KCCA, system admin |
| `GET /api/waste/constituencies/:idOrCode?from&to` | KCCA, system admin |
| `GET /api/waste/constituencies/areas` | KCCA, system admin |
| `PUT /api/waste/constituencies/areas/:areaId` `{ constituencyId \| null }` | KCCA |

## Before going live

- KCCA assigns the 77 areas outside Central Division to constituencies, using its own parish list.
- Older household locations may have no area recorded. They show under "No area recorded"; companies can set the area
  on the household's location.

## Not covered yet

- Citizen reports and illegal dumping sites record a point or a division, not an area, so they are not counted per
  constituency.
- Weighbridge tonnage belongs to trips, not households. The dashboard uses the weight on receipts instead.
- A map of constituencies needs boundary polygons, which the area catalogue does not have.
