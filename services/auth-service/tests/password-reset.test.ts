import test from "node:test";
import assert from "node:assert/strict";
import { confirmSchema, requestSchema } from "../src/routes/password-reset.routes";

test("a reset request needs a valid email and normalises it", () => {
  assert.equal(requestSchema.parse({ email: "  Admin@KampalaWMS.com " }).email, "admin@kampalawms.com");
  assert.throws(() => requestSchema.parse({ email: "not-an-email" }));
  assert.throws(() => requestSchema.parse({ email: "a@b.co", extra: 1 }), "unknown fields are refused");
});

test("a new password follows the same rules as changing it while signed in", () => {
  const token = "A".repeat(43);
  assert.ok(confirmSchema.safeParse({ token, password: "Strong-Pass-2026" }).success);
  for (const password of ["Short1A", "alllowercase2026x", "ALLUPPERCASE2026X", "NoNumbersHereAtAll", "Á".repeat(37) + "a1"])
    assert.equal(confirmSchema.safeParse({ token, password }).success, false, password);
  assert.equal(confirmSchema.safeParse({ token: "too-short", password: "Strong-Pass-2026" }).success, false);
});
