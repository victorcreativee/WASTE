import assert from "node:assert/strict";
import test from "node:test";
import { listSchema, profileSchema, verifySchema } from "../src/routes/registry.routes";

test("a field verification is a precise fix inside Kampala", () => {
  assert.ok(verifySchema.safeParse({ latitude: 0.3136, longitude: 32.5811, accuracyM: 12 }).success);
  assert.ok(!verifySchema.safeParse({ latitude: 0.3136, longitude: 32.5811, accuracyM: 80 }).success, "too coarse to place a gate");
  assert.ok(!verifySchema.safeParse({ latitude: -1.29, longitude: 36.82, accuracyM: 5 }).success, "Nairobi is not Kampala");
  assert.ok(!verifySchema.safeParse({ latitude: 32.58, longitude: 0.31, accuracyM: 5 }).success, "latitude and longitude swapped");
});

test("profiles take a known category and a sensible estimate", () => {
  assert.ok(profileSchema.safeParse({ pointCategory: "school", estimatedKgWeek: 300 }).success);
  assert.ok(profileSchema.safeParse({ estimatedKgWeek: null }).success, "an estimate can be cleared");
  assert.ok(!profileSchema.safeParse({ pointCategory: "spaceport" }).success);
  assert.ok(!profileSchema.safeParse({ estimatedKgWeek: -5 }).success);
  assert.ok(!profileSchema.safeParse({}).success);
});

test("only known filters reach the query", () => {
  assert.equal(listSchema.parse({}).status, "all");
  assert.ok(listSchema.safeParse({ status: "tariff_mismatch", category: "none" }).success);
  assert.ok(!listSchema.safeParse({ status: "true OR 1=1" }).success);
});
