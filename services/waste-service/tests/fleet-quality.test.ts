import assert from "node:assert/strict";
import test from "node:test";
import { periodSchema } from "../src/routes/fleet-quality.routes";
import { GAP_MINUTES } from "../src/repositories/fleet-quality.repository";

test("GPS gaps are measured against the pilot's 5-minute target", () => {
  assert.equal(GAP_MINUTES, 5);
});

test("fleet quality periods run forwards and up to three months", () => {
  assert.ok(periodSchema.safeParse({ from: "2026-10-01", to: "2026-10-31" }).success);
  assert.ok(!periodSchema.safeParse({ from: "2026-10-31", to: "2026-10-01" }).success);
  assert.ok(!periodSchema.safeParse({ from: "2026-01-01", to: "2026-10-31" }).success);
});
