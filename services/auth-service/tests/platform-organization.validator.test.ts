import assert from "node:assert/strict";
import test from "node:test";
import { deleteOrganizationBusinessDaySchema } from "../src/validators/platform-organization.validator";

test("business-day deletion requires an exact date, company confirmation and audit reason", () => {
  const parsed = deleteOrganizationBusinessDaySchema.parse({
    operatingDate: "2026-10-19",
    confirmationName: "WALLAS Recycling",
    reason: "Remove supervised test transactions before production use",
  });
  assert.equal(parsed.operatingDate, "2026-10-19");
  assert.equal(deleteOrganizationBusinessDaySchema.safeParse({
    operatingDate: "19/10/2026",
    confirmationName: "WALLAS Recycling",
    reason: "Remove supervised test transactions before production use",
  }).success, false);
  assert.equal(deleteOrganizationBusinessDaySchema.safeParse({
    operatingDate: "2026-10-19",
    confirmationName: "WALLAS Recycling",
    reason: "test",
  }).success, false);
});
