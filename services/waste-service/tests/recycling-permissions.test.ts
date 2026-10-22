import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const migration = fs.readFileSync(
  path.resolve(__dirname, "../../../infrastructure/database/074_recycling_permissions.sql"),
  "utf8"
);
const fieldFloatMigration = fs.readFileSync(
  path.resolve(__dirname, "../../../infrastructure/database/086_recycling_field_float.sql"),
  "utf8"
);
const managerOperationsMigration = fs.readFileSync(
  path.resolve(__dirname, "../../../infrastructure/database/087_recycling_field_manager_operations.sql"),
  "utf8"
);
const routes = fs.readFileSync(
  path.resolve(__dirname, "../src/routes/recycling.routes.ts"),
  "utf8"
);

const permissions = [
  "recycling.read",
  "recycling.purchase.create",
  "recycling.local_sale.create",
  "recycling.industrial_sale.manage",
  "recycling.inventory.manage",
  "recycling.finance.manage",
  "recycling.daily_close.manage",
];

test("recycling permissions are catalogued and tenant restricted", () => {
  for (const permission of permissions) assert.match(migration, new RegExp(permission.replace(".", "\\.")));
  assert.match(fieldFloatMigration, /recycling\.field_float\.manage/);
  assert.match(managerOperationsMigration, /recycling\.purchase_payment\.manage/);
  assert.match(managerOperationsMigration, /recycling\.industrial_sale\.manage/);
  assert.match(managerOperationsMigration, /recycling\.transaction\.edit/);
  assert.match(managerOperationsMigration, /recycling_field_manager/);
  assert.match(migration, /organization\.type='recycling_company'/);
  assert.match(migration, /module <> 'recycling' OR org_type='recycling_company'/);
});

test("every recycling route is guarded by an organization permission", () => {
  assert.doesNotMatch(routes, /const manage=requireRoles/);
  assert.equal((routes.match(/permission\('recycling\./g) || []).length, 17);
  assert.match(routes, /cash-movements',permission\('recycling\.finance\.manage'\)/);
  assert.equal((routes.match(/permission\('recycling\.transaction\.edit'\)/g) || []).length, 2);
  assert.match(routes, /requireAnyOrganizationPermission\('recycling\.local_sale\.create','recycling\.industrial_sale\.manage'\)/);
  assert.match(routes, /requireAnyOrganizationPermission\('recycling\.finance\.manage','recycling\.field_float\.manage'\)/);
  assert.equal((routes.match(/requireAnyOrganizationPermission\('recycling\.finance\.manage','recycling\.purchase_payment\.manage'\)/g) || []).length, 2);
  assert.doesNotMatch(routes, /requireRoles\('company_admin'\)/);
  assert.match(routes, /daily-closures\/:id\/reopen',permission\('recycling\.daily_close\.manage'\)/);
});
