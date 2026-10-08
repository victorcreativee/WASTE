import assert from "node:assert/strict";
import test from "node:test";
import { AuthenticatedRequest, requireRoles } from "../src/middlewares/auth.middleware";
import { operationalOrganizationScope, requireOrganizationScope } from "../src/middlewares/organization-scope";
import { Response } from "express";

const request = (role: string, organizationId: string | null) =>
  ({ auth: { userId: "test", organizationId, roles: [role] } } as AuthenticatedRequest);

for (const role of ["company_admin", "supervisor", "driver", "iot_operator"]) {
  test(`unlinked ${role} fails closed even when role is permitted`, () => {
    let status = 200, next = false;
    const response = { status(code: number) { status = code; return this; }, json() { return this; } } as unknown as Response;
    requireRoles(role)(request(role, null), response, () => { next = true; });
    assert.equal(status, 403);
    assert.equal(next, false);
  });
}
for (const role of ["company_admin", "supervisor"]) {
  test(`${role} private scope is always its own tenant`, () => {
    assert.equal(requireOrganizationScope(request(role, "tenant-a")), "tenant-a");
    assert.throws(() => requireOrganizationScope(request(role, null)), { statusCode: 403 });
  });
}
for (const role of ["recycling_collector", "recycling_sales"]) {
  test(`${role} is restricted to its recycling company`, () => {
    assert.equal(requireOrganizationScope(request(role, "recycling-tenant")), "recycling-tenant");
    assert.throws(() => requireOrganizationScope(request(role, null)), { statusCode: 403 });
  });
}
for (const role of ["kcca_admin", "system_admin"]) {
  test(`${role} has explicit city scope but no default private scope`, () => {
    assert.equal(operationalOrganizationScope(request(role, null)), null);
    assert.throws(() => requireOrganizationScope(request(role, "some-organization")), { statusCode: 403 });
  });
}
test("anonymous and customer identities cannot fall through to a city-wide query", () => {
  assert.throws(() => operationalOrganizationScope({} as AuthenticatedRequest), { statusCode: 401 });
  assert.throws(() => operationalOrganizationScope(request("citizen", null)), { statusCode: 403 });
});
test("driver operational scope retains its organization", () => {
  assert.equal(operationalOrganizationScope(request("driver", "tenant-a")), "tenant-a");
  assert.throws(() => operationalOrganizationScope(request("driver", null)), { statusCode: 403 });
});
