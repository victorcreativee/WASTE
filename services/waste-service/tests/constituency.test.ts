import assert from "node:assert/strict";
import test from "node:test";
import { assignSchema, periodSchema } from "../src/routes/constituency.routes";

test("constituency periods run forwards and up to a year", () => {
  assert.ok(periodSchema.safeParse({ from: "2026-10-01", to: "2026-10-31" }).success);
  assert.ok(!periodSchema.safeParse({ from: "2026-10-31", to: "2026-10-01" }).success);
  assert.ok(!periodSchema.safeParse({ from: "2025-01-01", to: "2026-10-31" }).success);
});

test("an area is assigned to a constituency id, or unassigned with null", () => {
  assert.ok(assignSchema.safeParse({ constituencyId: null }).success);
  assert.ok(assignSchema.safeParse({ constituencyId: "e3988a99-42f2-4314-8e14-d15cfcec6e20" }).success);
  assert.ok(!assignSchema.safeParse({ constituencyId: "kawempe_south" }).success);
  assert.ok(!assignSchema.safeParse({}).success);
});
