import assert from "node:assert/strict";
import test from "node:test";
import { buildInvestorReport, reportingMonths, shareOut, withRunningBalance } from "../src/services/investor-report";
import { distributionSchema, investorSchema, reversalSchema, transactionSchema } from "../src/routes/investor.routes";

const lot = (id: string, material: string, kg: number, on: string) => ({ id, material_type: material, source_name: "Secret Supplier Ltd", origin: "purchase", quantity_kg: kg, available_kg: 0, unit_purchase_price_ugx: 100, worker_wages_ugx: 0, food_ugx: 0, transport_ugx: 0, driver_fee_ugx: 0, other_expense_ugx: 0, collected_on: on });
const sale = (id: string, buyer: string, kg: number, price: number, on: string, delivered = kg) => ({ id, lot_id: "l1", buyer_name: buyer, quantity_kg: kg, delivered_kg: delivered, unit_price_ugx: price, worker_wages_ugx: 0, food_ugx: 0, transport_ugx: 0, other_expense_ugx: 0, sold_on: on });
const records = {
  organization: { id: "o", name: "Test Recyclers", type: "recycling_company" },
  lots: [lot("l1", "Sacs", 10000, "2026-08-01")],
  sales: [sale("s1", "Big Secret Buyer", 1000, 300, "2026-09-10"), sale("s2", "Big Secret Buyer", 1500, 300, "2026-10-10", 1600), sale("s3", "Small Buyer", 500, 300, "2026-10-20")],
  saleLots: [], sorting: [{ input_lot_id: "l1", output_lot_id: "x", input_kg: 0, output_kg: 0, rejected_kg: 40, processing_cost_ugx: 0, processed_on: "2026-10-05" }], adjustments: [], expenses: [], purchasePayments: [], salePayments: [], float: [],
};

test("reporting months end with the current month, stopping today", () => {
  const months = reportingMonths("2026-11-06", 3);
  assert.deepEqual(months.map(m => m.month), ["2026-09", "2026-10", "2026-11"]);
  assert.equal(months[1].to, "2026-10-31");
  assert.equal(months[2].to, "2026-11-06");
  assert.equal(reportingMonths("2026-01-15", 2)[0].from, "2025-12-01");
});

test("the investor report totals months, compares finished months and values what is owned and owed", () => {
  const report = buildInvestorReport(records, { cashUgx: 500000, loansOwedUgx: 200000 }, "2026-11-06", 12);
  assert.equal(report.months.length, 12);
  assert.equal(report.totals.revenueUgx, 900000);
  assert.equal(report.growth.percent, 100, "October doubled September; the running month is left out");
  assert.equal(report.growth.month, "2026-10");
  assert.equal(report.position.loansOwedUgx, 200000);
  assert.equal(report.position.netPositionUgx, report.position.ownedUgx - report.position.owedUgx);
  assert.deepEqual(report.impact, { collectedKg: 10000, deliveredKg: 3100, soldKg: 3000, sortingWasteKg: 40, refusedByBuyersKg: 100 });
});

test("the investor report says how concentrated trade is, and never who the partners are", () => {
  const report = buildInvestorReport(records, { cashUgx: 0, loansOwedUgx: 0 }, "2026-11-06");
  assert.deepEqual(report.buyers, { count: 2, largestPercent: 83.3, topThreePercent: 100 });
  const text = JSON.stringify(report);
  for (const name of ["Big Secret Buyer", "Small Buyer", "Secret Supplier"]) assert.equal(text.includes(name), false, name);
});

test("growth is unknown without an earlier month to compare", () => {
  assert.equal(buildInvestorReport({ ...records, sales: [] }, { cashUgx: 0, loansOwedUgx: 0 }, "2026-11-06").growth.percent, null);
});

test("investors and their money are validated", () => {
  assert.equal(investorSchema.parse({ displayName: "Jane", userId: "" }).userId, undefined);
  assert.equal(investorSchema.safeParse({ displayName: "Jane", sharePercent: 120 }).success, false);
  const money = { transactionType: "investment", amountUgx: 5000000, transactionDate: "2026-11-01", reference: "INV-1" };
  assert.equal(transactionSchema.parse(money).movesCash, true);
  assert.equal(transactionSchema.safeParse({ ...money, transactionType: "gift" }).success, false);
  assert.equal(transactionSchema.safeParse({ ...money, amountUgx: 0 }).success, false);
});

test("a shared payout gives each investor their share and rounds down", () => {
  const parts = shareOut(1000001, [{ id: "a", share_percent: "33.33" }, { id: "b", share_percent: 10 }, { id: "c", share_percent: null }, { id: "d", share_percent: "0" }]);
  assert.deepEqual(parts.map(part => [part.investor.id, part.amountUgx]), [["a", 333300], ["b", 100000]]);
  assert.deepEqual(shareOut(1, [{ share_percent: 10 }]), [], "nobody is paid nothing");
});

test("the running balance is per investor, and cancelled entries leave it unchanged", () => {
  const rows = withRunningBalance([
    { investor_id: "b", transaction_type: "investment", amount_ugx: "50", reversed_at: null },
    { investor_id: "a", transaction_type: "payout", amount_ugx: "30", reversed_at: null },
    { investor_id: "a", transaction_type: "investment", amount_ugx: "999", reversed_at: "2026-11-06" },
    { investor_id: "a", transaction_type: "investment", amount_ugx: "100", reversed_at: null },
  ]);
  assert.deepEqual(rows.map(row => row.balanceUgx), [50, 70, 100, 100]);
});

test("shared payouts and cancellations are validated", () => {
  assert.equal(distributionSchema.safeParse({ totalUgx: 0, transactionDate: "2026-11-01", reference: "DIV-1" }).success, false);
  assert.equal(distributionSchema.parse({ totalUgx: 500, transactionDate: "2026-11-01", reference: "DIV-1" }).movesCash, true);
  assert.equal(reversalSchema.safeParse({ reason: "  " }).success, false);
});
