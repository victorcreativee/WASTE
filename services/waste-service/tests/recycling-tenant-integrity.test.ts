import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const migration = fs.readFileSync(
  path.resolve(__dirname, "../../../infrastructure/database/072_recycling_tenant_integrity.sql"),
  "utf8"
);

test("recycling child records use tenant-bound database relationships", () => {
  const expectedConstraints = [
    "recycling_material_sales_lot_tenant_fkey",
    "recycling_material_lots_source_lot_tenant_fkey",
    "recycling_material_lots_supplier_tenant_fkey",
    "recycling_material_sales_buyer_tenant_fkey",
    "recycling_manager_float_purchase_tenant_fkey",
    "recycling_sorting_input_tenant_fkey",
    "recycling_sorting_output_tenant_fkey",
    "recycling_stock_adjustment_lot_tenant_fkey",
    "recycling_followup_sale_tenant_fkey",
    "recycling_sale_payment_tenant_fkey",
    "recycling_purchase_payment_tenant_fkey",
  ];

  for (const constraint of expectedConstraints) {
    assert.match(migration, new RegExp(`ADD CONSTRAINT ${constraint}`));
  }
  assert.ok(
    (migration.match(/FOREIGN KEY \([^)]*, organization_id\)/g) || []).length >= expectedConstraints.length,
    "every protected relationship must carry organization_id in its foreign key"
  );
  assert.match(migration, /Cross-tenant recycling relationships exist/);
});
