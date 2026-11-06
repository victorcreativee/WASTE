# KWMS — Investor portal

For recycling companies. Migration **131**.

## What investors see

**Investor overview** (`/dashboard/investor`) is the only screen an investor account has. For the last 12 months it shows:
- sales, operating profit, margin, and growth between the last two finished months
- sales and operating profit by month, and a monthly results table
- what the company owns (cash, stock at cost, owed by buyers) and owes (suppliers, loans), and the net position
- trade concentration, for example "largest buyer's share of sales", without naming anyone
- sales by material, and weighed material collected, sold and not recyclable
- updates written by the company
- their own investment: invested, paid out, share, and their share of the net position (an estimate, not a valuation)

**Print or save as PDF** prints the page as a report.

The company owner and administrator see the same page with every investor listed.

## What investors cannot reach

Operational data names staff, suppliers and buyers, so the investor role holds no read permissions (131 removed them).
`GET /recycling/investor-overview` admits it by role. Its response carries no buyer, supplier or staff name, and no
other investor's position. The phone app sends investors to this page on the website.

## Managing investors

**Investors** (`/dashboard/investors`, *Finance*) needs `recycling.finance.manage`.

- **An investor** has a name, an optional share, and an optional sign-in. Shares of active investors cannot pass 100%.
  Sign-ins are "Investor / guest" accounts from Staff management.
- **Record money** adds an investment or payout. It moves office cash through a cash movement (`capital_contribution`
  in, `owner_withdrawal` out). Choose "already counted" for money that is in the opening balance. Recorded money cannot
  be edited; it is in the audit log.
- **Updates** reach every investor of the company and can be removed.

| Endpoint | Who |
|---|---|
| `GET /api/waste/recycling/investor-overview` | company admin, owner (all investors); investor (their own) |
| `GET /api/waste/recycling/investors` | `recycling.finance.manage` |
| `POST /api/waste/recycling/investors`, `PATCH …/:id` | `recycling.finance.manage` |
| `POST /api/waste/recycling/investors/:id/transactions` | `recycling.finance.manage` |
| `POST /api/waste/recycling/investor-updates`, `DELETE …/:id` | `recycling.finance.manage` |

## Not covered yet

- Correcting recorded money. A mistake needs an opposite entry.
- Dividends worked out from shares. Payouts are entered one at a time.
- Carbon figures. KCCA has not confirmed the factors, so impact is in weighed kilograms only.
- Figures are from the company's own records and are not audited.

## Correcting and sharing money

- **Cancel entry** undoes a mistake. The entry stays on the record, marked cancelled and left out of the totals. Cash it moved goes back through a `correction` cash movement dated today, so closed days stay as they were. Returning an investment needs enough office cash.
- **Share a payout** takes one amount for the whole company and pays each active investor their share, rounded down, as one entry each with references `<reference>/1`, `/2` and so on. What other holders would have received stays in the company.
- Investors are notified in the app and by email about updates, money that moved now, and cancellations. Entries marked "already counted" send nothing, so loading past history doesn't message anyone.
