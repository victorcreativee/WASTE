import test from "node:test";
import assert from "node:assert/strict";
import { RecyclerMetrics, recoveryRate, recyclerFlags, resolvePeriod, standingOf, toCsv } from "../src/services/recycling-oversight.rules";

const today = "2026-10-21";
const healthy: RecyclerMetrics = {
  collected_kg: 5000, sold_kg: 4200, sorting_input_kg: 3000, residue_kg: 300, aged_stock_kg: 0,
  last_activity: "2026-10-20", active_days: 20, closed_days: 19,
  permit: { status: "approved", valid_until: "2027-06-30" },
};

test("reporting periods resolve from presets and custom ranges", () => {
  assert.deepEqual(resolvePeriod({}, today), { from: "2026-09-22", to: today, label: "Last 30 days" });
  assert.equal(resolvePeriod({ period: "90d" }, today).from, "2026-07-24");
  assert.deepEqual(resolvePeriod({ period: "year" }, today), { from: "2026-01-01", to: today, label: "2026 to date" });
  assert.deepEqual(resolvePeriod({ from: "2026-01-01", to: "2026-03-31" }, today), { from: "2026-01-01", to: "2026-03-31", label: "2026-01-01 to 2026-03-31" });
});

test("invalid or oversized periods are refused", () => {
  assert.throws(() => resolvePeriod({ from: "2026-05-01", to: "2026-04-01" }, today), /on or before/);
  assert.throws(() => resolvePeriod({ from: "2026-05-01" }, today), /YYYY-MM-DD/);
  assert.throws(() => resolvePeriod({ from: "2023-01-01", to: "2026-01-01" }, today), /two years/);
});

test("recovery rate is recyclables over all accounted waste", () => {
  assert.equal(recoveryRate(250, 750), 25);
  assert.equal(recoveryRate(1, 2), 33.3);
  assert.equal(recoveryRate(0, 0), null);
  assert.equal(recoveryRate(100, 0), 100);
});

test("a recycler with a valid permit and steady records is in good standing", () => {
  const flags = recyclerFlags(healthy, today);
  assert.deepEqual(flags, []);
  assert.equal(standingOf(flags), "good");
});

test("permit problems require action", () => {
  assert.equal(standingOf(recyclerFlags({ ...healthy, permit: null }, today)), "action");
  assert.equal(recyclerFlags({ ...healthy, permit: { status: "suspended", valid_until: "2027-01-01" } }, today)[0].code, "permit_suspended");
  const expired = recyclerFlags({ ...healthy, permit: { status: "approved", valid_until: "2026-10-01" } }, today)[0];
  assert.deepEqual([expired.code, expired.message], ["permit_expired", "Permit expired on 1 Oct 2026"]);
  const expiring = recyclerFlags({ ...healthy, permit: { status: "approved", valid_until: "2026-11-05" } }, today);
  assert.deepEqual(expiring.map(f => [f.code, f.severity]), [["permit_expiring", "watch"]]);
  assert.match(expiring[0].message, /15 days/);
});

test("operational signals put a recycler on watch", () => {
  const codes = (m: Partial<RecyclerMetrics>) => recyclerFlags({ ...healthy, ...m }, today).map(f => f.code);
  assert.deepEqual(codes({ last_activity: "2026-10-01" }), ["inactive"]);
  assert.deepEqual(codes({ last_activity: "2026-10-07" }), []);
  assert.deepEqual(codes({ last_activity: null }), ["no_activity"]);
  assert.deepEqual(codes({ aged_stock_kg: 499 }), []);
  assert.deepEqual(codes({ aged_stock_kg: 800 }), ["aged_stock"]);
  assert.deepEqual(codes({ residue_kg: 700 }), ["high_residue"]);
  assert.deepEqual(codes({ sorting_input_kg: 50, residue_kg: 40 }), [], "too little sorting to judge");
  assert.deepEqual(codes({ closed_days: 10 }), ["closure_gap"]);
  assert.deepEqual(codes({ active_days: 2, closed_days: 0 }), [], "too few working days to judge");
  assert.equal(standingOf(recyclerFlags({ ...healthy, aged_stock_kg: 900 }, today)), "watch");
});

test("CSV export quotes text and neutralises spreadsheet formulas", () => {
  const csv = toCsv(["Company", "Collected kg"], [["Green, Ltd", 1200], ['=HYPERLINK("x")', 0], ["Plain", null]]);
  assert.equal(csv, 'Company,Collected kg\r\n"Green, Ltd",1200\r\n"\'=HYPERLINK(""x"")",0\r\nPlain,\r\n');
  assert.equal(toCsv(["n"], [[-5]]), "n\r\n-5\r\n", "negative numbers are not treated as formulas");
});
