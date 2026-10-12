import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
const migration=fs.readFileSync(path.resolve(__dirname,"../../../infrastructure/database/077_finance_supply_permissions.sql"),"utf8");
const routes=["expense","inventory","procurement","payables"].map(name=>fs.readFileSync(path.resolve(__dirname,`../src/routes/${name}.routes.ts`),"utf8")).join("\n");
test("finance and supply permissions are catalogued and routed",()=>{
 const permissions=["finance.read","finance.expense.create","finance.expense.approve","finance.settings.manage","inventory.read","inventory.manage","procurement.request.create","procurement.request.approve","procurement.read","procurement.manage","payables.read","payables.bill.manage","payables.payment.create"];
 for(const permission of permissions){assert.match(migration,new RegExp(permission.replaceAll(".","\\.")));assert.match(routes,new RegExp(permission.replaceAll(".","\\.")))}
 assert.doesNotMatch(routes,/requireRoles\(/);
 assert.match(migration,/p_role='supervisor'/);
});
