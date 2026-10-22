import test from "node:test";
import assert from "node:assert/strict";
import { Kpis, change, generateInsights, issueStandardSummary, median, resolveReportPeriod, share, trendMonths } from "../src/services/city-report.rules";

const today = "2026-10-21";
const base: Kpis = {
  jobs_scheduled: 1000, jobs_completed: 950, jobs_missed: 30, completion_rate: 95, trips_completed: 200, trips_verified: 196, verification_rate: 98,
  disposed_kg: 500000, issues_received: 120, issues_resolved: 110, within_standard_rate: 90, median_resolution_hours: 14,
  recyclables_kg: 40000, recovery_rate: 7.4, cases_opened: 3, cases_closed: 2, returns_required: 10, returns_filed: 10, returns_on_time: 10, returns_filing_rate: 100,
};
const quiet = { collectors: [], expiringPermits: 0, unlicensedCompanies: 0, recyclersNeedingAction: 0 };

test("months and quarters resolve with their previous period", () => {
  const sep = resolveReportPeriod("2026-09", today);
  assert.deepEqual([sep.from, sep.to, sep.label, sep.complete, sep.previous.key], ["2026-09-01", "2026-09-30", "September 2026", true, "2026-08"]);
  const q1 = resolveReportPeriod("2026-Q1", today);
  assert.deepEqual([q1.from, q1.to, q1.previous.key, q1.previous.from], ["2026-01-01", "2026-03-31", "2025-Q4", "2025-10-01"]);
  assert.equal(resolveReportPeriod("2026-10", today).complete, false, "current month is to date");
  assert.equal(resolveReportPeriod("2026-01", today).previous.key, "2025-12");
});

test("future and malformed periods are refused", () => {
  assert.throws(() => resolveReportPeriod("2026-11", today), /not started/);
  assert.throws(() => resolveReportPeriod("2026-13", today), /2026-09/);
  assert.throws(() => resolveReportPeriod("2026-Q5", today), /quarter/);
});

test("trend months, shares, changes and medians", () => {
  assert.deepEqual(trendMonths("2026-02-28"), ["2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02"]);
  assert.equal(share(1, 3), 33.3);
  assert.equal(share(1, 0), null);
  assert.equal(change(110, 100), 10);
  assert.equal(change(5, 0), null);
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([]), null);
});

test("resolved issues are measured against each category's standard", () => {
  const summary = issueStandardSummary([
    { category: "missed_collection", hours: 20 }, { category: "missed_collection", hours: 30 },
    { category: "pickup_request", hours: 70 }, { category: "illegal_dumping", hours: 49 },
  ], { missed_collection: 24, overflowing_bin: 24, illegal_dumping: 48, pickup_request: 72 });
  assert.deepEqual(summary, { resolved: 4, within_standard: 2, within_standard_rate: 50, median_hours: 39.5 });
});

test("a steady period produces no alarms", () => {
  assert.deepEqual(generateInsights({ ...quiet, current: base, previous: base }), []);
});

test("falling service and slow issue handling are reported as risks first", () => {
  const insights = generateInsights({
    ...quiet,
    current: { ...base, jobs_completed: 820, completion_rate: 82, jobs_missed: 60, within_standard_rate: 70 },
    previous: base,
    collectors: [{ name: "Alpha", service_score: 50, band: "action_required", jobs: 100 }, { name: "Beta", service_score: 92, band: "good", jobs: 80 }],
    unlicensedCompanies: 2,
  });
  assert.deepEqual(insights.map(i => [i.id, i.tone]), [
    ["completion_low", "risk"], ["missed_up", "risk"], ["issues_slow", "risk"], ["collectors_action", "risk"], ["unlicensed", "attention"], ["top_collector", "positive"],
  ]);
  assert.match(insights[0].detail, /down 13 points/);
  assert.match(insights[3].detail, /Alpha/);
});

test("licensing, filing, verification, tonnage and recovery signals", () => {
  const ids = generateInsights({
    ...quiet,
    current: { ...base, returns_filed: 7, returns_on_time: 5, returns_filing_rate: 70, trips_verified: 150, verification_rate: 75, disposed_kg: 600000, recovery_rate: 10, within_standard_rate: 96 },
    previous: base,
    expiringPermits: 3, recyclersNeedingAction: 1,
  }).map(i => i.id);
  assert.deepEqual(ids, ["permits_expiring", "returns_low", "verification_low", "tonnage_move", "recyclers_action", "issues_fast", "recovery_up"]);
});
