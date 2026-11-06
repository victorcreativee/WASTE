import assert from "node:assert/strict";
import test from "node:test";
import { types } from "pg";
import type { PoolClient } from "pg";
import { dbPool } from "../src/config/database";
import { updateLot, updateSale } from "../src/repositories/recycling.repository";

const org = "aaaaaaaa-0000-4000-8000-000000000001", user = "aaaaaaaa-0000-4000-8000-000000000002", id = "aaaaaaaa-0000-4000-8000-000000000003";

/** A connection that answers the few reads an edit makes and records every statement. */
function fakeConnection(answers: [RegExp, Record<string, unknown>][]) {
  const queries: { text: string; values: unknown[] }[] = [];
  const client = {
    query: async (text: string, values: unknown[] = []) => {
      queries.push({ text, values });
      const answer = answers.find(([pattern]) => pattern.test(text));
      return { rows: answer ? [answer[1]] : [], rowCount: answer ? 1 : 0 };
    },
    release: () => undefined,
  } as unknown as PoolClient;
  return { queries, connect: async () => client };
}

test("a DATE column reaches clients as the stored day, not the server's local midnight", () => {
  // On a Kampala server node-postgres used to send 22 October as "2026-10-21T21:00:00.000Z",
  // and the admin edit form cut that to 21 October.
  assert.equal(types.getTypeParser(types.builtins.DATE)("2026-10-22"), "2026-10-22");
});

test("moving a purchase to 22 October moves the payment and float spent with it", async (t) => {
  const lot = { id, organization_id: org, origin: "purchase", collected_on: "2026-10-21", quantity_kg: "100", available_kg: "100", unit_purchase_price_ugx: "500", worker_wages_ugx: "0", food_ugx: "0", transport_ugx: "0", driver_fee_ugx: "0", other_expense_ugx: "0", purchase_payment_status: "paid" };
  const fake = fakeConnection([
    [/FROM recycling_material_lots WHERE id=\$1::uuid AND organization_id=\$2::uuid AND origin='purchase' FOR UPDATE/, lot],
    [/FROM recycling_material_catalog/, { name: "PET bottles", active: true }],
    [/SUM\(amount_ugx\),0\)::bigint paid FROM recycling_purchase_payments/, { paid: "50000" }],
    [/organization_available_to_commit/, { available: "1000000" }],
    [/^UPDATE recycling_material_lots SET material_type/, { ...lot, collected_on: "2026-10-22" }],
  ]);
  t.mock.method(dbPool, "connect", fake.connect);
  await updateLot(org, user, id, { materialType: "PET bottles", sourceName: "Owino market", quantityKg: 100, unitPurchasePriceUgx: 500, collectedOn: "2026-10-22", quality: "mixed", workerWagesUgx: 0, foodUgx: 0, transportUgx: 0, driverFeeUgx: 0, otherExpenseUgx: 0 });

  const moved = (table: string) => fake.queries.find((q) => q.text.startsWith(`UPDATE ${table} SET`) && q.values.includes("2026-10-21"));
  assert.deepEqual(moved("recycling_purchase_payments")?.values, [org, id, "2026-10-21", "2026-10-22"], "supplier payment follows the purchase day");
  assert.deepEqual(moved("recycling_manager_float_transactions")?.values, [org, id, "2026-10-21", "2026-10-22"], "float spent follows the purchase day");
  assert.equal(fake.queries.at(-1)?.text, "COMMIT");
});

test("a purchase edit that keeps its day leaves payments alone", async (t) => {
  const lot = { id, organization_id: org, origin: "purchase", collected_on: "2026-10-22", quantity_kg: "100", available_kg: "100", unit_purchase_price_ugx: "500", worker_wages_ugx: "0", food_ugx: "0", transport_ugx: "0", driver_fee_ugx: "0", other_expense_ugx: "0", purchase_payment_status: "paid" };
  const fake = fakeConnection([
    [/FOR UPDATE/, lot],
    [/FROM recycling_material_catalog/, { name: "PET bottles", active: true }],
    [/bigint paid FROM recycling_purchase_payments/, { paid: "50000" }],
    [/organization_available_to_commit/, { available: "1000000" }],
    [/^UPDATE recycling_material_lots SET material_type/, lot],
  ]);
  t.mock.method(dbPool, "connect", fake.connect);
  await updateLot(org, user, id, { materialType: "PET bottles", sourceName: "Owino market", quantityKg: 100, unitPurchasePriceUgx: 500, collectedOn: "2026-10-22", quality: "mixed", workerWagesUgx: 0, foodUgx: 0, transportUgx: 0, driverFeeUgx: 0, otherExpenseUgx: 0 });
  assert.equal(fake.queries.some((q) => /^UPDATE recycling_(purchase_payments|manager_float_transactions)/.test(q.text)), false);
});

test("moving a sale to 22 October moves the float spent on its costs", async (t) => {
  const sale = { id, organization_id: org, lot_id: id, sold_on: "2026-10-23", quantity_kg: "40", unit_price_ugx: "900", worker_wages_ugx: "0", food_ugx: "0", transport_ugx: "0", other_expense_ugx: "0", status: "recorded", buyer_name: "Plastic Recyclers Ltd" };
  const fake = fakeConnection([
    [/FROM recycling_material_sales s?\s*WHERE|FROM recycling_material_sales WHERE id/, sale],
    [/FROM recycling_material_lots/, { id, available_kg: "60", quantity_kg: "100", material_type: "PET bottles", collected_on: "2026-10-21" }],
    [/^UPDATE recycling_material_sales SET lot_id/, { ...sale, sold_on: "2026-10-22" }],
    [/FROM recycling_sale_payments/, { paid: "0" }],
  ]);
  t.mock.method(dbPool, "connect", fake.connect);
  await updateSale(org, user, id, { lotId: id, buyerName: "Plastic Recyclers Ltd", saleChannel: "direct", industry: "plastics", quantityKg: 40, unitPriceUgx: 900, soldOn: "2026-10-22", workerWagesUgx: 0, foodUgx: 0, transportUgx: 0, otherExpenseUgx: 0 });
  const moved = fake.queries.find((q) => q.text.startsWith("UPDATE recycling_manager_float_transactions SET transaction_date"));
  assert.deepEqual(moved?.values, [org, id, "2026-10-23", "2026-10-22"]);
});
