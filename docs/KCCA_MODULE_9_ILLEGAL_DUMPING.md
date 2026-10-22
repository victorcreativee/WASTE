# Module 9: illegal dumping enforcement

Delivered 21 October 2026. Gives KCCA one place to handle illegal dumping from the first report to a confirmed cleanup:
where it happens, who is responsible, who cleans it up and by when, and whether it comes back. Builds on Modules 1–8 and
on residents' issue reports (migration 005); migration **100**.

## How a site moves

1. **Reported.** A resident (through *Requests & issues*, choosing *Illegal dumping*), a KCCA officer or a collector's
   staff marks the exact place on a map or uses their current location, and can add a landmark, the division and a photo.
   A report within **75 m** of a site that is still open joins that site instead of creating a new one.
2. **Verified.** A KCCA officer inspects the site and records its size, the kinds of waste, whether it is hazardous and
   what they found, with an optional photo. Or KCCA **closes it as unfounded**, with a reason shown to the reporters.
3. **Cleanup ordered.** KCCA orders the cleanup from a licensed collector or from its own crew, with a deadline:
   **small 3 days, medium 5, large 7, hazardous 2**. KCCA can set an earlier date, not a later one.
4. **Cleanup reported.** The collector reports the cleanup with a **photo** (required). A cleanup by the KCCA crew is
   confirmed by KCCA directly.
5. **Cleared.** KCCA confirms the site is clear, with an optional photo, or **sends the cleanup back** with what is still
   wrong (optionally a new deadline within the allowed time).
6. **Came back.** A report within 75 m of a site cleared in the last **90 days** reopens that site as *reported* and
   counts a recurrence. A closed (unfounded) site is never reopened; a later report there starts a new site.

At any open stage KCCA can **hold a company responsible**, only with a written description of the evidence (photo,
vehicle registration, witness, GPS track). The company is told and can see the site. *Send compliance notice* opens a
prefilled compliance case against that company.

A **hotspot** is a site with 3 or more reports or at least one recurrence. A company with **3 or more** sites attributed to
it in **90 days** is shown as a **repeat offender** to KCCA and on its own cleanup page.

Rules live in `services/waste-service/src/services/dumping.rules.ts` (`DUMPING_RULES`); the database enforces the same
status moves. **KCCA should confirm the 75 m merge distance, the cleanup deadlines, the 90-day recurrence window and the
hotspot and repeat-offender thresholds.**

## Who sees what

| Role | Gets |
|---|---|
| **KCCA** | *Illegal dumping* (City oversight): open sites, overdue cleanups, hotspots, new and recurring sites, cleared and closed in the period, median days from first report to clearance; a map coloured by status (hotspots larger, overdue ringed red); open, overdue and cleared sites by division; companies with sites attributed and cleanups open or late; the list of sites by stage; the site panel with photos, reports, history and every decision above. |
| **Collector admin and supervisor** | *Dumping cleanups* (KCCA regulation): cleanups ordered from them with deadlines, sites attributed to them, a repeat-offender warning, reporting a cleanup with a photo, and reporting dumping they see. |
| **Resident** | The illegal-dumping report form now takes the exact place, the division and a photo. Their issue moves with the site (triaged when verified, in progress when a cleanup is ordered, resolved when KCCA confirms it clear, rejected with KCCA's reason when closed), and they are notified when it is cleared. |

Companies never see residents' names. A resident sees only the sites they reported; a company sees the sites it cleans
up, is held responsible for, or reported.

## Notifications

New category **Illegal dumping**:

- KCCA admins: a new site, a site that came back (warning), a reported cleanup, an overdue cleanup;
- the collector: a cleanup order (warning, or critical when hazardous), a cleanup sent back, confirmation, an overdue
  cleanup (once per deadline);
- the company held responsible (warning);
- residents who reported a site, when it is cleared.

## Database — migration 100 (`infrastructure/database/100_illegal_dumping.sql`)

Additive and idempotent; requires 092–099.

- `dumping_sites` (number `DS-YYYY-NNNNN`, location, landmark, division, status, size, waste types, hazardous, responsible
  company with evidence, cleanup company and deadline, recurrence count, stage times), with checks that a verified site
  has a division and size, an ordered cleanup has a deadline, a closed site has a reason and responsibility always has
  evidence.
- `dumping_reports` (every report with its own location, source and, for residents, the linked issue).
- `dumping_photos` (JPG, PNG or WebP data URLs of at most about 2 MB, by stage; served only through the API).
- `dumping_site_history` (every step; rows cannot be changed).
- A guard trigger allowing only the workflow's status moves, cleanup orders only to active licensed collectors, and
  responsibility only for licensed waste companies.
- Notification category `dumping`.

```bash
cd services/waste-service
npm run migrate:illegal-dumping:check
npm run migrate:illegal-dumping
```

## API (under `/api/waste`)

| Method and path | Who |
|---|---|
| `GET /dumping/divisions` | everyone below |
| `POST /dumping/reports` | KCCA, collector admin and supervisor, resident |
| `GET /dumping/my-reports` | anyone who reports |
| `GET /dumping/sites/:id`, `GET /dumping/photos/:id` | KCCA; a company or resident involved in the site |
| `GET /dumping/overview`, `GET /dumping/sites` (`?status=open|overdue|<status>&divisionId=&cleanupOrganizationId=&responsibleOrganizationId=`) | KCCA, system admin |
| `PATCH /dumping/sites/:id/verify`, `/dismiss`, `/responsibility`, `/order-cleanup`, `/confirm`, `/reject-cleanup` | KCCA admin |
| `GET /dumping/company/overview`, `GET /dumping/company/sites` (`?kind=attributed`), `PATCH /dumping/sites/:id/cleanup-report` | collector admin, supervisor |

Residents keep using `POST /citizen-issues`; an illegal-dumping issue with a location also accepts `photo` and `divisionId`
and returns the dumping site it joined.

## Verification

- Unit tests (`tests/dumping.test.ts`): status moves, report outcome (join, recurrence, new site), cleanup deadlines,
  Kampala bounds, hotspots, median days.
- `npm run test:e2e:dumping` (11 checks): a resident's issue becoming a site with KCCA notified; merging within 75 m;
  refusal outside Kampala; who sees which site and photo, and residents' names hidden from companies; KCCA-only
  inspection before any order; responsibility needing evidence; deadlines by size; only the ordered company reporting,
  with a photo; send back and confirmation; the resident's issue following each step and the thank-you notice;
  immutable history and the database status guard; recurrence and hotspot; hazardous two-day deadline and KCCA crew;
  closing as unfounded and never reopening; overdue notices sent once; KCCA and company overview figures.
- Runs in `npm run release:check` and in CI; the fresh-database check includes the new tables.
- Full `npm run release:check` passes:
  - **Build and tests:** 5 type checks; 7 + 127 unit tests; dependency audit; production build of **68** pages.
  - **Migrations:** **100** applied to a fresh database, 092–100 re-applied, new tables present.
  - **End-to-end:** ten suites, **141 checks**.
- Browser, with test data kept temporarily: KCCA overview, map, site panel with photos and the inspection form (not
  submitted); company cleanup page; resident form with the map. Test data removed afterwards.

## Also fixed

- Module 8 had added the *Disposal records* link to recycling companies' navigation, where the page refuses them. It is
  now only in the collectors' navigation.

## Not in this module

- Fines: KCCA acts through compliance cases; there is no fine or payment record yet.
- Division boundaries: the division is chosen by the reporter or the inspecting officer, because the database has no
  division shapes to look it up from the location.
- Matching dumping sites to collection vehicles' GPS tracks automatically.
- Anonymous reports from people without an account.
