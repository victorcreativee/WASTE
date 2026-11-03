import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { Response } from "express";
import { dbPool } from "../src/config/database";
import { desktopIdempotency } from "../src/middlewares/desktop-idempotency.middleware";

const organizationId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const operationId = "33333333-3333-4333-8333-333333333333";

function request(createdAt?: string) {
  const headers: Record<string, string> = {
    "x-kwms-offline": "1",
    "idempotency-key": operationId,
  };
  if (createdAt) headers["x-kwms-operation-created-at"] = createdAt;
  return {
    method: "POST",
    originalUrl: "/api/waste/recycling/purchases",
    body: { quantityKg: 10 },
    auth: { organizationId, userId },
    header(name: string) { return headers[name.toLowerCase()]; },
  } as any;
}

function response() {
  const result = { statusCode: 200, body: undefined as unknown };
  const res: any = {
    statusCode: 200,
    status(code: number) { this.statusCode = code; result.statusCode = code; return this; },
    json(body: unknown) { result.body = body; result.statusCode = this.statusCode; return this; },
  };
  return { res: res as Response, result };
}

test("offline mutations from before an organization reset cannot restore cleared data", async () => {
  const query = mock.method(dbPool, "query", async () => ({
    rows: [{ reset_at: new Date("2026-10-29T10:00:00.000Z") }],
    rowCount: 1,
  }) as any);
  const { res, result } = response();
  let continued = false;
  try {
    await desktopIdempotency(request("2026-10-29T09:59:59.000Z"), res, () => { continued = true; });
    assert.equal(result.statusCode, 409);
    assert.equal(continued, false);
    assert.match(String((result.body as any).message), /before the company data reset/i);
    assert.equal(query.mock.callCount(), 1);
  } finally {
    query.mock.restore();
  }
});

test("old app versions are refused before they can enqueue an ambiguous mutation", async () => {
  const query = mock.method(dbPool, "query", async () => ({ rows: [], rowCount: 0 }) as any);
  const { res, result } = response();
  let continued = false;
  try {
    await desktopIdempotency(request(), res, () => { continued = true; });
    assert.equal(result.statusCode, 400);
    assert.equal(continued, false);
    assert.match(String((result.body as any).message), /older app version/i);
    assert.equal(query.mock.callCount(), 0);
  } finally {
    query.mock.restore();
  }
});
