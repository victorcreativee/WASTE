import assert from "node:assert/strict";
import test from "node:test";
import type { Pool, PoolClient } from "pg";
import type { Request, Response } from "express";
import { databaseContextValues, enforceRowSecurity, requestContext } from "../src/runtime";
import { auditIdSchema, auditListQuerySchema } from "../src/validators/audit.validator";

function fakePool() {
  const queries: string[][] = [];
  const client = {
    query: async (text: string, values: unknown[] = []) => { queries.push([text, ...values.map(String)]); return { rows: [] }; },
    release: () => undefined,
  } as unknown as PoolClient;
  const pool = { connect: async () => client } as unknown as Pool;
  return { pool, client, queries };
}

const request = (userId?: string) => ({
  method: "POST", originalUrl: "/api/waste/billing/plans?x=1", ip: "41.210.1.9", headers: {},
  auth: userId ? { userId, organizationId: null, roles: [] } : undefined,
}) as unknown as Request;
const response = { setHeader: () => undefined, on: () => undefined } as unknown as Response;
const within = <T>(req: Request, work: () => Promise<T>) =>
  new Promise<T>((resolve, reject) => requestContext("test")(req, response, () => { work().then(resolve, reject); }));

test("a connection switches role once, then is told who each request is for", async () => {
  const { pool, queries } = fakePool();
  enforceRowSecurity(pool, "kwms_app");
  const userId = "aaaaaaaa-0000-4000-8000-0000000000a1";
  await within(request(userId), async () => { await pool.connect(); await pool.connect(); });
  assert.deepEqual(queries.map(q => q[0]), ["SET ROLE kwms_app", "SELECT kwms_set_request_context($1::uuid,$2,$3,$4,$5::uuid)"],
    "the same request on the same connection is not sent twice");
  assert.deepEqual(queries[1].slice(1, 3), [userId, "41.210.1.9"]);
  assert.equal(queries[1][4], "POST /api/waste/billing/plans", "the query string is left out");

  await within(request(), async () => { await pool.connect(); });
  assert.equal(queries.length, 3, "another request is sent again, without switching role again");
  assert.equal(queries[2][1], "null", "no signed-in user");
});

test("background work has no request, so it runs as system", async () => {
  const { pool, queries } = fakePool();
  enforceRowSecurity(pool, "kwms_app");
  await pool.connect();
  assert.deepEqual(databaseContextValues(undefined), [null, null, null, null, null]);
  assert.deepEqual(queries[1].slice(1), ["null", "null", "null", "null", "null"]);
});

test("the callback form used by pool.query gets the prepared client", async () => {
  const { pool, client, queries } = fakePool();
  enforceRowSecurity(pool, "");
  const got = await new Promise<PoolClient | undefined>((resolve, reject) =>
    (pool.connect as unknown as (cb: (e?: Error, c?: PoolClient) => void) => void)((error, c) => error ? reject(error) : resolve(c)));
  assert.equal(got, client);
  assert.ok(!queries.some(q => q[0].startsWith("SET ROLE")), "an empty DB_APP_ROLE leaves the login role in place");
  assert.equal(queries.length, 1, "the audit context is still sent");
});

test("a connection that cannot be prepared is released with the error, never used", async () => {
  const { pool, client } = fakePool();
  let released: unknown;
  (client as unknown as { query: () => Promise<never> }).query = async () => { throw new Error("role \"kwms_app\" does not exist"); };
  (client as unknown as { release: (e: unknown) => void }).release = e => { released = e; };
  enforceRowSecurity(pool, "kwms_app");
  await assert.rejects(pool.connect(), /does not exist/);
  assert.ok(released instanceof Error, "the broken connection is discarded");
});

test("role names are checked before use", () => {
  assert.throws(() => enforceRowSecurity(fakePool().pool, "kwms_app; RESET ROLE"), /plain role name/);
});

test("audit filters are checked", () => {
  assert.ok(auditListQuerySchema.safeParse({ table: "customer_payments", action: "update", origin: "direct", from: "2026-10-01", to: "2026-10-31" }).success);
  assert.ok(!auditListQuerySchema.safeParse({ table: "users; drop" }).success);
  assert.ok(!auditListQuerySchema.safeParse({ from: "2026-11-01", to: "2026-10-01" }).success);
  assert.ok(!auditIdSchema.safeParse("1 OR 1=1").success);
});

test("GPS privacy inputs: retention bounds, notice length, hold reasons", () => {
  const { consentSchema, holdSchema, noticeSchema, retentionSchema } = require("../src/validators/privacy.validator");
  assert.ok(!retentionSchema.safeParse({ rawPointDays: 7 }).success, "shorter than the track-check and dispute window");
  assert.ok(!retentionSchema.safeParse({ rawPointDays: 1000 }).success);
  assert.ok(retentionSchema.safeParse({ rawPointDays: 90 }).success);
  assert.ok(!consentSchema.safeParse({ decision: "maybe", noticeVersion: 1 }).success);
  assert.ok(!noticeSchema.safeParse({ title: "New", body: "too short", changeSummary: "x" }).success);
  assert.ok(!holdSchema.safeParse({ tripNumber: "TRP-1", reason: "" }).success);
});
