import assert from "node:assert/strict";
import test from "node:test";
import { dbPool } from "../src/config/database";
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
    if (/FROM recycling_manager_float_transactions movement[\s\S]*WHERE movement\.organization_id=\$1::uuid/.test(text)) return { rows: latest100 };
    if (/FROM recycling_stock_adjustments a/.test(text)) return { rows: [{ adjustment_type: "loss", quantity_kg: "1" }] };
    return { rows: [] };
  });
  const result: any = await findRecycling(org);
  assert.equal(result.summary.floatBalanceUgx, 494650);
  assert.deepEqual([result.summary.stockAddedKg, result.summary.stockRemovedKg, result.summary.lossKg], [12.5, 40, 30]);
  assert.equal(result.floatTransactions.length, 100, "the list itself stays capped");
});
