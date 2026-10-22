import test from "node:test";
import assert from "node:assert/strict";
import { dueOn, flattenMaterials, periodEnd, periodError, periodState, requiredPeriods, variances } from "../src/services/regulatory-returns.rules";

const today = "2026-10-21";

test("returns are due on the 15th of the following month", () => {
  assert.equal(dueOn("2026-09"), "2026-10-15");
  assert.equal(dueOn("2026-12"), "2027-01-15");
  assert.equal(periodEnd("2026-02"), "2026-02-28");
  assert.equal(periodEnd("2028-02"), "2028-02-29");
});

test("required months start at the later of the first returns period and joining, and stop before this month", () => {
  assert.deepEqual(requiredPeriods("2025-03-10", today, "2026-09"), ["2026-09"]);
  assert.deepEqual(requiredPeriods("2026-06-02", "2026-12-01", "2026-09"), ["2026-09", "2026-10", "2026-11"]);
  assert.deepEqual(requiredPeriods("2026-10-05", today, "2026-09"), [], "joined this month: nothing owed yet");
  assert.deepEqual(requiredPeriods("2026-11-20", "2027-01-03", "2026-09"), ["2026-11", "2026-12"]);
});

test("a return can only be filed for a completed, required month", () => {
  assert.equal(periodError("2026-09", "2025-01-01", today, "2026-09"), null);
  assert.match(periodError("2026-10", "2025-01-01", today, "2026-09")!, /month has ended/);
  assert.match(periodError("2026-08", "2025-01-01", today, "2026-09")!, /No return is required/);
  assert.match(periodError("2026-9", "2025-01-01", today, "2026-09")!, /YYYY-MM/);
});

test("an unfiled month is due until the 15th and overdue after", () => {
  assert.equal(periodState("2026-09", null, "2026-10-15"), "due");
  assert.equal(periodState("2026-09", null, "2026-10-16"), "overdue");
  assert.equal(periodState("2026-09", "queried", "2026-12-01"), "queried");
  assert.equal(periodState("2026-09", "accepted", "2026-12-01"), "accepted");
});

test("only figures the platform recorded are compared, at a 10% tolerance", () => {
  const recorded = { trips_completed: 100, waste_disposed_kg: 50000, complaints_received: 0 };
  assert.deepEqual(variances({ trips_completed: 108, waste_disposed_kg: 40000, complaints_received: 12 }, recorded), [
    { field: "waste_disposed_kg", declared: 40000, recorded: 50000, difference: -10000 },
  ]);
  assert.deepEqual(variances({ trips_completed: 111 }, { trips_completed: 100 }).map(v => v.field), ["trips_completed"]);
  assert.deepEqual(variances({}, recorded), []);
});

test("recycler material tables flatten to comparable fields", () => {
  assert.deepEqual(flattenMaterials([{ category: "plastic", collectedKg: 1000, soldKg: 300 }]), { plastic_collected_kg: 1000, plastic_sold_kg: 300 });
});
