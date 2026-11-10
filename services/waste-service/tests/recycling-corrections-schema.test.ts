import assert from "node:assert/strict";
import test from "node:test";
import { cashSchema, stockCountSchema } from "../src/routes/recycling-corrections.routes";

const count = {
  countDate: "2026-11-10",
  reason: "Verified during the physical evening count",
  counts: [
    { material: "Soft plastic", physicalKg: 120.25 },
    { material: "Steel", physicalKg: 0 },
  ],
};

test("physical stock counts accept zero and fractional weights for distinct materials", () => {
  assert.ok(stockCountSchema.safeParse(count).success);
});

test("physical stock counts reject duplicate materials regardless of letter case", () => {
  assert.ok(!stockCountSchema.safeParse({ ...count, counts: [...count.counts, { material: "soft PLASTIC", physicalKg: 1 }] }).success);
});

test("physical stock counts require a reason and at least one material", () => {
  assert.ok(!stockCountSchema.safeParse({ ...count, reason: "no" }).success);
  assert.ok(!stockCountSchema.safeParse({ ...count, counts: [] }).success);
});

test("cash corrections remain positive whole UGX amounts", () => {
  const valid = { account: "office", direction: "reduce", amountUgx: 15000, correctionDate: "2026-11-10", reason: "Physical cash count difference" };
  assert.ok(cashSchema.safeParse(valid).success);
  assert.ok(!cashSchema.safeParse({ ...valid, amountUgx: 0 }).success);
  assert.ok(!cashSchema.safeParse({ ...valid, amountUgx: 1.5 }).success);
});
