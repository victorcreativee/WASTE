import assert from "node:assert/strict";
import test from "node:test";
import { issueSlaState, issueStandardHours } from "../src/services/city-command-center.service";
import { updateServiceStandardsSchema } from "../src/validators/service-standards.validator";

test("customer complaints have their own KCCA response standard, like pickup requests", () => {
  assert.equal(issueStandardHours("service_complaint"), 72);
  assert.equal(issueSlaState("service_complaint", 60), "due_soon");
  assert.equal(issueSlaState("service_complaint", 73), "overdue");
});

test("KCCA can set the complaint response time", () => {
  const parsed = updateServiceStandardsSchema.safeParse({ standards: [{ category: "service_complaint", responseHours: 48 }], reason: "Complaints answered within two days" });
  assert.ok(parsed.success);
});
