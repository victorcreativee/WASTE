import assert from "node:assert/strict";
import test from "node:test";

import { updateCustomerServiceStatusSchema } from "../src/validators/customer-service.validator";

test("accepts supported customer service lifecycle states", () => {
  for (const status of ["active", "suspended", "inactive"] as const) {
    assert.deepEqual(updateCustomerServiceStatusSchema.parse({ status }), { status });
  }
});

test("rejects unsupported or unsafe customer service states", () => {
  assert.throws(() => updateCustomerServiceStatusSchema.parse({ status: "deleted" }));
  assert.throws(() => updateCustomerServiceStatusSchema.parse({ status: "pending" }));
  assert.throws(() => updateCustomerServiceStatusSchema.parse({}));
});
