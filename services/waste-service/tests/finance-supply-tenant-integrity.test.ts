import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const migration = fs.readFileSync(
  path.resolve(__dirname, "../../../infrastructure/database/074_finance_supply_tenant_integrity.sql"),
  "utf8"
);

test("finance and supply child records use tenant-bound database relationships", () => {
  const constraints = [
    "inventory_movement_item_tenant_fkey",
    "purchase_order_request_tenant_fkey",
    "purchase_order_supplier_tenant_fkey",
    "supplier_bill_supplier_tenant_fkey",
    "supplier_bill_order_tenant_fkey",
    "supplier_payment_bill_tenant_fkey",
    "subscription_plan_tenant_fkey",
    "subscription_location_tenant_fkey",
    "invoice_subscription_tenant_fkey",
    "payment_invoice_tenant_fkey",
  ];
  for (const constraint of constraints) {
    assert.match(migration, new RegExp(`ADD CONSTRAINT ${constraint}`));
  }
  assert.ok(
    (migration.match(/FOREIGN KEY\([^)]*organization_id\)/g) || []).length >= constraints.length,
    "every protected relationship must carry organization_id"
  );
  assert.match(migration, /Cross-tenant finance or supply relationships exist/);
});
