import assert from "node:assert/strict";
import test from "node:test";
import { DUMPING_RULES, canMove, cleanupDaysFor, cleanupDueError, insideKampala, isHotspot, medianDays, reportOutcome } from "../src/services/dumping.rules";

test("status moves follow the workflow; dismissed sites stay closed", () => {
  assert.ok(canMove("reported", "verified"));
  assert.ok(canMove("cleanup_reported", "cleanup_ordered"), "KCCA can send a cleanup back");
  assert.ok(canMove("cleared", "reported"), "dumping can come back");
  assert.equal(canMove("reported", "cleared"), false, "nothing is cleared without inspection");
  assert.equal(canMove("verified", "cleanup_reported"), false);
  assert.equal(canMove("dismissed", "reported"), false);
});

test("a report joins an open site, brings back a recently cleared one, or starts a new site", () => {
  assert.equal(reportOutcome(null), "new_site");
  assert.equal(reportOutcome({ status: "cleanup_ordered", cleared_days_ago: null }), "additional_report");
  assert.equal(reportOutcome({ status: "cleared", cleared_days_ago: 30 }), "recurred");
  assert.equal(reportOutcome({ status: "cleared", cleared_days_ago: DUMPING_RULES.recurrenceDays + 1 }), "new_site");
  assert.equal(reportOutcome({ status: "dismissed", cleared_days_ago: null }), "new_site");
});

test("cleanup time depends on size, and hazardous waste gets the shortest", () => {
  assert.equal(cleanupDaysFor("small", false), 3);
  assert.equal(cleanupDaysFor("large", false), 7);
  assert.equal(cleanupDaysFor("large", true), DUMPING_RULES.hazardousCleanupDays);
  assert.equal(cleanupDueError("2026-10-26", "2026-10-21", "medium", false), null);
  assert.match(cleanupDueError("2026-10-27", "2026-10-21", "medium", false) ?? "", /within 5 days/);
  assert.match(cleanupDueError("2026-10-24", "2026-10-21", "large", true) ?? "", /hazardous site must be cleaned up within 2 days/);
  assert.match(cleanupDueError("2026-10-20", "2026-10-21", "small", false) ?? "", /past/);
});

test("Kampala bounds, hotspots and median days to clear", () => {
  assert.ok(insideKampala(0.3476, 32.5825));
  assert.equal(insideKampala(-1.29, 36.82), false, "Nairobi is refused");
  assert.ok(isHotspot({ report_count: 3, recurrence_count: 0 }));
  assert.ok(isHotspot({ report_count: 1, recurrence_count: 1 }));
  assert.equal(isHotspot({ report_count: 2, recurrence_count: 0 }), false);
  assert.equal(medianDays([4, 1, 2.5]), 2.5);
  assert.equal(medianDays([1, 2, 3, 10]), 2.5);
  assert.equal(medianDays([]), null);
});
