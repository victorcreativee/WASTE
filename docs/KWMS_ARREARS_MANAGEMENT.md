# KWMS — Arrears management

Concept note KWMS-CN-001-2026, module 4: "arrears management", for revenue recovery. This is for collection companies
only; recycling is untouched. Migration **117**.

## What a company sees

**Commercial → Arrears** (`/dashboard/arrears`; billing package):

- **Totals:**
  - the amount overdue and how many households owe it, plus the amount billed but not yet due
  - the share collected of the bills that fell due in the last 90 days
  - promises to pay: open, due this week, kept and broken
  - payment plans on track and behind
- **Age buckets:** 1–30, 31–60, 61–90 and over 90 days past the due date (Kampala days). Each bucket filters the list.
- **Households:** the list shows the overdue amount, days late (since the oldest unpaid bill), last payment, last
  follow-up and plan progress. It can be searched by name, phone or place, and downloaded as a CSV.
- **One household** (*Open*): unpaid bills, payment plans with progress, follow-ups, and recent payments.

## Follow-ups and promises

The collection team records each contact: how (call, visit, SMS, letter) and the outcome. The outcome is one of:
promised to pay, says already paid, disputes the bill, no answer, refused, moved away, or other. A dispute or "other"
needs a note.

- **Promise to pay:** has an amount (no more than what is owed) and a date that is not in the past.
- **Kept or broken:** a promise is **kept** when confirmed payments of at least that amount arrive between the
  follow-up and the promised day. Otherwise it is **open** until the day passes, then **broken**.
- **Permanent:** follow-ups are a record of what happened, so they cannot be edited or deleted. The app's database
  role has no update or delete permission on them. Each one keeps the balance owed at that moment.

## Payment plans

- **Terms:** an amount to clear (up to the open balance), 2–24 weekly or monthly instalments of at least UGX 1,000,
  and a first instalment that is not in the past. One active plan per household.
- **Progress:** confirmed payments since the plan was agreed, compared with what was due by today (the last instalment
  takes the rounding remainder). A plan is **on track**, **behind** or **completed**.
- **Changing a plan:** a plan is never edited. Cancel it with a reason and agree a new one.

## Overdue reminder

There is a new household reminder, **Bill overdue** (Customers → household reminders; off until the company turns
it on):
- It goes out once at 1, 14 and 30 days after the due date. Only the latest step reached is sent, so a missed day is
  not repeated.
- It covers bills up to 60 days late, and is sent between 08:00 and 19:00 Kampala time.
- Households keeping to a payment plan are not reminded.
- Like the other reminders, it always appears on the household's `/my` page, and goes by SMS when the company has
  switched it on and the household hasn't turned SMS off.

## Who can do what

- **Reading** arrears needs `billing.read`.
- **Recording** follow-ups and plans needs `billing.payment.record`, the permission of staff who record payments.
- Both are under `/api/waste/billing/arrears`, so the billing package gate applies.
- Follow-ups and plans are isolated per company by row-level security and appear in the audit log.

| Endpoint | Permission |
|---|---|
| `GET /billing/arrears/summary`, `GET /billing/arrears?bucket&search&page&pageSize`, `GET /billing/arrears/export`, `GET /billing/arrears/customers/:id` | `billing.read` |
| `POST /billing/arrears/customers/:id/follow-ups`, `POST /billing/arrears/customers/:id/plans`, `POST /billing/arrears/plans/:id/cancel` | `billing.payment.record` |

## Database

- `customer_arrears` (view): the open and overdue balance per company and household, by age bucket, with the oldest
  due date.
- `arrears_follow_ups` and `arrears_payment_plans`.
- `arrears_plan_due_on` and `arrears_plan_due_by` work out a plan's schedule.
- `household_sms_settings.bill_overdue`; `notify_household` knows the new `bill_overdue` kind.

## Not covered yet

- Suspending service for unpaid bills. Stopping collection is a public-health decision for KCCA, not a billing rule.
- Interest or late fees.
- Writing off debt that can't be recovered.
