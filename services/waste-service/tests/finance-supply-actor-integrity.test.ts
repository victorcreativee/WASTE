import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
const migration=fs.readFileSync(path.resolve(__dirname,"../../../infrastructure/database/077_finance_supply_actor_integrity.sql"),"utf8");
test("finance and supply actors are tenant bound",()=>{
 const constraints=["expense_creator_tenant_fkey","expense_approver_tenant_fkey","inventory_movement_recorder_tenant_fkey","purchase_request_requester_tenant_fkey","purchase_request_approver_tenant_fkey","purchase_order_creator_tenant_fkey","supplier_bill_creator_tenant_fkey","supplier_payment_recorder_tenant_fkey","finance_settings_updater_tenant_fkey","finance_history_actor_tenant_fkey"];
 for(const constraint of constraints)assert.match(migration,new RegExp(`ADD CONSTRAINT ${constraint}`));
 assert.ok((migration.match(/FOREIGN KEY\([^)]*,organization_id\) REFERENCES users\(id,organization_id\)/g)||[]).length>=constraints.length);
 assert.match(migration,/Cross-tenant finance or supply actor references exist/);
});
