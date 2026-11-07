import test from "node:test";
import assert from "node:assert/strict";
import { codeFor, normaliseSettings, resolveSettings, settingsSchema } from "../src/services/recycling-settings";

test("a company with no saved settings gets today's lists and rules", () => {
  const s = resolveSettings({});
  assert.equal(s.expenseCategories.length, 12);
  assert.deepEqual(s.qualityGrades.map(o => o.code), ["sorted", "clean", "mixed", "contaminated"]);
  assert.deepEqual(s.rules, { supplierCreditDays: 30, buyerPaymentDays: 30, dueSoonDays: 7 });
  assert.equal(s.costFields.sorting.utilitiesUgx.label, "Power / utilities");
});

test("saved labels, switches and custom options are merged over the defaults", () => {
  const s = resolveSettings({ expenseCategories: [{ code: "food", label: "Meals", active: true }, { code: "payroll", label: "Payroll", active: false }, { code: "generator_fuel", label: "Generator fuel", active: true }], rules: { dueSoonDays: 3, supplierCreditDays: "bad" } });
  assert.equal(s.expenseCategories.find(o => o.code === "food")?.label, "Meals");
  assert.equal(s.expenseCategories.find(o => o.code === "payroll")?.active, false);
  assert.equal(s.expenseCategories.at(-1)?.code, "generator_fuel");
  assert.deepEqual(s.rules, { supplierCreditDays: 30, buyerPaymentDays: 30, dueSoonDays: 3 });
});

test("new options get a code, built-in ones cannot be deleted, and at least one stays on", () => {
  const current = resolveSettings({});
  const change = normaliseSettings(settingsSchema.parse({ expenseCategories: [{ label: "Generator fuel", active: true }] }), current);
  const codes = change.expenseCategories!.map(o => o.code);
  assert.ok(codes.includes("generator_fuel"));
  assert.ok(codes.includes("food"), "missing built-in categories are kept");
  assert.throws(() => normaliseSettings(settingsSchema.parse({ qualityGrades: current.qualityGrades.map(o => ({ ...o, active: false })) }), current), /at least one/);
  assert.throws(() => normaliseSettings(settingsSchema.parse({ expenseCategories: [{ label: "Fuel!", active: true }, { label: "fuel", active: true }] }), current), /listed twice/);
  assert.equal(codeFor("Bags & Twine"), "bags_twine");
});
