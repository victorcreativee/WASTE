# Module 10: fines and penalties

Delivered 21 October 2026. Gives KCCA's enforcement consequences: penalty notices under a published schedule, one appeal,
payment confirmed against KCCA's records, and suspension of the permit when a fine is left unpaid. Builds on Modules 1–9;
migration **101**.

## The schedule

| Offence | First offence | Repeat within a year |
|---|---|---|
| Illegal dumping by a licensed operator | UGX 2,000,000 | UGX 5,000,000 |
| Cleanup order not met | UGX 1,000,000 | UGX 2,500,000 |
| Monthly return not filed on time | UGX 200,000 | UGX 500,000 |
| Collection trips without verified disposal | UGX 500,000 | UGX 1,500,000 |
| Compliance notice not acted on | UGX 750,000 | UGX 2,000,000 |
| Operating outside the permit | UGX 3,000,000 | UGX 7,500,000 |

**These amounts are placeholders. KCCA must confirm its schedule (and its legal basis) before any notice is issued.**
KCCA administrators change amounts or take an offence out of use on the Penalties page; every change is recorded with who
made it. A notice keeps the amount it was issued at.

## How a notice moves

1. **Issued.** A KCCA administrator chooses the company, the offence and writes the grounds (facts and evidence, shown to
   the company). A notice can be tied to what it arises from: a dumping site the company is held responsible for or was
   ordered to clean up, a monthly return, a compliance case. The same offence is never fined twice for the same dumping
   site, return or case. The amount is the schedule's, or the repeat amount if the company had a notice for the same
   offence in the last 365 days. The company may **appeal within 14 days** and must **pay within 30**.
2. **Appeal (once).** The company explains why. Payment is paused. KCCA decides with reasons:
   - *not allowed:* the penalty stands;
   - *partly allowed:* a lower amount;
   - *allowed:* the notice is withdrawn.
   After a decision the company has at least 14 more days to pay.
3. **Payment.** The company pays through KCCA's revenue channels, quoting the notice number, and enters the payment
   reference. KCCA confirms it against its records, or marks it **not found** (back to unpaid, with the reason). KCCA can
   also record a payment received at its own counter directly.
4. **Withdrawn.** KCCA can withdraw an unpaid notice with a reason.
5. **Escalation.** A notice still unpaid **30 days after its due date** can be escalated: the company's permit is suspended
   through the Module 1 permit process (its own history and notices; routes can no longer be dispatched). When the fine is
   later paid, KCCA is reminded that the permit can be reinstated; reinstatement stays a deliberate KCCA decision.

Paid and withdrawn notices are final; the company, offence, grounds and original amount never change, and an amount can
only go down. Every step is in the notice's history, which cannot be edited.

Rules live in `services/waste-service/src/services/penalty.rules.ts` (`PENALTY_RULES`). **KCCA should confirm the 30-day
payment period, the 14-day appeal period, the 30-day escalation threshold and the one-year repeat window.**

## Who sees what

| Role | Gets |
|---|---|
| **KCCA** | *Penalties* (Regulation): issued and collected in the period, outstanding and overdue amounts, appeals and payments to decide, notices that can be escalated; the notices by stage; the schedule with amounts; companies with open notices. *Issue penalty* from a dumping site (responsible company, or the collector that missed a cleanup) and from an overdue row in the monthly returns register, with the grounds prefilled. |
| **Company administrator** (collector, recycler, factory) | *Penalty notices* (KCCA regulation): outstanding, overdue, under appeal and paid in the last year; each notice with its grounds, appeal and history; *I have paid* and *Appeal*. Supervisors do not see penalties. |

## Notifications

New category **Penalties**: a notice issued (to the company administrators), an appeal or a payment to decide (KCCA), the
appeal decision, a payment confirmed or not found, a notice withdrawn, an overdue notice (once per due date), a notice that
can be escalated (KCCA, once), and an escalated fine paid (KCCA, to consider reinstatement).

## Database — migration 101 (`infrastructure/database/101_penalties.sql`)

Additive and idempotent; requires 092–100.

- `penalty_schedule` (seeded) and `penalty_schedule_history`.
- `penalty_notices` (number `PN-YYYY-NNNNN`, company, offence, offence number, original and current amount, grounds,
  linked dumping site, compliance case or return month, status, appeal deadline, due date, payment reference and
  confirmation, withdrawal reason, escalation), with partial unique indexes against fining the same thing twice.
- `penalty_appeals` (one per notice, with the decision).
- `penalty_history` (cannot be changed).
- A guard trigger for the status moves, the unchangeable fields and amounts that only go down.
- Notification category `penalties`.

```bash
cd services/waste-service
npm run migrate:penalties:check
npm run migrate:penalties
```

## API (under `/api/waste`)

| Method and path | Who |
|---|---|
| `GET /penalties/schedule` (`?all=1` includes offences not in use) | KCCA, system admin, company staff |
| `PUT /penalties/schedule/:code` | KCCA admin |
| `GET /penalties/overview` | KCCA, system admin |
| `GET /penalties/notices` (`?status=open|overdue|escalate|<status>&organizationId=`), `GET /penalties/notices/:id` | KCCA; a company administrator for its own notices |
| `POST /penalties/notices` | KCCA admin |
| `POST /penalties/notices/:id/appeal`, `POST /penalties/notices/:id/payment`, `GET /penalties/company/summary` | company administrator |
| `PATCH /penalties/notices/:id/decide-appeal`, `/confirm-payment`, `/reject-payment`, `/withdraw`, `/escalate` | KCCA admin |

## Verification

- Unit tests (`tests/penalties.test.ts`): status moves, issue dates, repeat amounts, appeal eligibility and outcomes,
  overdue and escalation.
- `npm run test:e2e:penalties` (10 checks): schedule visible to all and changed only by KCCA, with history; issuing tied
  to evidence, wrong-company evidence refused, no double fine; repeat amount; companies see only their own notices;
  one appeal, payment paused, reduction with reasons; payment rejected then confirmed; history and database guards;
  withdrawal; counter payment; overdue notices flagged once; escalation suspending the permit once; KCCA told when an
  escalated fine is paid; KCCA and company figures.
- Runs in `npm run release:check` and in CI; the fresh-database check includes the new tables.
- Full `npm run release:check` passes:
  - **Build and tests:** 5 type checks; 7 + 132 unit tests; dependency audit; production build of **70** pages.
  - **Migrations:** **101** applied to a fresh database, 092–101 re-applied, new tables present.
  - **End-to-end:** eleven suites, **151 checks**.
- Browser, with test data kept temporarily: KCCA overview, lists and a notice with its appeal and history; company notices.
  Test data removed afterwards.

## Not in this module

- Online payment: KCCA confirms payments made through its own revenue channels (PRN or receipt); there is no payment
  gateway or automatic matching with the revenue system.
- Automatic issuing: every notice is a KCCA decision; the platform only prefills them from the evidence.
- Interest or surcharges on late payment.
- Penalty receipts or notices as printable PDFs.
