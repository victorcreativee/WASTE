# Module 8: disposal verification

Delivered 21 October 2026. Shows KCCA where collected waste ends up: every completed collection trip should be weighed at a
KCCA weighbridge, and every weighbridge ticket should belong to a trip. Builds on Modules 1–7 and on the existing
weighbridge operations (migrations 046–050); migration **099**.

## The rule

A completed collection trip has **48 hours** to reach a KCCA weighbridge. After that it needs either a linked KCCA ticket
or an explanation that KCCA accepts. A completed ticket that belongs to no trip is shown after **24 hours** until the
company links it or KCCA accepts it as a load without a trip.

Each trip has one disposal state:

| State | Meaning | Counts as |
|---|---|---|
| Verified | A completed KCCA weighbridge ticket is linked | accounted for |
| On the weighbridge | The ticket is open (vehicle weighed in, not out) | not yet due |
| Explained | KCCA accepted the company's explanation | accounted for |
| Explanation with KCCA | An explanation waits for review | due, not accounted for |
| Within 48 hours | Still inside the grace period | not yet due |
| Self-declared only | The company typed a ticket number that no KCCA weighbridge recorded | exception |
| No disposal record | Nothing at all after 48 hours | exception |

**Verification rate** = (verified + explained) ÷ trips due. **Standing**: good at 95% or more, watch from 80%, action
required below 80%.

Only trips on service routes dated from `DISPOSAL_FIRST_DATE` (default 1 October 2026) are assessed, so older history
does not count against anyone.

Rules live in `services/waste-service/src/services/disposal.rules.ts` (`DISPOSAL_RULES`). **KCCA should confirm the 48-hour
grace period, the 24-hour linking window and the 95% / 80% standing thresholds.**

## Who does what

| Role | Gets |
|---|---|
| **KCCA** | *Disposal verification* (City oversight): city rate, weight verified per facility, every collector with standing, trips due, rate, trips without disposal and tickets without a trip. Work lists: explanations to review (accept, or reject with a reason), trips without disposal, tickets without a trip (accept without a trip, with a reason). *Send notice* opens a prefilled compliance case (category *weighbridge*). Manages the disposal facility registry through the API. |
| **Collector admin and supervisor** | *Disposal records* (KCCA regulation): own rate and standing, trips that need action, explanations with KCCA, all trips, tickets without a trip. **Explain** a trip (reason, details, and the carrying ticket for a combined load); **Link** a ticket to a trip by the same vehicle. |
| **Weighbridge operator** | Chooses the facility they work at (remembered on that device); tickets take the facility name from the registry. |

Explanation reasons: came back empty; delivered to a licensed recycler or other approved site; vehicle broke down and load
transferred; combined with another trip's load (names the ticket); weighbridge not working; other.

## Closing gaps found on the way

- A company could overwrite the weight that a KCCA ticket had set on a trip by "verifying" the trip itself. It can now only
  record its own ticket number when no KCCA ticket is linked, and such an entry is shown as *self-declared*, never as verified.
- The weighbridge screen sent a hard-coded facility. Tickets now must name an active facility in the registry (database
  reference and trigger), seeded with Buyala and Kiteezi.

## Notifications

New category **Disposal** (on the notifications page, with its own email/SMS switches):

- once a day, to collector admins and supervisors, when trips from the last 30 days have no disposal record or tickets are
  not linked (warning);
- KCCA admins when a company sends an explanation;
- the company admin when KCCA accepts (info) or rejects (warning, with the reason) an explanation.

## Database — migration 099 (`infrastructure/database/099_disposal_verification.sql`)

Additive and idempotent; requires 092–098.

- `disposal_facilities` (code, name, kind, active), seeded, plus any facility already on a ticket; tickets reference it;
  trigger requires an active facility on new tickets and fills in its name.
- `weighbridge_transactions.no_trip_reason / no_trip_accepted_by / no_trip_accepted_at`, consistent by check constraint.
- `trip_disposal_explanations`: one live (submitted or accepted) explanation per trip; filed only for the company's own
  completed trip; a combined load names a completed ticket of the same company; immutable once reviewed.
- View `trip_disposal_facts`: one row per completed trip with its latest live ticket, self-declared ticket and latest
  explanation.
- Notification category `disposal`.

```bash
cd services/waste-service
npm run migrate:disposal-verification:check
npm run migrate:disposal-verification
```

## API (under `/api/waste`)

| Method and path | Who |
|---|---|
| `GET /disposal/facilities` (`?all=1` includes inactive) | KCCA, system admin, weighbridge operator, company staff |
| `PUT /disposal/facilities` | KCCA, system admin |
| `GET /disposal/summary`, `/disposal/trips` (`?state=` names or `exceptions`), `/disposal/tickets` (`?unlinked=1`) | collector admin, supervisor (own company) |
| `POST /disposal/trips/:tripId/explanation`, `PATCH /disposal/tickets/:id/link` | collector admin, supervisor |
| `GET /disposal/city`, `/disposal/city/trips`, `/disposal/city/tickets`, `/disposal/explanations` (`?organizationId=`) | KCCA, system admin |
| `PATCH /disposal/explanations/:id/review`, `PATCH /disposal/tickets/:id/accept-without-trip` | KCCA admin |

Periods use `?period=30d|90d|year` or `?from=&to=`; lists are paged.

## Verification

- Unit tests (`tests/disposal.test.ts`): trips due, verification rate, standing thresholds, explanation checks.
- `npm run test:e2e:disposal` (10 checks): facility registry and inactive/unknown facilities refused; the five trip states
  from real weighbridge tickets (automatic trip matching, open ticket, self-declared entry); a company cannot overwrite a
  KCCA weight; explanation rules, KCCA notified, rejection with reason, re-explanation, acceptance, immutability; linking an
  unlinked ticket (wrong vehicle refused); KCCA acceptance without a trip; isolation between collectors and refusal for
  other roles and organization types; KCCA overview figures; daily notice sent once; disposal preferences.
- Runs in `npm run release:check` and in CI; fresh-database check includes the new tables.
- Full `npm run release:check` passes:
  - **Build and tests:** 5 type checks; 7 + 123 unit tests; dependency audit; production build of **66** pages.
  - **Migrations:** **99** applied to a fresh database, 092–099 re-applied, new tables present.
  - **End-to-end:** nine suites, **130 checks**.
- Browser, with test data kept temporarily: KCCA overview and work lists, company records and the explain dialog (not
  submitted). Test data removed afterwards.

## Not in this module

- Matching GPS tracks to weighbridge arrivals (the live fleet data exists; a later module can compare them).
- Facility management screen (the API exists; Buyala and Kiteezi are seeded).
- Recyclers' and factories' residue disposal (they report it in monthly returns; their loads are not trips).
- Disposal figures in the city report.
