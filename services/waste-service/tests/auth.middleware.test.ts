import assert from "node:assert/strict";
import test from "node:test";
import { NextFunction, Response } from "express";

import {
  AuthenticatedRequest,
  requireAuth,
  requireRoles,
} from "../src/middlewares/auth.middleware";

function responseRecorder() {
  const result = { statusCode: 200, body: undefined as unknown };
  const response = {
    status(code: number) {
      result.statusCode = code;
      return this;
    },
    json(body: unknown) {
      result.body = body;
      return this;
    },
  } as unknown as Response;

  return { response, result };
}

test("requireAuth rejects a request with no bearer token", async () => {
  const { response, result } = responseRecorder();
  let nextCalled = false;

  await requireAuth(
    { headers: {} } as AuthenticatedRequest,
    response,
    (() => {
      nextCalled = true;
    }) as NextFunction
  );

  assert.equal(result.statusCode, 401);
  assert.equal(nextCalled, false);
});

test("requireRoles permits a KCCA administrator", () => {
  const { response } = responseRecorder();
  let nextCalled = false;
  const middleware = requireRoles("system_admin", "kcca_admin");

  middleware(
    { auth: { userId: "user", organizationId: null, roles: ["kcca_admin"] } } as AuthenticatedRequest,
    response,
    (() => {
      nextCalled = true;
    }) as NextFunction
  );

  assert.equal(nextCalled, true);
});

test("requireRoles denies a citizen access to city operations", () => {
  const { response, result } = responseRecorder();
  let nextCalled = false;
  const middleware = requireRoles("system_admin", "kcca_admin");

  middleware(
    { auth: { userId: "user", organizationId: null, roles: ["citizen"] } } as AuthenticatedRequest,
    response,
    (() => {
      nextCalled = true;
    }) as NextFunction
  );

  assert.equal(result.statusCode, 403);
  assert.equal(nextCalled, false);
});

test("requireRoles permits a company administrator linked to an organization", () => {
  const { response } = responseRecorder();
  let nextCalled = false;
  const middleware = requireRoles("company_admin");

  middleware(
    {
      auth: {
        userId: "user",
        organizationId: "11111111-1111-4111-8111-111111111111",
        roles: ["company_admin"],
      },
    } as AuthenticatedRequest,
    response,
    (() => {
      nextCalled = true;
    }) as NextFunction
  );

  assert.equal(nextCalled, true);
});

test("requireRoles denies an unlinked company administrator", () => {
  const { response, result } = responseRecorder();
  let nextCalled = false;
  const middleware = requireRoles("company_admin");

  middleware(
    {
      auth: {
        userId: "user",
        organizationId: null,
        roles: ["company_admin"],
      },
    } as AuthenticatedRequest,
    response,
    (() => {
      nextCalled = true;
    }) as NextFunction
  );

  assert.equal(result.statusCode, 403);
  assert.equal(nextCalled, false);
});
