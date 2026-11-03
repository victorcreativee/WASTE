import assert from "node:assert/strict";
import test from "node:test";
import { purchaseAllocationReference } from "../src/utils/purchase-allocation-reference";

test("one receipt allocates to distinct ledger references while retaining the original", () => {
  assert.equal(purchaseAllocationReference("MOMO-123", 0), "MOMO-123");
  assert.equal(purchaseAllocationReference("MOMO-123", 1), "MOMO-123#2");
  assert.equal(new Set(Array.from({ length: 25 }, (_, i) => purchaseAllocationReference("MOMO-123", i))).size, 25);
});
test("maximum-length receipts produce bounded deterministic allocations without conflating different receipts", () => {
  const a = "A".repeat(119) + "1", b = "A".repeat(119) + "2";
  assert.equal(purchaseAllocationReference(a, 0), a);
  assert.equal(Array.from(purchaseAllocationReference(a, 24)).length, 120);
  assert.equal(purchaseAllocationReference(a, 24), purchaseAllocationReference(a, 24));
  assert.notEqual(purchaseAllocationReference(a, 24), purchaseAllocationReference(b, 24));
});
