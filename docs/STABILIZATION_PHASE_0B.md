# Phase 0B — financial control stabilization
Date: 3 September 2026

## Result and deployment

Migration [023_finance_stabilization.sql](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/infrastructure/database/023_finance_stabilization.sql) was applied to the existing local development database. Existing opening settings were compared before/after and preserved. No financial records, payroll periods or accounts were cleared. The test suite rolls back its fixtures.

The migration replaces only the cash-position calculation's unset-date fallback and adds organization_finance_setting_history plus an index. Existing settings are snapshotted as “baseline” where applicable; that is not a reconstruction of earlier history. No service endpoints or frontend routes were added.

## Controls delivered

### Opening balance

- An organization without an opening setting now uses a fixed 1970-01-01 lower bound, instead of CURRENT_DATE. Yesterday's receipts/payments no longer disappear from cash the next day.
- The frontend explicitly labels an unset opening balance; it does not present today's date as a verified opening.
- The opening setting is the starting balance, not a deposit/top-up facility.
- Dates must be between 1970-01-01 and today. Initial setup cannot exclude an existing cash movement by choosing a later cutoff.
- Once a setting exists and any successful receipt/paid expense/supplier payment exists, replacing its amount/date is rejected.
- Before cash posting, corrections are allowed only if the resulting cash covers existing commitments; successful changes retain previous/new amount/date, actor and timestamp.
- Identical saves are idempotent: they do not create duplicate history.
- The finance-position response includes configured/locked flags and the latest 20 history entries. The modal shows these as a compact table, disables locked fields and gives inline errors.
- The history table currently has no application update/delete API. This is not yet the platform-wide tamper-evident audit system.

### Supplier payment

- Payment dates before the configured opening cutoff or after today are rejected before updating the bill.
- Positive valid amounts, invoice balance, cash availability and duplicate-reference checks remain enforced.
- Rejected payments do not change supplier balance or cash.
- Backdating within the permitted range records the selected payment date; this is not a historical-bank-balance reconstruction or reconciliation engine.

### Payroll and shared funding

- Payroll period creation, payroll line edits, payroll approval/payment, opening-setting changes and supplier payments use the same organization finance transaction lock.
- Line edits additionally lock/recheck the parent draft period. A line cannot change after approval while preserving an outdated approved total.
- Period creation is serialized so two application requests cannot both pass the overlap check.
- Existing expense, manual receipt and payment-confirmation writers already use that finance lock.
- Expense “paid this month” summary now follows paid date (legacy fallback: expense date), consistent with the reporting correction.

## API changes

| Existing endpoint | Change |
|---|---|
| GET /api/waste/finance/position | Adds opening_balance_configured, opening_balance_locked and opening_balance_history |
| PUT /api/waste/finance/position/opening-balance | Serialized, history-recorded update; invalid date, locked setting or underfunded commitments return 409 |
| POST /api/waste/finance/payables/bills/:billId/payments | Date outside cutoff…today returns 409 without mutation |
| POST /api/auth/organization-payroll/periods | Shared organization lock serializes overlap check/create |
| PUT /api/auth/organization-payroll/periods/:periodId/lines | Shared lock plus parent-period row lock and draft recheck |
| PATCH /api/auth/organization-payroll/periods/:periodId/status | Existing finance lock now coordinates with line edits and period creation |
| GET /api/waste/finance/expenses | Paid-month total uses payment date |

Frontend pages changed: /dashboard/billing and /dashboard/accounts-payable. Existing company-only authorization is preserved.

## Verification

- 111 database/HTTP assertions passed: the 72 Phase 0A assertions plus 39 financial-control assertions.
- Includes five separate-session blocking tests verifying that period creation, line editing, approval, opening-setting updates and supplier payment wait for the same finance lock.
- Tests verify rejection of an unfunded payroll, immutable approved lines, one payroll payment, cutoff errors, preserved cash/bill balances, opening history, no duplicate history, and understandable API conflicts.
- 28 backend unit tests and 7 frontend tests passed.
- Waste/Auth and frontend TypeScript passed; frontend lint passed.
- No browser automation was performed. The lock checks test real cross-session blocking plus sequential state invariants; they are not an exhaustive concurrent workload/stress test.
- Fixture writes and the test-time migration execution are enclosed in an outer rollback transaction. The actual local migration was applied separately using the runner below.

## Repeat automated checks

From the waste service:
```sh
cd "/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/waste-service"
npm test
npm run typecheck
npm run test:finance
```

Expected final output: “PASS: 111 stabilization assertions” and “All fixture records rolled back.” The finance suite starts its own temporary HTTP servers and uses a second PostgreSQL connection for lock tests. It refuses production/non-loopback databases. No persistent demo credentials are created.

Frontend:
```sh
cd "/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/apps/admin-web"
node --test tests/*.test.cjs
npm run lint
./node_modules/.bin/tsc --noEmit --incremental false
```

Auth:
```sh
cd "/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/auth-service"
./node_modules/.bin/tsc --noEmit
```

Migration runner (already applied locally; for another local checkout with migrations through 022):
```sh
cd "/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/waste-service"
npm run migrate:finance-stabilization
```

The runner uses one transaction, a short lock timeout and verifies that existing opening-setting rows are unchanged. Re-running does not duplicate baseline history. Do not remove or reverse this migration while running the new application code: the financial-position query requires its history table.

## Manual testing steps and expected results

Restart Auth and Waste development services; reload the frontend. If using compiled dist services, rebuild before restarting. Keep the existing Organization service and gateway running.

Use a dedicated test organization with no cash activity for the full scenario. If your current organization already has records, run the rollback suite instead of deleting or editing those records just for testing.

1. Open **Income & billing → Set opening balance**. Enter UGX 5,000,000 and today's date. Save.
   - Modal closes after success; cash is 5,000,000 (assuming no other activity).
   - **View opening balance** shows one created-history entry.
2. In Payroll, create a non-overlapping test period and add a net payroll line of 5,800,000.
   - Approval is blocked against 5,000,000 available funds; no approved commitment is added.
3. Change the draft total to 4,000,000, then approve.
   - Committed payroll is 4,000,000; available to commit is 1,000,000.
   - A later API/edit attempt against its lines is rejected. The approved total remains unchanged.
4. Before paying, try reducing the opening amount to 3,000,000.
   - Rejected with an explanation; original 5,000,000 setting and history are unchanged.
5. Pay the approved payroll once.
   - Cash becomes 1,000,000; the payroll commitment is released and the paid expense is recorded once.
   - Repeating the payment cannot create another expense.
6. Open the opening-balance modal.
   - It is locked, shows history, and explains why replacing the opening amount is not a valid top-up.
7. Create a funded test supplier bill of 500,000, then open Record payment.
   - Try a date before the opening date: API rejects it with an inline message; amount/date remain available to correct.
   - A future date is prevented by the date field and rejected by the API if submitted directly.
   - Use today: payment succeeds, bill becomes paid, cash becomes 500,000.
8. Refresh Income & billing and Reports.
   - Cash totals agree with recorded payments. No test record should be deleted to make the totals match.

If setting an initial opening balance on an organization with older cash movements, use a date on/before the earliest movement and an accurate verified starting amount. The API will tell you when the chosen cutoff would hide a movement. Do not use a fabricated amount to remove a deficit.

## Remaining work / next phase

Proceed to Phase 1: explicit organization memberships, database-driven module/action permissions and an audit-event foundation, migrating existing accounts safely.

These controls do not constitute complete accounting. Still pending: a reviewed adjustment/journal workflow for additional capital/corrections, historical discrepancy reconciliation, supplier-liability/duplicate-bill improvements, contract lifecycle consistency, and broader cross-module permission testing. There is intentionally no silent override for locked opening balances.

## Exact files changed

- [infrastructure/database/023_finance_stabilization.sql](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/infrastructure/database/023_finance_stabilization.sql)
- [services/waste-service/src/repositories/expense.repository.ts](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/waste-service/src/repositories/expense.repository.ts)
- [services/waste-service/src/repositories/payables.repository.ts](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/waste-service/src/repositories/payables.repository.ts)
- [services/auth-service/src/repositories/payroll.repository.ts](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/auth-service/src/repositories/payroll.repository.ts)
- [apps/admin-web/src/app/dashboard/billing/page.tsx](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/apps/admin-web/src/app/dashboard/billing/page.tsx)
- [apps/admin-web/src/app/dashboard/accounts-payable/page.tsx](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/apps/admin-web/src/app/dashboard/accounts-payable/page.tsx)
- [services/waste-service/scripts/apply-finance-stabilization.cjs](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/waste-service/scripts/apply-finance-stabilization.cjs)
- [services/waste-service/scripts/finance-controls.cjs](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/waste-service/scripts/finance-controls.cjs)
- [services/waste-service/scripts/test-stabilization.cjs](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/waste-service/scripts/test-stabilization.cjs)
- [services/waste-service/package.json](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/services/waste-service/package.json)
- [docs/STABILIZATION_PHASE_0B.md](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/docs/STABILIZATION_PHASE_0B.md)
- [docs/IMPLEMENTATION_PROGRESS.md](/Users/Victorcreativee/Desktop/DATA/PossibleMindset/Projects/WASTE/docs/IMPLEMENTATION_PROGRESS.md)
