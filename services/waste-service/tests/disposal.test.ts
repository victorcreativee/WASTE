import assert from "node:assert/strict";
import test from "node:test";
import { DISPOSAL_RULES, disposalStanding, dueTrips, explanationError, verificationRate } from "../src/services/disposal.rules";

test("trips still in the grace period or on the weighbridge are not yet due", () => {
  assert.equal(dueTrips({ verified: 8, pending: 5, weighing: 1, unverified: 2 }), 10);
  assert.equal(dueTrips({ pending: 3 }), 0);
});

test("verification rate counts verified and explained trips against due trips", () => {
  assert.equal(verificationRate({ verified: 17, explained: 1, unverified: 1, declared: 1, pending: 4 }), 90);
  assert.equal(verificationRate({ verified: 2, explanation_review: 1 }), 66.7, "an explanation waiting for KCCA does not count yet");
  assert.equal(verificationRate({ pending: 2 }), null);
});

test("standing follows the KCCA thresholds", () => {
  assert.equal(disposalStanding(DISPOSAL_RULES.goodRate), "good");
  assert.equal(disposalStanding(94.9), "watch");
  assert.equal(disposalStanding(DISPOSAL_RULES.actionRate), "watch");
  assert.equal(disposalStanding(79.9), "action");
  assert.equal(disposalStanding(null), "no_trips");
});

test("explanations need a known reason, details, and a ticket for a combined load", () => {
  assert.equal(explanationError({ reason: "no_load", details: "Truck returned empty after market closure." }), null);
  assert.equal(explanationError({ reason: "lost", details: "Something happened" }), "Choose a reason");
  assert.equal(explanationError({ reason: "other", details: " no " }), "Describe what happened");
  assert.match(explanationError({ reason: "combined_load", details: "Both loads weighed together." }) ?? "", /weighbridge ticket/);
  assert.equal(explanationError({ reason: "combined_load", details: "Both loads weighed together.", relatedTicketId: "x" }), null);
});
