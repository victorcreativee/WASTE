-- Ensure every recycling audit actor belongs to the same organization as the
-- record they create. This prevents valid user IDs from another company being
-- attached to purchases, sales, payments, stock or daily closures.
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM recycling_material_lots r JOIN users u ON u.id=r.created_by WHERE u.organization_id IS DISTINCT FROM r.organization_id)
 OR EXISTS (SELECT 1 FROM recycling_material_sales r JOIN users u ON u.id=r.recorded_by WHERE u.organization_id IS DISTINCT FROM r.organization_id)
 OR EXISTS (SELECT 1 FROM recycling_manager_float_transactions r JOIN users u ON u.id=r.recorded_by WHERE u.organization_id IS DISTINCT FROM r.organization_id)
 OR EXISTS (SELECT 1 FROM recycling_sorting_batches r JOIN users u ON u.id=r.recorded_by WHERE u.organization_id IS DISTINCT FROM r.organization_id)
 OR EXISTS (SELECT 1 FROM recycling_trade_partners r JOIN users u ON u.id=r.created_by WHERE u.organization_id IS DISTINCT FROM r.organization_id)
 OR EXISTS (SELECT 1 FROM recycling_stock_adjustments r JOIN users u ON u.id=r.recorded_by WHERE u.organization_id IS DISTINCT FROM r.organization_id)
 OR EXISTS (SELECT 1 FROM recycling_payment_followups r JOIN users u ON u.id=r.recorded_by WHERE u.organization_id IS DISTINCT FROM r.organization_id)
 OR EXISTS (SELECT 1 FROM recycling_sale_payments r JOIN users u ON u.id=r.recorded_by WHERE u.organization_id IS DISTINCT FROM r.organization_id)
 OR EXISTS (SELECT 1 FROM recycling_purchase_payments r JOIN users u ON u.id=r.recorded_by WHERE u.organization_id IS DISTINCT FROM r.organization_id)
 OR EXISTS (SELECT 1 FROM recycling_material_catalog r JOIN users u ON u.id=r.created_by WHERE r.created_by IS NOT NULL AND u.organization_id IS DISTINCT FROM r.organization_id)
 OR EXISTS (SELECT 1 FROM recycling_daily_closures r JOIN users u ON u.id=r.closed_by WHERE u.organization_id IS DISTINCT FROM r.organization_id)
 OR EXISTS (SELECT 1 FROM recycling_daily_closures r JOIN users u ON u.id=r.reopened_by WHERE r.reopened_by IS NOT NULL AND u.organization_id IS DISTINCT FROM r.organization_id)
 THEN
  RAISE EXCEPTION 'Cross-tenant recycling actor references exist. Correct them before applying migration 075.';
 END IF;
END $$;

ALTER TABLE users
 DROP CONSTRAINT IF EXISTS users_id_org_unique,
 ADD CONSTRAINT users_id_org_unique UNIQUE(id,organization_id);

ALTER TABLE recycling_material_lots
 DROP CONSTRAINT IF EXISTS recycling_material_lots_created_by_fkey,
 DROP CONSTRAINT IF EXISTS recycling_lot_creator_tenant_fkey,
 ADD CONSTRAINT recycling_lot_creator_tenant_fkey
  FOREIGN KEY(created_by,organization_id) REFERENCES users(id,organization_id);

ALTER TABLE recycling_material_sales
 DROP CONSTRAINT IF EXISTS recycling_material_sales_recorded_by_fkey,
 DROP CONSTRAINT IF EXISTS recycling_sale_recorder_tenant_fkey,
 ADD CONSTRAINT recycling_sale_recorder_tenant_fkey
  FOREIGN KEY(recorded_by,organization_id) REFERENCES users(id,organization_id);

ALTER TABLE recycling_manager_float_transactions
 DROP CONSTRAINT IF EXISTS recycling_manager_float_transactions_recorded_by_fkey,
 DROP CONSTRAINT IF EXISTS recycling_float_recorder_tenant_fkey,
 ADD CONSTRAINT recycling_float_recorder_tenant_fkey
  FOREIGN KEY(recorded_by,organization_id) REFERENCES users(id,organization_id);

ALTER TABLE recycling_sorting_batches
 DROP CONSTRAINT IF EXISTS recycling_sorting_batches_recorded_by_fkey,
 DROP CONSTRAINT IF EXISTS recycling_sorting_recorder_tenant_fkey,
 ADD CONSTRAINT recycling_sorting_recorder_tenant_fkey
  FOREIGN KEY(recorded_by,organization_id) REFERENCES users(id,organization_id);

ALTER TABLE recycling_trade_partners
 DROP CONSTRAINT IF EXISTS recycling_trade_partners_created_by_fkey,
 DROP CONSTRAINT IF EXISTS recycling_partner_creator_tenant_fkey,
 ADD CONSTRAINT recycling_partner_creator_tenant_fkey
  FOREIGN KEY(created_by,organization_id) REFERENCES users(id,organization_id);

ALTER TABLE recycling_stock_adjustments
 DROP CONSTRAINT IF EXISTS recycling_stock_adjustments_recorded_by_fkey,
 DROP CONSTRAINT IF EXISTS recycling_adjustment_recorder_tenant_fkey,
 ADD CONSTRAINT recycling_adjustment_recorder_tenant_fkey
  FOREIGN KEY(recorded_by,organization_id) REFERENCES users(id,organization_id);

ALTER TABLE recycling_payment_followups
 DROP CONSTRAINT IF EXISTS recycling_payment_followups_recorded_by_fkey,
 DROP CONSTRAINT IF EXISTS recycling_followup_recorder_tenant_fkey,
 ADD CONSTRAINT recycling_followup_recorder_tenant_fkey
  FOREIGN KEY(recorded_by,organization_id) REFERENCES users(id,organization_id);

ALTER TABLE recycling_sale_payments
 DROP CONSTRAINT IF EXISTS recycling_sale_payments_recorded_by_fkey,
 DROP CONSTRAINT IF EXISTS recycling_sale_payment_recorder_tenant_fkey,
 ADD CONSTRAINT recycling_sale_payment_recorder_tenant_fkey
  FOREIGN KEY(recorded_by,organization_id) REFERENCES users(id,organization_id);

ALTER TABLE recycling_purchase_payments
 DROP CONSTRAINT IF EXISTS recycling_purchase_payments_recorded_by_fkey,
 DROP CONSTRAINT IF EXISTS recycling_purchase_payment_recorder_tenant_fkey,
 ADD CONSTRAINT recycling_purchase_payment_recorder_tenant_fkey
  FOREIGN KEY(recorded_by,organization_id) REFERENCES users(id,organization_id);

ALTER TABLE recycling_material_catalog
 DROP CONSTRAINT IF EXISTS recycling_material_catalog_created_by_fkey,
 DROP CONSTRAINT IF EXISTS recycling_material_creator_tenant_fkey,
 ADD CONSTRAINT recycling_material_creator_tenant_fkey
  FOREIGN KEY(created_by,organization_id) REFERENCES users(id,organization_id);

ALTER TABLE recycling_daily_closures
 DROP CONSTRAINT IF EXISTS recycling_daily_closures_closed_by_fkey,
 DROP CONSTRAINT IF EXISTS recycling_daily_closures_reopened_by_fkey,
 DROP CONSTRAINT IF EXISTS recycling_closure_closer_tenant_fkey,
 DROP CONSTRAINT IF EXISTS recycling_closure_reopener_tenant_fkey,
 ADD CONSTRAINT recycling_closure_closer_tenant_fkey
  FOREIGN KEY(closed_by,organization_id) REFERENCES users(id,organization_id),
 ADD CONSTRAINT recycling_closure_reopener_tenant_fkey
  FOREIGN KEY(reopened_by,organization_id) REFERENCES users(id,organization_id);
