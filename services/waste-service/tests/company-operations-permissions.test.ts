import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const migration=fs.readFileSync(path.resolve(__dirname,"../../../infrastructure/database/080_company_operations_permissions.sql"),"utf8");
const customerRoutes=fs.readFileSync(path.resolve(__dirname,"../src/routes/customer-service.routes.ts"),"utf8");
const contractRoutes=fs.readFileSync(path.resolve(__dirname,"../src/routes/contract.routes.ts"),"utf8");
const fleetRoutes=fs.readFileSync(path.resolve(__dirname,"../src/routes/fleet.routes.ts"),"utf8");
const reportRoutes=fs.readFileSync(path.resolve(__dirname,"../src/routes/report.routes.ts"),"utf8");
const routes=[customerRoutes,contractRoutes,fleetRoutes,reportRoutes].join("\n");

test("company operations use explicit tenant permissions",()=>{
 const permissions=["customers.read","customers.manage","contracts.read","contracts.manage","fleet.read","fleet.manage","fleet.alert.review","reports.organization.read"];
 for(const permission of permissions){
  const pattern=new RegExp(permission.replaceAll(".","\\."));
  assert.match(migration,pattern);
  assert.match(routes,pattern);
 }
 assert.doesNotMatch(routes,/requireRoles\(['"]company_admin/);
});

test("public and city-wide fleet roles remain explicit",()=>{
 assert.match(customerRoutes,/requireRoles\("citizen"\)/);
 assert.match(fleetRoutes,/requireRoles\('driver'\)/);
 assert.match(fleetRoutes,/requireRoleOrOrganizationPermission\(\['kcca_admin','system_admin'\],'fleet\.read'\)/);
 assert.match(reportRoutes,/requireRoles\('kcca_admin','system_admin'\)/);
});
