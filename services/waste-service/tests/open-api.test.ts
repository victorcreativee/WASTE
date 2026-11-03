import assert from "node:assert/strict";
import test from "node:test";
import { generateApiKey, hashApiKey, MinuteLimiter, parseApiKey } from "../src/services/api-keys";
import { createKeySchema, dateRangeSchema, pagingSchema } from "../src/validators/open-api.validator";
import { openApiDocument } from "../src/services/openapi-spec";

test("keys are random, shaped kwms_<id>_<secret>, and only their hash is kept", () => {
  const a = generateApiKey(), b = generateApiKey();
  assert.match(a.key, /^kwms_[a-z0-9]{8}_[A-Za-z0-9]{40}$/);
  assert.notEqual(a.key, b.key);
  assert.equal(a.hash, hashApiKey(a.key));
  assert.ok(!a.hash.includes(a.key.split("_")[2]));
  assert.deepEqual(parseApiKey(` ${a.key} `), { prefix: a.prefix, hash: a.hash });
  for (const bad of [undefined, "", "Bearer x", a.key.slice(0, -1), `${a.key}x`, a.key.replace("kwms_", "kwm_"), `kwms_ABCDEFGH_${"a".repeat(40)}`]) {
    assert.equal(parseApiKey(bad), null, `refused without a lookup: ${bad}`);
  }
});

test("the limit allows the set number of requests a minute, then resets", () => {
  let now = 120_000 + 5_000;
  const limiter = new MinuteLimiter(() => now);
  assert.deepEqual([1, 2, 3].map(() => limiter.take("k", 3).allowed), [true, true, true]);
  const refused = limiter.take("k", 3);
  assert.equal(refused.allowed, false);
  assert.equal(refused.resetSeconds, 55);
  assert.ok(limiter.take("other", 3).allowed, "keys are counted apart");
  now += 55_000;
  assert.ok(limiter.take("k", 3).allowed, "a new minute starts again");
});

test("key requests and API queries are checked", () => {
  assert.ok(createKeySchema.safeParse({ name: "Accounting sync", scopes: ["tonnage:read"] }).success);
  assert.deepEqual(createKeySchema.parse({ name: "Accounting sync", scopes: ["tonnage:read", "tonnage:read"] }).scopes, ["tonnage:read"]);
  assert.ok(!createKeySchema.safeParse({ name: "Accounting sync", scopes: ["users:write"] }).success);
  assert.ok(!createKeySchema.safeParse({ name: "Accounting sync", scopes: [] }).success);
  assert.ok(!createKeySchema.safeParse({ name: "Accounting sync", scopes: ["tonnage:read"], expiresInDays: 3650 }).success);
  assert.ok(!dateRangeSchema.safeParse({ from: "2026-01-01", to: "2026-10-31" }).success);
  assert.deepEqual(pagingSchema.parse({}), { page: 1, pageSize: 100 });
  assert.ok(!pagingSchema.safeParse({ pageSize: "5000" }).success);
});

test("the OpenAPI document lists every endpoint with a bearer key", () => {
  const doc = openApiDocument();
  assert.equal(doc.openapi, "3.1.0");
  assert.deepEqual(Object.keys(doc.paths), ["/me", "/operators", "/tonnage", "/load-certificates", "/carbon-baseline", "/receipts"]);
  assert.equal(doc.components.securitySchemes.apiKey.scheme, "bearer");
});
