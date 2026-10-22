import assert from "node:assert/strict";
import test from "node:test";
import { PENALTY_RULES, amountFor, appealOutcome, canAppeal, canEscalate, canMove, isOverdue, issueDates } from "../src/services/penalty.rules";

test("status moves follow the process; paid and withdrawn notices are final", () => {
  assert.ok(canMove("issued", "appealed"));
  assert.ok(canMove("payment_submitted", "issued"), "KCCA can reject a payment that did not arrive");
  assert.equal(canMove("appealed", "paid"), false, "an appeal is decided before payment");
  assert.equal(canMove("paid", "issued"), false);
  assert.equal(canMove("waived", "issued"), false);
});

test("dates from issue and repeat-offence amounts", () => {
  assert.deepEqual(issueDates("2026-10-21"), { appealDeadline: "2026-11-04", dueOn: "2026-11-20" });
  const item = { amount_ugx: 2000000, repeat_amount_ugx: 5000000 };
  assert.deepEqual(amountFor(item, 0), { offenceNumber: 1, amount: 2000000 });
  assert.deepEqual(amountFor(item, 2), { offenceNumber: 3, amount: 5000000 });
});

test("one appeal, only while unpaid and within the appeal period", () => {
  const notice = { status: "issued" as const, appeal_deadline: "2026-11-04", appealed_before: false };
  assert.equal(canAppeal(notice, "2026-11-04"), null);
  assert.match(canAppeal(notice, "2026-11-05") ?? "", /appeal period ended/);
  assert.match(canAppeal({ ...notice, appealed_before: true }, "2026-10-25") ?? "", /already been appealed/);
  assert.match(canAppeal({ ...notice, status: "paid" }, "2026-10-25") ?? "", /unpaid/);
});

test("appeal decisions: upheld keeps the amount, reduced lowers it, both give time to pay; withdrawn waives", () => {
  const notice = { amount_ugx: 2000000, due_on: "2026-11-20" };
  assert.deepEqual(appealOutcome(notice, { decision: "upheld" }, "2026-11-01"), { status: "issued", amount: 2000000, dueOn: "2026-11-20" }, "never earlier than the original due date");
  assert.deepEqual(appealOutcome(notice, { decision: "reduced", newAmount: 1200000 }, "2026-11-15"), { status: "issued", amount: 1200000, dueOn: "2026-11-29" });
  assert.equal(appealOutcome(notice, { decision: "withdrawn" }, "2026-11-15").status, "waived");
  assert.throws(() => appealOutcome(notice, { decision: "reduced", newAmount: 2000000 }, "2026-11-15"), /below the current amount/);
  assert.throws(() => appealOutcome(notice, { decision: "reduced", newAmount: 0 }, "2026-11-15"), /above zero/);
});

test("overdue and escalation", () => {
  assert.ok(isOverdue({ status: "issued", due_on: "2026-11-20" }, "2026-11-21"));
  assert.equal(isOverdue({ status: "appealed", due_on: "2026-11-20" }, "2026-12-01"), false, "an open appeal pauses it");
  const notice = { status: "issued" as const, due_on: "2026-11-20", escalated_at: null };
  assert.match(canEscalate(notice, "2026-12-20") ?? "", new RegExp(`${PENALTY_RULES.escalateAfterDays} days after`));
  assert.equal(canEscalate(notice, "2026-12-21"), null);
  assert.match(canEscalate({ ...notice, escalated_at: "2026-12-22" }, "2027-01-10") ?? "", /already/);
  assert.match(canEscalate({ ...notice, status: "appealed" }, "2027-01-10") ?? "", /appeal/);
});
