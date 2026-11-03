# KWMS Module 5 — Landfill, tipping and carbon baseline

Concept note KWMS-CN-001-2026, module 5: dumpsite weight capture, waste composition recording, load certificate
generation and the landfill diversion calculation, as carbon baseline inputs (and module 6's carbon baseline
materialised views). Builds on weighbridge operations (046–050) and disposal verification (099). Migration **115**.

Weight capture already existed: KCCA weighbridge operators record gross and tare on every vehicle. This module adds
what happens to that weight afterwards. Nothing in the recycling screens or tables changes; recyclers' weighed
purchases are only read, as diversion.

## Load certificates

- Every **completed** weighbridge ticket gets a certificate from the database itself (`load_certificates`,
  `LC-YYYY-NNNNNN`), with a random check code such as `B8ED-8CEA-6473`. Tickets completed before the migration get
  theirs when it runs.
- The certificate records what the ticket says: operator, facility and its kind, vehicle, date, gross, tare, net, and a
  SHA-256 fingerprint of all of it. The app role can read certificates but cannot write or change them.
- **Voiding** the ticket revokes the certificate, with the void reason.
- **PDF**: one A4 page with the composition when recorded and a QR code. *Loads and certificates* on the landfill page
  opens it.
- **Public check**: the QR code opens `/l/<code>` (`GET /api/waste/public/load-certificates/:code`). The page shows
  the load as KCCA holds it now. A revoked certificate shows as revoked, and a record changed after issue shows as
  altered. No people, prices or customers are shown.

## Composition

KCCA (weighbridge operator or KCCA admin) records what a completed load contained, as a share of 12 streams: food and
organic, garden, paper, wood, textiles, nappies, plastics, glass, metal, inert, hazardous, other. Shares must add up
to 100%.

- *Visual estimate* at the tipping face, or *Sorted sample* with the sample weight.
- One composition per load (`load_compositions`). Changing it replaces it; the audit log keeps every earlier version.

Loads nobody recorded use the **assumed mix** of the current factor version. The page shows how much of the weighed
tonnage has a measured composition, overall and per operator. That share is the main quality figure for a carbon
baseline.

## Methane factors

KCCA publishes numbered versions (`carbon_factor_sets`, `carbon_factor_streams`). A published version can never be
changed, and publishing a new one recalculates the whole baseline.

Methane potential of one wet tonne = DOC × DOCf × MCF × F × 16/12 × (1 − OX) tonnes of CH₄. Multiply by the GWP for
tCO₂e.

Version 1 values:
- IPCC 2006 Vol. 5 defaults: DOC per stream (food 0.15, garden 0.20, paper 0.40, wood 0.43, textiles and nappies
  0.24, others 0), DOCf 0.5, F 0.5, OX 0.
- MCF 0.8, which is IPCC's value for an unmanaged deep site.
- GWP 28 (AR5).
- An assumed Kampala mix of 68% food and organic, 9% plastics, 7% garden, 6% paper and the rest smaller. This is a
  planning estimate, not a characterisation study.

These figures are the methane generation potential of the waste placed (mass balance, no time decay). They are
baseline inputs, not verified emission reductions. A carbon standard (VCS, Gold Standard, Article 6) applies its own
methodology, first-order decay and audit. The page says so.

## Carbon baseline

`carbon_baseline_monthly` is a materialised view with one row per Kampala month, operator, destination and stream.
Each row holds tonnes, measured tonnes, CH₄ and tCO₂e under the current factor version.

- **Disposal**: loads at landfills and transfer stations.
- **Diversion**:
  - loads at composting and materials-recovery facilities
  - recyclers' weighed purchases (`recycling_material_lots`, origin purchase, by catalogue category)
- **Diversion rate** = diverted ÷ (diverted + landfilled).
- **Recalculation**: daily by the scheduler, on demand by KCCA (*Recalculate now*), and on every factor publish. Each
  run is logged in `carbon_baseline_refreshes`.
- **Who sees what**: the app reads the view through `carbon_baseline`, which shows companies only their own rows (the
  same rule as migration 113). The materialised view itself is closed to the app role.
- **CSV** (`GET /api/waste/landfill/baseline/export?from=YYYY-MM&to=YYYY-MM`) has one line per month, operator,
  destination and stream, for NEMA and verifiers.

## Screens and API

**Landfill and carbon** (`/dashboard/landfill`) is in these menus:
- KCCA: *City oversight*
- System admin: *Reference*
- Collector admin and supervisor: *KCCA regulation*
- Weighbridge operator: *Load composition*

The page shows totals, months, streams, operators (city-wide roles only), loads and certificates with composition
entry, and the methane factors (KCCA publishes new versions).

| Endpoint | Who |
|---|---|
| `GET /landfill/streams`, `/landfill/overview?from&to` (months), `/landfill/loads?from&to&composition` | collector admin, supervisor, KCCA, system admin, weighbridge operator; companies see their own |
| `PUT /landfill/loads/:ticketId/composition` | weighbridge operator, KCCA |
| `GET /landfill/certificates/:id/pdf` | as above, own company only |
| `GET /landfill/baseline/export` | collector admin, KCCA, system admin |
| `POST /landfill/factors`, `POST /landfill/baseline/refresh` | KCCA |
| `GET /public/load-certificates/:code` | anyone |

All paths are under `/api/waste`.

## Before going live

- **`PUBLIC_APP_URL` must be set on the server.** It is empty in production today, so QR codes on load certificates
  (and permit certificates) would point to localhost.
- **Existing tickets get certificates.** The migration issues a certificate for every completed ticket already in
  production, numbered in ticket order.
- **KCCA should confirm the factors.** MCF depends on the site: Kiteezi (unmanaged, deep) is about 0.8, and Buyala
  (engineered, with cover) may justify 1.0 with an OX of 0.1. KCCA should also replace the assumed mix with a waste
  characterisation study, then publish version 2.

## Not covered yet

- Composting and materials-recovery facilities must be added to `disposal_facilities` (kind `composting` or
  `materials_recovery`) before their loads count as diversion.
- Upstream benefits of recycling (avoided virgin material) are not counted; only avoided landfill methane is.
- No first-order decay (emissions spread over years); the figures are lifetime potential in the month of placement.
