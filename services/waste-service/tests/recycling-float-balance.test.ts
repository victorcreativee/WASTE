import assert from "node:assert/strict";
import test from "node:test";
import { dbPool } from "../src/config/database";
import { companyReport } from "../src/repositories/company-report.repository";
import { findRecycling } from "../src/repositories/recycling.repository";

const org = "7bf6a258-0000-4000-8000-000000000001";

test("manager float and stock adjustments are totalled over every entry, not the latest 100 shown", async (t) => {
  // Wallas Ecotrade on 31 Oct: 102 float entries. The latest 100 add up to -196,298 because the oldest 700,000
  // given on 12 Oct falls off the list; the real balance is 494,650.
  const latest100 = [
    ...Array.from({ length: 99 }, (_, i) => ({ id: `s${i}`, transaction_type: "spent", amount_ugx: "10000", transaction_date: "2026-10-22" })),
    { id: "g", transaction_type: "given", amount_ugx: "600000", transaction_date: "2026-10-22" },
  ];
  const context = { id: org, type: "recycling_company", operating_date: "2026-10-31", cash_position_ugx: "1844650", float_balance_ugx: "494650", stock_added_kg: "12.5", stock_removed_kg: "40", loss_kg: "30" };
  t.mock.method(dbPool, "query", async (text: string) => {
    if (/FROM organizations o LEFT JOIN organization_finance_settings/.test(text)) return { rows: [context] };
    if (/FROM organizations WHERE id/.test(text)) return { rows: [context] };
    if (/FROM recycling_manager_float_transactions movement[\s\S]*WHERE movement\.organization_id=\$1::uuid/.test(text)) return { rows: latest100 };
    if (/FROM recycling_stock_adjustments a/.test(text)) return { rows: [{ adjustment_type: "loss", quantity_kg: "1" }] };
    return { rows: [] };
  });
  const result: any = await findRecycling(org);
  assert.equal(result.summary.floatBalanceUgx, 494650);
  assert.deepEqual([result.summary.stockAddedKg, result.summary.stockRemovedKg, result.summary.lossKg], [12.5, 40, 30]);
  assert.equal(result.floatTransactions.length, 100, "the list itself stays capped");
});

test("the workspace profit is the company report's profit, after operating expenses and stock losses", async (t) => {
  const lot = { id: "lot", origin: "purchase", material_type: "PET", quantity_kg: "100", available_kg: "40", unit_purchase_price_ugx: "500", total_cost_ugx: "50000", collected_on: "2026-10-01" };
  const sale = { id: "sale", lot_id: "lot", material_type: "PET", buyer_name: "Buyer", quantity_kg: "50", unit_price_ugx: "2000", total_ugx: "100000", expenses_ugx: "5000", transport_ugx: "5000", sold_on: "2026-10-02", status: "paid", balance_ugx: "0" };
  const context = { id: org, name: "Test", type: "recycling_company", operating_date: "2026-10-31" };
  const client = { query: async (text: string) => {
    if (/^(BEGIN|COMMIT|ROLLBACK)/.test(text)) return { rows: [] };
    if (/FROM organizations/.test(text)) return { rows: [context] };
    if (/FROM recycling_material_lots/.test(text)) return { rows: [lot] };
    if (/FROM recycling_material_sales/.test(text)) return { rows: [sale] };
    if (/FROM organization_expenses/.test(text)) return { rows: [{ id: "e", category: "rent", amount_ugx: "12000", status: "paid", expense_date: "2026-10-03" }] };
    if (/FROM recycling_stock_adjustments/.test(text)) return { rows: [{ lot_id: "lot", adjustment_type: "loss", quantity_kg: "10", adjustment_date: "2026-10-04" }] };
    return { rows: [] };
  } };
  t.mock.method(dbPool, "query", client.query);
  t.mock.method(dbPool, "connect", async () => ({ ...client, release() {} }));
  const { summary }: any = await findRecycling(org);
  const report = await companyReport(org, "2026-10-01", "2026-10-31");
  assert.equal(summary.tradingProfitUgx, 70000);
  assert.deepEqual([summary.operatingExpensesUgx, summary.stockLossUgx], [12000, 5000]);
  assert.equal(summary.profitLossUgx, 53000);
  assert.equal(summary.profitLossUgx, report.summary.operatingProfitUgx);
});
