import assert from "node:assert/strict";
import test from "node:test";
import { normalizeUgandanPhone } from "../src/utils/sms";

test("household phone numbers are read however they are typed", () => {
  for (const typed of ["0772123456", "0772 123 456", "772123456", "256772123456", "+256 772 123 456", "+256-772-123-456"])
    assert.equal(normalizeUgandanPhone(typed), "+256772123456");
  assert.equal(normalizeUgandanPhone("0702132546"), "+256702132546");
});

test("numbers that are not Ugandan mobiles are refused", () => {
  for (const typed of ["", "12345", "0412123456", "+254712345678", "07721234567"])
    assert.equal(normalizeUgandanPhone(typed), null);
});
