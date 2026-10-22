import test from "node:test";
import assert from "node:assert/strict";

process.env.JWT_ACCESS_SECRET = "a".repeat(48);
process.env.JWT_REFRESH_SECRET = "b".repeat(48);

import { AttemptLimiter } from "../src/utils/attempt-limiter";
import { credentialFingerprint, refreshTokenMatchesCredential, signRefreshToken, verifyRefreshToken } from "../src/utils/jwt";
import { registerSchema } from "../src/validators/auth.validator";

test("login limiter blocks after the configured attempts and reopens after the window", () => {
  let now = 1_000_000;
  const limiter = new AttemptLimiter(3, 60_000, 1000, () => now);
  assert.equal(limiter.hit("ip|a@b.ug"), 0);
  assert.equal(limiter.hit("ip|a@b.ug"), 0);
  assert.equal(limiter.hit("ip|a@b.ug"), 0);
  assert.equal(limiter.hit("ip|a@b.ug"), 60);
  assert.equal(limiter.hit("other|a@b.ug"), 0, "other clients are not affected");
  now += 60_001;
  assert.equal(limiter.hit("ip|a@b.ug"), 0, "window expired");
});

test("a successful sign-in resets the account counter", () => {
  const limiter = new AttemptLimiter(1, 60_000);
  limiter.hit("k");
  limiter.reset("k");
  assert.equal(limiter.hit("k"), 0);
});

test("limiter memory stays bounded under a flood of distinct keys", () => {
  const limiter = new AttemptLimiter(5, 60_000, 100);
  for (let i = 0; i < 1000; i++) limiter.hit(`flood-${i}`);
  assert.ok((limiter as unknown as { entries: Map<string, unknown> }).entries.size <= 100);
});

test("refresh tokens stop working after the password hash changes", () => {
  const token = signRefreshToken({ userId: "user-1" }, "$2b$12$oldhash");
  const claims = verifyRefreshToken(token);
  assert.equal(claims.userId, "user-1");
  assert.equal(claims.pwv, credentialFingerprint("$2b$12$oldhash"));
  assert.ok(refreshTokenMatchesCredential(claims, "$2b$12$oldhash"));
  assert.ok(!refreshTokenMatchesCredential(claims, "$2b$12$newhash"));
  assert.ok(!refreshTokenMatchesCredential(claims, "revoked:user-1:123"), "administrative revocation also ends the session");
});

test("refresh tokens issued before this release remain valid until they expire", () => {
  const legacy = verifyRefreshToken(signRefreshToken({ userId: "user-1" }));
  assert.equal(legacy.pwv, undefined);
  assert.ok(refreshTokenMatchesCredential(legacy, "$2b$12$anything"));
});

test("fingerprint does not expose the password hash", () => {
  const fingerprint = credentialFingerprint("$2b$12$secret-hash-value");
  assert.equal(fingerprint.length, 22);
  assert.ok(!fingerprint.includes("secret"));
});

test("public registration schema still accepts legacy organizationId field (ignored by the service)", () => {
  const parsed = registerSchema.parse({ organizationId: "6f1b2c4e-1111-4222-8333-944455556666", fullName: "Test User", email: "t@example.ug", password: "longenough" });
  assert.equal(parsed.email, "t@example.ug");
});
