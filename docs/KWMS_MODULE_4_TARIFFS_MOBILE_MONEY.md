# KWMS Module 4 — KCCA tariffs and mobile money

Concept note KWMS-CN-001-2026, module 4 and Phase 2: billing aligned to KCCA's tariff bands, updated centrally when
KCCA revises rates, and bills paid by MTN MoMo and Airtel Money with reconciliation. Migration 112.

## KCCA tariffs

- **Bands and rates.** KCCA keeps tariff bands (code, name, customer type) and dated monthly rates for each
  (`kcca_tariff_bands`, `kcca_tariff_rates`). Screen: **Regulation → Collection tariffs** (`/dashboard/tariffs`).
  Public list: `GET /api/waste/public/tariffs`.
- **Versioned, never rewritten.** A rate in force cannot be changed or withdrawn (database trigger). KCCA publishes a
  new rate with a later start date. A scheduled rate can be withdrawn until a bill has used it. Rates cannot start in
  the past.
- **Packages follow a band.** On **Income & billing → Create service package** a company picks *KCCA tariff: …*
  instead of its own price. The package then takes the band's customer type, and its shown price follows today's
  rate (synced when a rate is published and hourly).
- **Every bill priced from KCCA.** A trigger on `customer_invoices` prices any bill for a band-linked package from the
  rate in force on the first day of its billing period (× 1, 3 or 12 months) and stores `tariff_rate_id`. This covers
  every path that creates bills (subscriptions, contract activation, the billing cycle), so no code path can bill a
  tariff package at another price. Bills already issued are never repriced.
- Packages without a band keep the company's own price (negotiated commercial contracts).

## Mobile money

- **Each company's own accounts.** Companies connect their MTN MoMo Collection and Airtel Money Collections
  credentials under **Commercial → Mobile money** (`/dashboard/mobile-money`). Money goes straight into the
  company's account; the platform never holds client funds. Credentials are checked with the provider on save and
  stored encrypted (AES-256-GCM, `PAYMENT_CREDENTIALS_KEY`); only the last four characters of the (non-secret) API user or client ID are shown.
- **Paying a bill.** On `/my` a household picks MTN or Airtel and a number. With a connected account the request goes
  to the payer's phone (MTN `requesttopay`, Airtel `merchant/v1/payments`) and the page follows it until it is paid or
  declined. Without one, the payment is recorded and the company confirms it by hand, as before.
- **Confirmation comes only from the provider.** The service asks the provider for the status 10 seconds after the
  request, then on a backoff for about 2½ hours. Callbacks (`/api/waste/public/payments/mtn/:id`,
  `/api/waste/public/payments/airtel`) are logged in `payment_provider_callbacks` and only bring the next status check
  forward. A forged callback cannot mark a bill paid.
- **Exceptions are set aside, not guessed.** A payment goes to *Needs review* when the provider reports a different
  amount, when money arrived but the bill could no longer take it (already paid or cancelled, or the transaction
  reference was already used), or when there is no final answer after the last check. The bill is not touched; the
  company settles it (refunded / recorded by hand / no money arrived) with a note.
- **Reconciliation.** Totals for a period, per day and provider: requests, confirmed, amount received, declined,
  waiting and exceptions, with the exception rate against the Phase 2 target (under 2%). *Download statement* gives a
  CSV of every mobile money payment with the provider's references, to tick off against the MTN or Airtel statement.
- Successful payments get the usual `RCT-` payment receipt and the household's "payment received" notification.

## Configuration

| Variable | Purpose |
|---|---|
| `PAYMENT_CREDENTIALS_KEY` | base64 of 32 random bytes; encrypts companies' credentials. Required in production. Changing it means every company re-enters its credentials. |
| `PUBLIC_API_URL` | Public https address of the API, used for MTN callback URLs (register its host with MTN). Optional: payments are confirmed by status checks without it. |
| `MOBILE_MONEY_SIMULATOR=on` | Development only (ignored in production): companies without a connected account take simulated payments, approved after ~4 s; numbers ending in 0 decline. |

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

## Before going live

- MTN: the company needs an MTN MoMo **Collection** product subscription for Uganda (`mtnuganda`), an API user and key
  created for it, and the callback host registered. The sandbox only accepts EUR; the client handles that.
- Airtel: a Collections app approved for Uganda (UGX). If Airtel enables message signing / PIN encryption on the app,
  that is not implemented yet.
- Test each company's account with a small real payment, and confirm it appears in reconciliation, before announcing it
  to households.
- KCCA's actual tariff bands and rates have not been entered: KCCA enters them on the tariffs page.

## Not covered yet

- Refunds and reversals are recorded by the company, not sent to the provider through the API.
- Disbursements (paying drivers or suppliers by mobile money) are not part of this module.
- Phone-network detection (`networkOf`) is only advisory; numbers can be ported between networks.
