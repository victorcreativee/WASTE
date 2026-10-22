# Module 7: notifications

Delivered 21 October 2026. Tells people when something needs them, in the app and by email and SMS, instead of waiting
for them to open the right screen. Builds on Modules 1–6; migration **098**.

## What people see

- **Bell** in the top bar of every workspace: unread count (refreshed every minute and when the tab comes back into view)
  and the latest eight notifications. Opening one marks it read and goes to the screen where it can be dealt with.
- **Notifications page** (`/dashboard/notifications`, also in the account menu): everything, with *All / Unread*, paging
  and *Mark all as read*.
- **Email and SMS settings** on the same page: per category, untick email or SMS to stop that channel. Every notification
  still appears in the app.

## What is notified

| Event | Who | Severity | Category |
|---|---|---|---|
| Permit expires in ~60 days / within 30 days / within 7 days | Company admins | info / warning / critical | Permit |
| Permit expired or suspended | Company admins and supervisors | critical | Permit |
| Permit reinstated | Company admins | info | Permit |
| Renewal approved / not approved | Company admins | info / warning | Renewals |
| Company submits a renewal request | KCCA admins | info | Renewals |
| KCCA opens a compliance case | Company admins and supervisors | from the case severity | Compliance |
| Company responds to a case | KCCA admins | info | Compliance |
| KCCA closes or reopens a case | Company admins | info / warning | Compliance |
| Monthly return overdue (once per month) | Company admins | warning | Monthly returns |
| KCCA queries or accepts a return | Company admins | warning / info | Monthly returns |
| Delivery to a factory not received after 7 days | Factory and recycler admins | warning | Chain of custody |
| Factory receives less than was sold (shortfall) | Recycler admins | warning | Chain of custody |

Permit notices come from the existing lifecycle notices (Module 1) through a database trigger, so every path that writes a
notice also notifies. Each event reaches a person once (a dedupe key per recipient), so the hourly checks never repeat
themselves. The person who caused an event is not notified of it.

## Channels

Severity decides whether a channel is used at all; the person's settings can then block it:

- **In-app:** always.
- **Email:** warnings and critical items, to the address on the account.
- **SMS:** critical items only, to the phone on the account. Ugandan numbers are normalised to `+256…`; a number that
  cannot be used is marked *skipped* with the reason.

Messages are short: the email subject is `[KCCA WMS] <title>`; the SMS is at most 320 characters and ends with the link.
Links use `PUBLIC_APP_URL`.

## Delivery

Notifications and their email/SMS deliveries are written in the same transaction as the event. A worker in the waste
service sends what is due:

- every 30 seconds, up to 25 deliveries per run, claimed with `FOR UPDATE SKIP LOCKED` so several instances never send
  the same message;
- a failed send is retried after 1, 5, 15 and 60 minutes, then marked *failed* after five attempts;
- a delivery stuck in *sending* for 10 minutes (a crash mid-send) is released for another attempt;
- hourly checks (overdue returns, overdue deliveries, pruning read notifications older than 180 days) run on one instance
  at a time (advisory lock);
- `NOTIFICATION_WORKER=off` disables the worker. Each delivery run holds a shared advisory lock, so holding it exclusively
  pauses background sending on that database; the end-to-end suite does this.

Providers, chosen per channel:

| Variable | Values |
|---|---|
| `NOTIFY_EMAIL_PROVIDER` | `log` (default: written to the service log only), `smtp` (`SMTP_URL`, `NOTIFY_EMAIL_FROM`), `webhook` |
| `NOTIFY_SMS_PROVIDER` | `log` (default), `africastalking` (`AT_USERNAME`, `AT_API_KEY`, `AT_SENDER_ID`, optional `AT_BASE_URL`), `webhook` |
| `NOTIFY_WEBHOOK_URL`, `NOTIFY_WEBHOOK_SECRET` | the webhook receives JSON `{channel,to,subject,text}`, signed with HMAC-SHA256 in `X-WMS-Signature` |

These are passed through in `infrastructure/production/compose.yaml`.

## Database — migration 098 (`infrastructure/database/098_notifications.sql`)

Additive and idempotent; requires 092–097.

- `notifications` (recipient, category, severity, title, body, in-app link, dedupe key, read time);
- `notification_preferences` (per person and category: email and SMS allowed or blocked; no row means both allowed);
- `notification_deliveries` (outbox: channel, destination, status, attempts, next attempt, provider message id, last error);
- functions `notify_user`, `notify_organization`, `notify_role`, `prune_notifications`;
- trigger on `permit_lifecycle_notices`.

```bash
cd services/waste-service
npm run migrate:notifications:check
npm run migrate:notifications
```

## API (under `/api/waste`)

| Method and path | Who |
|---|---|
| `GET /notifications` (paged; `?unread=1`) | signed-in user, own notifications |
| `GET /notifications/unread-count` | signed-in user |
| `POST /notifications/read` with `{ids:[…]}` or `{all:true}` | signed-in user, own notifications only |
| `GET`/`PUT /notifications/preferences` | signed-in user |
| `GET /notifications/deliveries` (last 7 days by status, recent problems) | system admin |
| `POST /notifications/run-checks`, `POST /notifications/process-deliveries` | system admin |

## Verification

- Unit tests (`tests/notifications.test.ts`): retry schedule, phone normalisation, message formatting, compliance severity.
- `npm run test:e2e:notifications` (10 checks) starts its own waste service wired to a local SMTP server and webhook:
  fan-out to admin and supervisor; reading only one's own; real SMTP email and signed SMS webhook; unusable number skipped;
  retry with growing wait then success; channel settings; KCCA notified of responses; permit reminder once through the
  lifecycle notices; overdue return once per month; queried return; system-admin-only worker endpoints.
- The factory suite also checks the shortfall notification to the recycler.
- Both run in `npm run release:check` and in CI.
- Full `npm run release:check` passes:
  - **Build and tests:** 5 type checks; 7 + 119 unit tests; dependency audit; production build of **64** pages.
  - **Migrations:** **98** applied to a fresh database, 092–098 re-applied, notification tables present.
  - **End-to-end:** eight suites, **120 checks**.
- Browser, with test data kept temporarily: bell with unread count and dropdown, notifications page and settings table.
  Test data removed afterwards.

## Not in this module

- Push notifications on the mobile apps.
- Notifications for KCCA about new permit applications and account applications (the existing queues show them).
- A delivery-problems screen for system admins (the API endpoint exists).
- KCCA should confirm which events justify SMS (cost) before an SMS provider is switched on.
