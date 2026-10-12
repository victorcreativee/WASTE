-- Enforce recycling tenant ownership in PostgreSQL, not only in API queries.
-- The preflight block fails before constraints change if legacy cross-tenant links exist.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM recycling_material_sales child
    JOIN recycling_material_lots parent ON parent.id = child.lot_id
    WHERE child.organization_id <> parent.organization_id
  ) OR EXISTS (
    SELECT 1 FROM recycling_material_lots child
    JOIN recycling_material_lots parent ON parent.id = child.source_lot_id
    WHERE child.source_lot_id IS NOT NULL AND child.organization_id <> parent.organization_id
  ) OR EXISTS (
    SELECT 1 FROM recycling_material_lots child
    JOIN recycling_trade_partners parent ON parent.id = child.supplier_partner_id
    WHERE child.supplier_partner_id IS NOT NULL AND child.organization_id <> parent.organization_id
  ) OR EXISTS (
    SELECT 1 FROM recycling_material_sales child
    JOIN recycling_trade_partners parent ON parent.id = child.buyer_partner_id
    WHERE child.buyer_partner_id IS NOT NULL AND child.organization_id <> parent.organization_id
  ) OR EXISTS (
    SELECT 1 FROM recycling_manager_float_transactions child
    JOIN recycling_material_lots parent ON parent.id = child.purchase_lot_id
    WHERE child.purchase_lot_id IS NOT NULL AND child.organization_id <> parent.organization_id
  ) OR EXISTS (
    SELECT 1 FROM recycling_sorting_batches child
    JOIN recycling_material_lots parent ON parent.id IN (child.input_lot_id, child.output_lot_id)
    WHERE child.organization_id <> parent.organization_id
  ) OR EXISTS (
    SELECT 1 FROM recycling_stock_adjustments child
    JOIN recycling_material_lots parent ON parent.id = child.lot_id
    WHERE child.organization_id <> parent.organization_id
  ) OR EXISTS (
    SELECT 1 FROM recycling_payment_followups child
    JOIN recycling_material_sales parent ON parent.id = child.sale_id
    WHERE child.organization_id <> parent.organization_id
  ) OR EXISTS (
    SELECT 1 FROM recycling_sale_payments child
    JOIN recycling_material_sales parent ON parent.id = child.sale_id
    WHERE child.organization_id <> parent.organization_id
  ) OR EXISTS (
    SELECT 1 FROM recycling_purchase_payments child
    JOIN recycling_material_lots parent ON parent.id = child.lot_id
    WHERE child.organization_id <> parent.organization_id
  ) THEN
    RAISE EXCEPTION 'Cross-tenant recycling relationships exist. Correct them before applying migration 072.';
  END IF;
END $$;

ALTER TABLE recycling_material_lots
  DROP CONSTRAINT IF EXISTS recycling_material_lots_id_org_unique,
  ADD CONSTRAINT recycling_material_lots_id_org_unique UNIQUE (id, organization_id);
ALTER TABLE recycling_material_sales
  DROP CONSTRAINT IF EXISTS recycling_material_sales_id_org_unique,
  ADD CONSTRAINT recycling_material_sales_id_org_unique UNIQUE (id, organization_id);
ALTER TABLE recycling_trade_partners
  DROP CONSTRAINT IF EXISTS recycling_trade_partners_id_org_unique,
  ADD CONSTRAINT recycling_trade_partners_id_org_unique UNIQUE (id, organization_id);

ALTER TABLE recycling_material_sales
  DROP CONSTRAINT IF EXISTS recycling_material_sales_lot_id_fkey,
  ADD CONSTRAINT recycling_material_sales_lot_tenant_fkey
    FOREIGN KEY (lot_id, organization_id)
    REFERENCES recycling_material_lots (id, organization_id);

ALTER TABLE recycling_material_lots
  DROP CONSTRAINT IF EXISTS recycling_material_lots_source_lot_id_fkey,
  DROP CONSTRAINT IF EXISTS recycling_material_lots_supplier_partner_id_fkey,
  ADD CONSTRAINT recycling_material_lots_source_lot_tenant_fkey
    FOREIGN KEY (source_lot_id, organization_id)
    REFERENCES recycling_material_lots (id, organization_id),
  ADD CONSTRAINT recycling_material_lots_supplier_tenant_fkey
    FOREIGN KEY (supplier_partner_id, organization_id)
    REFERENCES recycling_trade_partners (id, organization_id);

ALTER TABLE recycling_material_sales
  DROP CONSTRAINT IF EXISTS recycling_material_sales_buyer_partner_id_fkey,
  ADD CONSTRAINT recycling_material_sales_buyer_tenant_fkey
    FOREIGN KEY (buyer_partner_id, organization_id)
    REFERENCES recycling_trade_partners (id, organization_id);

ALTER TABLE recycling_manager_float_transactions
  DROP CONSTRAINT IF EXISTS recycling_manager_float_transactions_purchase_lot_id_fkey,
  ADD CONSTRAINT recycling_manager_float_purchase_tenant_fkey
    FOREIGN KEY (purchase_lot_id, organization_id)
    REFERENCES recycling_material_lots (id, organization_id);

ALTER TABLE recycling_sorting_batches
  DROP CONSTRAINT IF EXISTS recycling_sorting_batches_input_lot_id_fkey,
  DROP CONSTRAINT IF EXISTS recycling_sorting_batches_output_lot_id_fkey,
  ADD CONSTRAINT recycling_sorting_input_tenant_fkey
    FOREIGN KEY (input_lot_id, organization_id)
    REFERENCES recycling_material_lots (id, organization_id),
  ADD CONSTRAINT recycling_sorting_output_tenant_fkey
    FOREIGN KEY (output_lot_id, organization_id)
    REFERENCES recycling_material_lots (id, organization_id);

ALTER TABLE recycling_stock_adjustments
  DROP CONSTRAINT IF EXISTS recycling_stock_adjustments_lot_id_fkey,
  ADD CONSTRAINT recycling_stock_adjustment_lot_tenant_fkey
    FOREIGN KEY (lot_id, organization_id)
    REFERENCES recycling_material_lots (id, organization_id);

ALTER TABLE recycling_payment_followups
  DROP CONSTRAINT IF EXISTS recycling_payment_followups_sale_id_fkey,
  ADD CONSTRAINT recycling_followup_sale_tenant_fkey
    FOREIGN KEY (sale_id, organization_id)
    REFERENCES recycling_material_sales (id, organization_id) ON DELETE CASCADE;

ALTER TABLE recycling_sale_payments
  DROP CONSTRAINT IF EXISTS recycling_sale_payments_sale_id_fkey,
  ADD CONSTRAINT recycling_sale_payment_tenant_fkey
    FOREIGN KEY (sale_id, organization_id)
    REFERENCES recycling_material_sales (id, organization_id) ON DELETE CASCADE;

ALTER TABLE recycling_purchase_payments
  DROP CONSTRAINT IF EXISTS recycling_purchase_payments_lot_id_fkey,
  ADD CONSTRAINT recycling_purchase_payment_tenant_fkey
    FOREIGN KEY (lot_id, organization_id)
    REFERENCES recycling_material_lots (id, organization_id) ON DELETE CASCADE;
