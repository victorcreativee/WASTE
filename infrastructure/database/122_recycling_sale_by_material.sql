-- Recycling: sales from a material total, weight the buyer refused, and reversing a sorting entry.
--
-- 1. A sale can take its weight from every lot of one material (oldest first), like sorting already can.
--    recycling_sale_lots records which lots each sale's weight came from. Sales recorded before this
--    migration have no rows there and keep using lot_id and quantity_kg.
-- 2. delivered_kg is the weight taken to the buyer; quantity_kg stays the weight the buyer paid for, so
--    every existing total (quantity_kg × unit_price_ugx) keeps its meaning. The difference is weight the
--    buyer refused and kept as waste. NULL means the sale was recorded before this and nothing was refused.
-- 3. A sorting entry from a material total writes one row per input lot. entry_id ties those rows together
--    so the entry can be reversed as a whole.

ALTER TABLE recycling_material_sales ADD COLUMN IF NOT EXISTS delivered_kg NUMERIC(12,2);
ALTER TABLE recycling_material_sales DROP CONSTRAINT IF EXISTS recycling_material_sales_delivered_check;
ALTER TABLE recycling_material_sales ADD CONSTRAINT recycling_material_sales_delivered_check
  CHECK (delivered_kg IS NULL OR delivered_kg >= quantity_kg);

CREATE TABLE IF NOT EXISTS recycling_sale_lots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  sale_id UUID NOT NULL REFERENCES recycling_material_sales(id) ON DELETE CASCADE,
  lot_id UUID NOT NULL REFERENCES recycling_material_lots(id),
  delivered_kg NUMERIC(12,3) NOT NULL CHECK (delivered_kg > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sale_id, lot_id)
);
CREATE INDEX IF NOT EXISTS recycling_sale_lots_lot_idx ON recycling_sale_lots(organization_id, lot_id);

ALTER TABLE recycling_sorting_batches ADD COLUMN IF NOT EXISTS entry_id UUID;
-- Rows written by one material-total entry share a transaction, so they share created_at.
UPDATE recycling_sorting_batches b SET entry_id = g.entry_id
FROM (SELECT id, (array_agg(id) OVER (PARTITION BY organization_id, recorded_by, created_at, output_material_type))[1] entry_id
      FROM recycling_sorting_batches) g
WHERE g.id = b.id AND b.entry_id IS NULL;
UPDATE recycling_sorting_batches SET entry_id = id WHERE entry_id IS NULL;
ALTER TABLE recycling_sorting_batches ALTER COLUMN entry_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS recycling_sorting_entry_idx ON recycling_sorting_batches(organization_id, entry_id);

-- Reversed sorting entries are kept in the edit history.
ALTER TABLE recycling_transaction_edits DROP CONSTRAINT IF EXISTS recycling_transaction_edits_transaction_type_check;
ALTER TABLE recycling_transaction_edits ADD CONSTRAINT recycling_transaction_edits_transaction_type_check
  CHECK (transaction_type IN ('purchase', 'sale', 'sorting_reversal'));

ALTER TABLE recycling_sale_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE recycling_sale_lots FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kwms_tenant ON recycling_sale_lots;
CREATE POLICY kwms_tenant ON recycling_sale_lots
  USING (kwms_tenant_sees(organization_id)) WITH CHECK (kwms_tenant_sees(organization_id));

DROP TRIGGER IF EXISTS trg_kwms_audit ON recycling_sale_lots;
CREATE TRIGGER trg_kwms_audit AFTER INSERT OR UPDATE OR DELETE ON recycling_sale_lots FOR EACH ROW EXECUTE FUNCTION kwms_audit_row();
DROP TRIGGER IF EXISTS trg_kwms_audit ON recycling_sorting_batches;
CREATE TRIGGER trg_kwms_audit AFTER INSERT OR UPDATE OR DELETE ON recycling_sorting_batches FOR EACH ROW EXECUTE FUNCTION kwms_audit_row();
