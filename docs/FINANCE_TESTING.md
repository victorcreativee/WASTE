# Organization finance: clean-start testing

Use the Green Kampala company-admin account. These steps intentionally create test transactions; they do not send real bank or mobile-money payments. Do not run them against real financial records.

## 1. Check the baseline

Open **Income & billing**. This sequence assumes cash, committed funds and customer receivables are all zero after the requested reset. If they are not zero, inspect the existing records before continuing; do not overwrite the opening balance just to hide a discrepancy.

Set the opening balance to **UGX 5,000,000** as of the start of today's testing date. The opening amount is money held before transactions on that date—not a replacement for the current balance. Payments on the same date are included. The modal should close, with no reset error.

Expected: cash 5,000,000; committed 0; available to commit 5,000,000.

## 2. Expense approval and payment

1. Under **Expenses**, record a fuel expense of **6,000,000**. Draft creation is allowed; no money is reserved yet.
2. Approval must be disabled. A visible message must show a **1,000,000** shortfall. Void this draft after checking.
3. Record another expense of **1,000,000**. Confirm the form clears and closes after saving.
4. Approve it. Expected: cash **5,000,000**, committed **1,000,000**, available **4,000,000**.
5. Click **Mark paid**, then cancel the confirmation. All values must remain unchanged.
6. Click **Mark paid** again and confirm the simulated payment. Expected: cash **4,000,000**, committed **0**, available **4,000,000**. The paid record must not offer another payment or void action.

## 3. Payroll and shared commitments

1. Create one non-overlapping payroll period; the modal must close after success.
2. Add an active staff member with basic pay **5,800,000**, no allowance or deduction. Save and close the form.
3. Approval must be disabled with a visible **1,800,000** shortfall against the remaining **4,000,000**.
4. Use **Add or update staff pay**, select the same employee, and change basic pay to **2,000,000**. This updates the existing line, not a duplicate.
5. Approve payroll. Expected: cash **4,000,000**, committed **2,000,000**, available **2,000,000**.
6. Refresh **Income & billing** in another tab. Try a draft expense of **3,000,000**: approval must be blocked with a **1,000,000** shortfall. Void that test draft.
7. Return to Payroll, refresh, and mark the approved payroll paid. Confirm the payment prompt.
8. Expected: cash **2,000,000**, committed **0**, available **2,000,000**. Under Expenses there must be one automatically posted paid payroll expense; do not manually enter it again.

## 4. Customer income

1. Choose an active service package and note its fee as **F**.
2. Create a contract for an existing customer and service location using that package. Keep package pricing unchanged for this test.
3. Activate the draft once. Confirm one subscription and one initial invoice for **F** exist.
4. Before receiving payment: cash stays **2,000,000**; receivables increase by **F**. An invoice is not received money.
5. Record and confirm a full test payment using the supported organization payment flow.
6. Expected: cash and available become **2,000,000 + F**; the invoice balance becomes zero. Refresh to verify the payment is counted once.

## 5. Procurement reservation check

Use a separate test purchase order below the remaining available amount. Issuing it should reserve its total without reducing cash. Receiving it should not reserve the amount twice. A supplier bill linked to that received order should replace—not duplicate—the purchase-order commitment. A supplier payment should reduce cash and the unpaid bill by the same amount.

Detailed supplier test (starting with at least UGX 1,000,000 available):

1. Note cash as **C** and available-to-commit funds as **A**. Create a draft order for 10 units at UGX 100,000 each. Draft creation must not reserve funds.
2. Issue the order. Cash stays **C**; available becomes **A − 1,000,000**.
3. Receive the order, then open Accounts payable. Select that received order when recording its bill. Its total and supplier should be populated automatically.
4. Save the bill. Available stays **A − 1,000,000**, not **A − 2,000,000**.
5. Open Record payment, enter UGX 400,000 and cancel the confirmation. No balance should change.
6. Submit again and confirm. Cash becomes **C − 400,000**; the bill balance is UGX 600,000. Available stays **A − 1,000,000**, because cash and the commitment decrease equally.
7. If a payment amount exceeds cash, a visible shortfall must appear and submission must be disabled. An amount below both cash and the unpaid bill balance should remain possible as a partial payment.
8. Create a second draft order larger than current available funds. Issuing it must be disabled with a visible shortfall. Cancel the draft when finished.

The summary is organization-specific; city/system-wide views do not combine different organizations into one spendable balance. Backend role permissions remain authoritative.

## Pass criteria and limitations

### Fleet-to-finance check

1. In Fleet control, select a vehicle and record fuel costing UGX 100,000.
2. Its history must show “awaiting approval” with a linked expense number. Income & billing → Expenses must contain one matching draft. Do not enter that fuel expense a second time manually.
3. Approve and pay through Expenses using the existing funding checks. Refresh Fleet control: the finance status should now show paid.
4. Schedule maintenance costing UGX 200,000. It must not create an expense while scheduled or in progress.
5. Complete that maintenance. Exactly one draft maintenance expense must appear. Repeating completion must not duplicate it.
6. A zero-cost record must not create an expense. Existing historical fleet records are not backfilled; review them against existing expenses manually before adding any missing historical costs.

Developer integration check: from `services/waste-service`, run `node scripts/test-fleet-finance.cjs`. It requires migration 022 and a local organization with a truck/user, and rolls back all test records.

- Refresh other tabs after financial changes; balances are snapshots, not a live bank feed.
- A disabled action must explain the amount, funds available and shortage visibly, including on mobile.
- Failed requests must leave records and balances unchanged; retry only after checking whether the previous request succeeded.
- Backend checks must also reject insufficient-funds requests sent outside the UI.
- These checks cover the displayed cash/commitment workflow, not a full accounting, tax or bank reconciliation audit.
- Keep the generated test records for review. Do not perform another reset unless explicitly requested.

## Developer verification

From `apps/admin-web`: `node --test tests/funding-shortfall.test.cjs`, `npm run lint`, and `npx tsc --noEmit`.

The component tests verify wording and shortage calculations. They do not prove database concurrency, browser interactions, or payment-provider execution; follow the workflow above for integration testing.
