# Module 12: Waste Management SaaS subscriptions

Delivered 22 October 2026. The first module of the second product. Companies on the platform get a subscription with a
plan, a free trial, invoices and plan limits, and the platform team manages it all from one page. Builds on the existing
platform packages (migrations 057, 072) and account applications; migration **103**.

**KCCA regulation is never part of the subscription.** Permits, monthly returns, compliance cases, penalties, disposal
records and dumping cleanups stay free and keep working whatever the subscription's state.

## Plans

Plans are the existing platform packages, now with a monthly and an annual price, limits on vehicles and active staff
accounts, a trial length, and whether they are offered on sign-up.

| Plan | Monthly | Annual | Vehicles | Staff | Trial |
|---|---|---|---|---|---|
| Collector Standard | UGX 150,000 | UGX 1,500,000 | 5 | 15 | 30 days |
| Collector Professional | UGX 350,000 | UGX 3,500,000 | unlimited | unlimited | 30 days |
| Recycler Starter | free | free | 2 | 5 | none |
| Recycler Standard | UGX 100,000 | UGX 1,000,000 | 5 | 15 | 30 days |
| Recycler Professional | UGX 250,000 | UGX 2,500,000 | unlimited | unlimited | 30 days |
| Factory Standard | UGX 300,000 | UGX 3,000,000 | unlimited | unlimited | 30 days |

**These prices and limits are placeholders. The business must set them** on the Subscriptions page (Plans and prices)
before charging anyone. Older packages (Operations Pro, Core Collector, Custom) are no longer offered on sign-up. The
features each plan unlocks are unchanged (Platform packages page).

## Lifecycle

1. **Sign-up and trial.** A company applies for an account as before and picks a plan; the sign-up pages now show each
   plan's price, trial and vehicle limit (from a public plans list, no sign-in needed). **When the platform approves the
   application, the subscription starts automatically**: a free trial on a paid plan, or straight to active on a free one.
2. **During the trial** the company can move between plans at once, without charge.
3. **Billing.** When the trial ends, the first period is invoiced. Each period renews on the same day of the month (or
   year), with an invoice due in **7 days**. Payment is by mobile money or bank transfer quoting the invoice number; the
   company enters the transaction reference and the platform confirms it (or marks it not found). The platform can also
   record a payment directly.
4. **Plan changes.** A dearer plan applies at once, with an invoice for the difference for the days left in the paid
   period. A cheaper plan, or a change between monthly and annual billing, starts at the end of the period. A plan that
   cannot hold the company's current vehicles or staff is refused, with the reason.
5. **Non-payment.** The day after the due date the subscription is **past due** (the company is told, and still works
   normally). **14 days after the due date it is suspended**: the platform becomes read-only for the company's staff,
   except paying, the subscription page and everything KCCA requires. Paying all overdue invoices restores it at once.
6. **Cancellation.** The company can end the subscription at the end of the current period (and change its mind until
   then). An ended subscription is read-only in the same way; the platform can reactivate it.
7. **Complimentary.** Companies already on the platform before this module were given **complimentary** subscriptions:
   full access, no invoices, no limits. The platform can start billing them, or make any company complimentary.

Read-only means: any change outside the subscription, regulatory, compliance, penalty, disposal, dumping, returns, permit
and notification areas is refused with HTTP 402 and a message saying why. Reading always works. Plan limits are enforced
by the database when a vehicle or an active staff account is added (complimentary and unmanaged companies are not limited).

Rules live in `services/waste-service/src/services/subscription.rules.ts` (`BILLING_RULES`). **The business should confirm
the 7-day payment term and the 14-day suspension period.** Billing runs hourly with the other scheduled checks.

## Screens

| Who | Where | What |
|---|---|---|
| **Platform admin** | *Subscriptions* (Platform) | Monthly recurring revenue, companies in trial (and ending within 7 days), past due, suspended, payments to confirm, collected this month. Subscriptions by status with a panel per company: plan, period, usage against limits, invoices, history; extend trial, suspend, reactivate, make complimentary, start billing. Invoices: confirm, record, mark not found, void. Plans and prices. Start a subscription for a company that has none. |
| **Company administrator** (collector, recycler, factory) | *Subscription* (Administration) | Plan and status, trial days left, period and price, scheduled changes, vehicles and staff against the limits; invoices with *I have paid*; plans with monthly or annual prices to upgrade or move to; end or keep the subscription. Supervisors do not see billing. |
| **Applicants** | Sign-up pages | Each plan with its price, trial and vehicle limit. |

## Notifications

New category **Subscription and billing**, to company administrators: invoice issued, payment received, payment not found,
invoice overdue, suspended (critical), active again, trial extended, subscription ended.

## Database — migration 103 (`infrastructure/database/103_saas_subscriptions.sql`)

Additive and idempotent; requires 092–102.

- `platform_packages`: `annual_fee_ugx`, `max_vehicles`, `max_users`, `trial_days`, `is_public`, with the placeholder
  prices applied once (a plan that already has a price keeps it).
- `organization_subscriptions` (one per company): plan, billing cycle, status, trial end, current period, scheduled
  cancellation, plan or cycle change, status reason.
- `subscription_invoices` (number `SI-YYYY-NNNNN`): period or proration, amount, due date, payment reference and
  confirmation, void reason; each period invoiced once; amounts and periods never change (void and reissue).
- `subscription_events` (history, cannot be changed).
- `start_subscription_trial(organization, plan)`, called when an account application is approved.
- `plan_limit_reason` and triggers on `waste_trucks` and `users` for the plan limits.
- Complimentary subscriptions for existing active companies; notification category `billing`.

```bash
cd services/waste-service
npm run migrate:subscriptions:check
npm run migrate:subscriptions
```

## API (under `/api/waste`)

| Method and path | Who |
|---|---|
| `GET /public/plans` (`?type=`) | anyone |
| `GET /subscription`, `GET /subscription/invoices`, `PATCH /subscription/plan`, `POST /subscription/cancel`, `POST /subscription/resume`, `POST /subscription/invoices/:id/payment` | company administrator |
| `GET /saas/overview`, `/saas/subscriptions` (`?status=&q=`), `/saas/subscriptions/:organizationId`, `/saas/unsubscribed`, `/saas/invoices` (`?status=`), `/saas/plans` | system admin |
| `POST /saas/subscriptions`, `PATCH /saas/subscriptions/:organizationId`, `PUT /saas/plans/:code`, `PATCH /saas/invoices/:id/confirm`, `/reject-payment`, `/void`, `POST /saas/run-billing` | system admin |

## Verification

- Unit tests (`tests/subscriptions.test.ts`): calendar periods (month ends, leap years), prices and monthly value,
  proration, past due and suspension timing, plan change timing and limits.
- `npm run test:e2e:subscriptions` (11 checks): public plans without sign-in; trial started by approving an account
  application; platform-started trial; vehicle limit in the database; plan moves during the trial and a downgrade refused
  for the fleet size; first invoice at trial end with a notice; proration on upgrade and a scheduled annual switch;
  payment rejected then confirmed and invoice immutability; past due, suspension with read-only access (402) while
  reading and paying still work, and restoration on payment; cancellation at period end and reactivation; trial
  extension, complimentary without limits, start of billing; recurring revenue, isolation and history.
- Runs in `npm run release:check` and in CI; the fresh-database check includes the new tables.
- Full `npm run release:check` passes:
  - **Build and tests:** 5 type checks; 7 + 142 unit tests; dependency audit; production build of **73** pages.
  - **Migrations:** **103** applied to a fresh database, 092–103 re-applied, new tables present.
  - **End-to-end:** thirteen suites, **169 checks**.
- Browser, with test data kept temporarily: the platform Subscriptions page and a company's Subscription page. Test data
  removed afterwards.

## Not in this module

- Online payment (mobile money or card gateway) and automatic matching of payments.
- Tax (VAT) on invoices, and printable invoices or receipts.
- Self-service sign-up without the platform's document check: companies are still verified before their account opens.
- Usage-based pricing (per vehicle or per customer).
