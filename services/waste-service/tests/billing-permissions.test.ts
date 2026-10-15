import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
const migration=fs.readFileSync(path.resolve(__dirname,"../../../infrastructure/database/079_billing_permissions.sql"),"utf8");
const routes=fs.readFileSync(path.resolve(__dirname,"../src/routes/billing.routes.ts"),"utf8");
test("billing separates citizen actions from organization permissions",()=>{
 const permissions=["billing.read","billing.plan.manage","billing.invoice.generate","billing.subscription.manage","billing.payment.record","billing.payment.confirm"];
 for(const permission of permissions){assert.match(migration,new RegExp(permission.replaceAll(".","\\.")));assert.match(routes,new RegExp(permission.replaceAll(".","\\.")))}
 assert.match(routes,/requireRoleOrOrganizationPermission\(\["citizen"\],"billing\.read"\)/);
 assert.match(routes,/requireRoles\("citizen"\)/);
 assert.doesNotMatch(routes,/requireRoles\("company_admin"\)/);
});
