import test from "node:test";
import assert from "node:assert/strict";
import { custodyState, validateBatchInputs, yieldRate } from "../src/services/factory.rules";

const today = "2026-10-21";

test("deliveries await receipt for 7 days, then become overdue", () => {
  assert.equal(custodyState({ sold_kg: 1000, sold_on: "2026-10-14", received_kg: null }, today), "awaiting");
  assert.equal(custodyState({ sold_kg: 1000, sold_on: "2026-10-13", received_kg: null }, today), "overdue");
});

test("a received delivery is a shortfall only when more than 5% and at least 10 kg are missing", () => {
  assert.equal(custodyState({ sold_kg: 1000, sold_on: "2026-10-01", received_kg: 960 }, today), "received", "4% missing");
  assert.equal(custodyState({ sold_kg: 1000, sold_on: "2026-10-01", received_kg: 940 }, today), "shortfall", "6% missing");
  assert.equal(custodyState({ sold_kg: 100, sold_on: "2026-10-01", received_kg: 92 }, today), "received", "8% but under 10 kg");
  assert.equal(custodyState({ sold_kg: 1000, sold_on: "2026-10-01", received_kg: 1020 }, today), "received", "more received than sold");
});

test("yield is output over input", () => {
  assert.equal(yieldRate(780, 1000), 78);
  assert.equal(yieldRate(1, 3), 33.3);
  assert.equal(yieldRate(0, 0), null);
});

const stock = [
  { id: "a", available_kg: 500, status: "received", material_category: "plastic" },
  { id: "b", available_kg: 300, status: "received", material_category: "plastic" },
  { id: "v", available_kg: 200, status: "voided", material_category: "plastic" },
];

test("a batch draws on received intakes with enough remaining material", () => {
  assert.equal(validateBatchInputs([{ intakeId: "a", kg: 400 }, { intakeId: "b", kg: 300 }], stock, 560, 120), 700);
});

test("batch inputs are refused when they overdraw, repeat, are voided, foreign, or produce too much", () => {
  assert.throws(() => validateBatchInputs([], stock, 0, 0), /at least one intake/);
  assert.throws(() => validateBatchInputs([{ intakeId: "a", kg: 501 }], stock, 0, 0), /Only 500 kg remain/);
  assert.throws(() => validateBatchInputs([{ intakeId: "a", kg: 1 }, { intakeId: "a", kg: 2 }], stock, 0, 0), /only once/);
  assert.throws(() => validateBatchInputs([{ intakeId: "v", kg: 10 }], stock, 0, 0), /voided/);
  assert.throws(() => validateBatchInputs([{ intakeId: "x", kg: 10 }], stock, 0, 0), /does not belong/);
  assert.throws(() => validateBatchInputs([{ intakeId: "a", kg: 100 }], stock, 90, 20), /cannot exceed the material put in/);
});
