import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const migration=fs.readFileSync(path.resolve(__dirname,"../../../infrastructure/database/075_recycling_actor_tenant_integrity.sql"),"utf8");

test("recycling audit actors are bound to the record organization",()=>{
 const constraints=[
  "recycling_lot_creator_tenant_fkey","recycling_sale_recorder_tenant_fkey",
  "recycling_float_recorder_tenant_fkey","recycling_sorting_recorder_tenant_fkey",
  "recycling_partner_creator_tenant_fkey","recycling_adjustment_recorder_tenant_fkey",
  "recycling_followup_recorder_tenant_fkey","recycling_sale_payment_recorder_tenant_fkey",
  "recycling_purchase_payment_recorder_tenant_fkey","recycling_material_creator_tenant_fkey",
  "recycling_closure_closer_tenant_fkey","recycling_closure_reopener_tenant_fkey"
 ];
 for(const constraint of constraints)assert.match(migration,new RegExp(`ADD CONSTRAINT ${constraint}`));
 assert.ok((migration.match(/FOREIGN KEY\([^)]*,organization_id\) REFERENCES users\(id,organization_id\)/g)||[]).length>=constraints.length);
 assert.match(migration,/Cross-tenant recycling actor references exist/);
});
