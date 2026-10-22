import test from "node:test";
import assert from "node:assert/strict";
import { collectorServiceScore, issueSlaState, issueStandardHours, percent, scoreBand } from "../src/services/city-command-center.service";

const base = { jobs: 10, completed_jobs: 10, missed_jobs: 0, completed_trips: 4, unverified_trips: 0, open_issues: 0, overdue_issues: 0, open_compliance_cases: 0, critical_compliance_cases: 0, compliance_state: "compliant" };

test("issue response standards per category with a safe default", () => {
  assert.equal(issueStandardHours("missed_collection"), 24);
  assert.equal(issueStandardHours("illegal_dumping"), 48);
  assert.equal(issueStandardHours("pickup_request"), 72);
  assert.equal(issueStandardHours("something_new"), 48);
});

test("issue SLA state: within, due soon (last quarter), overdue", () => {
  assert.equal(issueSlaState("missed_collection", 10), "within_standard");
  assert.equal(issueSlaState("missed_collection", 18), "due_soon");
  assert.equal(issueSlaState("missed_collection", 24), "due_soon");
  assert.equal(issueSlaState("missed_collection", 24.1), "overdue");
});

test("percent never divides by zero", () => {
  assert.equal(percent(0, 0), null);
  assert.equal(percent(1, 3), 33);
});

test("a fully compliant, fully delivered collector scores 100", () => {
  assert.equal(collectorServiceScore(base), 100);
  assert.equal(scoreBand(100), "good");
});

test("missed collections weigh most", () => {
  const score = collectorServiceScore({ ...base, completed_jobs: 6, missed_jobs: 4 });
  assert.equal(score, 80);
  assert.equal(scoreBand(score), "watch");
});

test("unverified tonnage and overdue issues reduce the score", () => {
  assert.equal(collectorServiceScore({ ...base, unverified_trips: 2 }), 90);
  assert.equal(collectorServiceScore({ ...base, open_issues: 4, overdue_issues: 4 }), 85);
});

test("an expired permit or critical compliance case removes regulatory points", () => {
  assert.equal(collectorServiceScore({ ...base, compliance_state: "permit_expired" }), 85);
  assert.equal(collectorServiceScore({ ...base, critical_compliance_cases: 1, open_compliance_cases: 1 }), 90);
});

test("collectors with no scheduled work are not ranked", () => {
  const score = collectorServiceScore({ ...base, jobs: 0, completed_jobs: 0, completed_trips: 0 });
  assert.equal(score, null);
  assert.equal(scoreBand(score), "no_activity");
});

test("score stays within 0..100 for poor performance", () => {
  const score = collectorServiceScore({ ...base, completed_jobs: 0, missed_jobs: 10, unverified_trips: 4, open_issues: 3, overdue_issues: 3, compliance_state: "suspended" });
  assert.equal(score, 0);
  assert.equal(scoreBand(score), "action_required");
});

import { updateServiceStandardsSchema } from "../src/validators/service-standards.validator";

test("KCCA-defined standards override the defaults", () => {
  const kcca = { missed_collection: 36, overflowing_bin: 12, illegal_dumping: 48, pickup_request: 72 };
  assert.equal(issueStandardHours("missed_collection", kcca), 36);
  assert.equal(issueSlaState("missed_collection", 30, kcca), "due_soon");
  assert.equal(issueSlaState("overflowing_bin", 13, kcca), "overdue");
});

test("standard changes need whole hours within 1..720, known categories, no duplicates and a reason", () => {
  const ok = updateServiceStandardsSchema.parse({ standards: [{ category: "missed_collection", responseHours: 36 }], reason: "Council resolution 12/2026" });
  assert.equal(ok.standards[0].responseHours, 36);
  const bad = [
    { standards: [{ category: "missed_collection", responseHours: 0 }], reason: "valid reason" },
    { standards: [{ category: "missed_collection", responseHours: 721 }], reason: "valid reason" },
    { standards: [{ category: "missed_collection", responseHours: 1.5 }], reason: "valid reason" },
    { standards: [{ category: "graffiti", responseHours: 24 }], reason: "valid reason" },
    { standards: [{ category: "missed_collection", responseHours: 24 }, { category: "missed_collection", responseHours: 30 }], reason: "valid reason" },
    { standards: [{ category: "missed_collection", responseHours: 24 }], reason: "no" },
    { standards: [], reason: "valid reason" },
    { standards: [{ category: "missed_collection", responseHours: 24 }], reason: "valid reason", extra: true },
  ];
  for (const input of bad) assert.equal(updateServiceStandardsSchema.safeParse(input).success, false, JSON.stringify(input));
});
