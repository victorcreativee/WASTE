import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { assertProductionConfig, createErrorHandler, trustProxySetting } from "../src/runtime";

function invoke(error: unknown) {
  const result: { status?: number; body?: { success: boolean; message: string } } = {};
  const res = {
    headersSent: false,
    status(code: number) { result.status = code; return this; },
    json(body: { success: boolean; message: string }) { result.body = body; return this; },
  };
  const original = console.error;
  console.error = () => {};
  try {
    createErrorHandler({ serviceName: "test", uniqueViolationMessage: (c) => (c === "known" ? "Known duplicate" : "Duplicate") })(
      error as never, { method: "GET", originalUrl: "/x" } as never, res as never, () => {}
    );
  } finally {
    console.error = original;
  }
  return result;
}

test("production refuses missing or placeholder secrets without printing them", () => {
  assert.throws(() => assertProductionConfig("svc", { DATABASE_URL: "" }, {}, "production"), /DATABASE_URL is missing/);
  assert.throws(() => assertProductionConfig("svc", { DATABASE_URL: "postgres://x" }, { JWT_ACCESS_SECRET: "dev-access-secret-1234567890-abcdefgh" }, "production"), /JWT_ACCESS_SECRET must be a random value/);
  assert.throws(() => assertProductionConfig("svc", {}, { JWT_ACCESS_SECRET: "short" }, "production"), (e: Error) => !e.message.includes("short"));
  assert.doesNotThrow(() => assertProductionConfig("svc", { DATABASE_URL: "postgres://x" }, { JWT_ACCESS_SECRET: "9f2c".repeat(16) }, "production"));
  assert.doesNotThrow(() => assertProductionConfig("svc", { DATABASE_URL: "" }, { JWT_ACCESS_SECRET: "" }, "development"), "development keeps working with local .env files");
});

test("trust proxy defaults to private-network proxies only", () => {
  assert.equal(trustProxySetting(undefined), "loopback, linklocal, uniquelocal");
  assert.equal(trustProxySetting("2"), 2);
  assert.equal(trustProxySetting("false"), false);
});

test("validation errors return the first issue as 400", () => {
  const error = (() => { try { z.object({ name: z.string() }).parse({}); } catch (e) { return e; } })();
  const result = invoke(error);
  assert.equal(result.status, 400);
  assert.match(result.body!.message, /^name: /);
});

test("intentional business errors keep their status and message", () => {
  assert.deepEqual(invoke(Object.assign(new Error("Business day is closed"), { statusCode: 409 })), { status: 409, body: { success: false, message: "Business day is closed" } });
  assert.equal(invoke(Object.assign(new Error("Contact details changed"), { status: 409 })).status, 409);
});

test("database trigger rules (RAISE EXCEPTION) stay user-facing 400s", () => {
  const result = invoke(Object.assign(new Error("Choose an active service zone"), { code: "P0001" }));
  assert.deepEqual(result, { status: 400, body: { success: false, message: "Choose an active service zone" } });
});

test("unique violations use the service's friendly messages", () => {
  assert.equal(invoke(Object.assign(new Error("dup"), { code: "23505", constraint: "known" })).body!.message, "Known duplicate");
  assert.equal(invoke(Object.assign(new Error("dup"), { code: "23505" })).status, 409);
});

test("unexpected internal errors are 500 and never leak internals", () => {
  const result = invoke(new Error("connect ECONNREFUSED 10.0.0.5:5432 password authentication failed for user wms"));
  assert.equal(result.status, 500);
  assert.ok(!/ECONNREFUSED|password|5432/.test(result.body!.message));
});
