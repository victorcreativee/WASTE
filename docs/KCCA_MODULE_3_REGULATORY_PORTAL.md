# KCCA Command Center — Module 3: company regulatory portal and monthly returns

Delivered 21 October 2026. Builds on Modules 1–2. Also in this delivery: an improved sign-out (see the end).

## The separation it establishes

Every licensed waste collector and recycling company gets a **regulatory portal**, whatever its subscription.
Paid Waste Management SaaS features (fleet, billing, finance, and so on) stay behind platform packages.

| Free regulatory portal (all licensed companies) | Paid SaaS (by package) |
|---|---|
| Regulatory overview, KCCA permit and renewals, compliance cases, monthly returns, certificate | Operations, fleet, customers, contracts, billing, finance, inventory, procurement, reports, access |

**Change:** compliance cases were previously the paid package feature `compliance`, so a collector on *Collector
Standard* could not see or answer KCCA's cases. That gate is removed (`app.ts`), and the navigation item no longer
depends on the package. Verified: a *Collector Standard* company now opens compliance cases (200), while billing still
answers 403.

## Company side (`company_admin` files; `supervisor` can follow)

New navigation group **KCCA regulation** for collectors, collector supervisors and recycling companies:

- **Regulatory overview** (`/dashboard/regulatory`): a one-line verdict (up to date, or a list of what needs
  attention), then permit (status, days left, pending renewal, unread notices), monthly returns outstanding, and open
  compliance cases with due dates, plus a short statement of what KCCA expects.
- **Permit:** the Module 1 page.
- **Compliance cases:** the existing page, now free.
- **Monthly returns** (`/dashboard/returns`): every month owed with its due date and status (*Due*, *Overdue*,
  *Submitted*, *Queried by KCCA*, *Accepted*). **File return** opens a form prefilled from what the platform recorded
  for that month, with "Platform recorded …" beside each figure. The company corrects what the platform did not capture
  and signs a declaration (name, position, confirmation). After a query, **Correct and resubmit** shows KCCA's reason.

**What a return contains**

| Waste collectors | Recycling companies |
|---|---|
| Customers served, trips completed, collections completed and missed, waste delivered for disposal (kg), disposal site, vehicles operated, staff, complaints received and resolved, notes | Collected and sold kg per material category (plastic, paper, metal, glass, organic, textile, other), sorting residue kg and how it was disposed of (required when there is residue), staff, notes |

**What the platform pre-records**, per month: active customer agreements; completed trips; completed and missed jobs;
completed weighbridge net weight; distinct vehicles on completed trips; active members (at filing); resident issues
assigned and resolved. Recyclers: purchases and sales by catalogue category, sorting residue, active members.

## KCCA side

**Monthly returns** (`/dashboard/returns-register`, under Regulation):

- Pick a reporting month (defaults to last month). The summary bar shows required, waiting for review, accepted, queried,
  overdue (or not yet filed before the due date), and differing from records. Each figure is a filter.
- Table of every company that owes that month, with status, submission date, *after due date* marker and the number of
  figures that differ from platform records.
- **Review** opens declared vs platform-recorded figures side by side (differences of more than 10% highlighted), the
  disposal details, notes and full history; **Accept** or **Query** with a reason the company sees.
- **Send notice** on an overdue company prefills a compliance notice in the new *Monthly returns* category.
- **Export CSV** for the month.

## Rules (`services/waste-service/src/services/regulatory-returns.rules.ts`)

- **Owed months:** from the later of `RETURNS_FIRST_PERIOD` (default `2026-09`) and the month the company joined the
  platform, up to last month. The current month is never owed.
- **Due date:** the 15th of the following month. Unfiled after that → *overdue*. Filing late is allowed and marked late.
- **One return per company per month.** A *queried* return is corrected and resubmitted (version + 1); an *accepted*
  return is final (database trigger). Every submission, query, resubmission and acceptance is kept with its figures in an
  immutable history.
- **Differences:** a figure is compared only where the platform recorded a non-zero value, so companies that keep their
  operations elsewhere are not penalised. More than 10% apart → highlighted for KCCA.
- KCCA should confirm the first returns month, the due day and the 10% tolerance before enforcement; set
  `RETURNS_FIRST_PERIOD=YYYY-MM` on the waste service to change the first month.

## Database — migration 094 (`infrastructure/database/094_regulatory_returns.sql`)

Additive and idempotent; requires 093. Tables `regulatory_returns` (unique per organization and month; figures,
platform figures and differences as JSON; declaration; lateness) and `regulatory_return_history` (immutable); trigger
that freezes accepted returns; compliance category `statutory_returns`.

```bash
cd services/waste-service
npm run migrate:regulatory-returns:check
npm run migrate:regulatory-returns
```

## API (under `/api/waste/regulatory`)

| Method & path | Who |
|---|---|
| `GET /portal` | Company admin, supervisor |
| `GET /returns`, `GET /returns/prefill?period=YYYY-MM`, `GET /returns/:id` | Company admin, supervisor (own company only) |
| `POST /returns` — `{period, declarantName, declarantTitle, figures, confirm: true}` | Company admin |
| `PUT /returns/:id` — `{declarantName, declarantTitle, figures, confirm: true}` (queried returns only) | Company admin |
| `GET /returns-register?period=`, `GET /returns-register/:id`, `GET /returns-register/export.csv?period=` | KCCA admin, system admin |
| `PATCH /returns-register/:id` — `{action: accept\|query, notes}` | KCCA admin |

## Verification

- `npm test` (waste-service): **97/97** (6 new: due dates and month ends, owed months, which months can be filed,
  due vs overdue, 10% difference rule, material flattening).
- `npm run test:e2e:portal`: **14/14** — portal summary with an overdue month; nothing owed by a company that joined this
  month; current and pre-start months refused; prefill from recorded trips, weighbridge and staff; supervisor and KCCA
  cannot file; declaration and figure validation; late filing with recorded differences; duplicate refused; register states
  (submitted, overdue, not required); company denied the register; query → company sees it → resubmission v2 with no
  differences; acceptance final (API and database); full immutable history and cross-company denial; CSV; recycler
  return with residue rule; compliance cases open on a package without the feature while billing stays 403; a
  monthly-returns compliance case.
- Modules 1 and 2 suites re-run: **27/27** and **17/17**.
- Migration 094 validated with rollback and applied locally.
- Browser: KCCA register and return review (kept test data, not decided), company regulatory overview (sample company),
  filing form for a real overdue company (opened, not submitted). Test data removed afterwards.
- `tsc` clean; ESLint clean on the new pages (the existing `WeighbridgeReconciliation.tsx` lint error is unchanged).

## Not in this module

- Reminders by email/SMS: overdue returns appear in the company's overview and in the KCCA register only.
- Historical staff counts: "staff employed" pre-fills from members active at the time of filing.
- Attachments on returns (e.g. disposal receipts).

## Also delivered: sign-out

- The sidebar user card (or the avatar on phones) opens an **account menu**: name, email, workspace, **My account**,
  **Sign out**. Escape or clicking elsewhere closes it.
- **Sign out** asks for confirmation; in the desktop app it warns when offline changes have not synced yet.
- While signing out it shows progress, clears every stored credential (session and local), closes desktop offline unlock,
  and returns to sign-in with **"You have signed out."**
- Files: `components/layout/AccountMenu.tsx` (new), `components/layout/AppShell.tsx`, `app/login/page.tsx`.
- Not yet: server-side session revocation. Refresh tokens remain valid until they expire (7 days) because the auth
  service has no logout endpoint; adding one needs a small schema change (a per-user session version).
