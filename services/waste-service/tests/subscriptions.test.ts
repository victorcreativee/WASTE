import assert from "node:assert/strict";
import test from "node:test";
import { BILLING_RULES, FULL_ACCESS, addMonths, dueOn, monthlyValue, overdueEffect, periodEnd, planChange, priceFor, proration } from "../src/services/subscription.rules";

const standard = { monthly_fee_ugx: 150000, annual_fee_ugx: 1500000, max_vehicles: 5, max_users: 15 };
const professional = { monthly_fee_ugx: 350000, annual_fee_ugx: 3500000, max_vehicles: null, max_users: null };

test("billing periods follow the calendar, including month ends and leap years", () => {
  assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
  assert.equal(addMonths("2028-01-31", 1), "2028-02-29");
  assert.equal(periodEnd("2026-10-22", "monthly"), "2026-11-22");
  assert.equal(periodEnd("2026-10-22", "annual"), "2027-10-22");
});

test("prices, monthly value and payment terms", () => {
  assert.equal(priceFor(standard, "monthly"), 150000);
  assert.equal(priceFor(standard, "annual"), 1500000);
  assert.equal(monthlyValue(standard, "annual"), 125000);
  assert.equal(dueOn("2026-10-22"), "2026-10-29");
  assert.equal(BILLING_RULES.daysToPay, 7);
});

test("an upgrade part-way through a period is charged for the days that remain", () => {
  assert.equal(proration(150000, 350000, "2026-10-01", "2026-10-31", "2026-10-16"), 100000);
  assert.equal(proration(150000, 350000, "2026-10-01", "2026-10-31", "2026-10-31"), 0);
  assert.equal(proration(350000, 150000, "2026-10-01", "2026-10-31", "2026-10-16"), 0, "no refund on downgrade");
  assert.equal(proration(150000, 350000, "2026-10-01", "2026-10-31", "2026-10-02") % BILLING_RULES.roundTo, 0);
});

test("unpaid invoices make the subscription past due, then suspended", () => {
  assert.equal(overdueEffect("2026-10-29", "2026-10-29"), "none");
  assert.equal(overdueEffect("2026-10-29", "2026-10-30"), "past_due");
  assert.equal(overdueEffect("2026-10-29", "2026-11-12"), "past_due");
  assert.equal(overdueEffect("2026-10-29", "2026-11-13"), "suspend");
  assert.ok(FULL_ACCESS.includes("past_due") && !FULL_ACCESS.includes("suspended") && !FULL_ACCESS.includes("cancelled"));
});

test("dearer plans apply now; cheaper ones at period end and only within their limits", () => {
  assert.deepEqual(planChange(standard, professional, { vehicles: 9, users: 30 }), { timing: "now", blocked: null });
  assert.deepEqual(planChange(professional, standard, { vehicles: 4, users: 10 }), { timing: "period_end", blocked: null });
  assert.match(planChange(professional, standard, { vehicles: 9, users: 20 }).blocked ?? "", /9 vehicles \(the plan allows 5\) and 20 active staff/);
});
