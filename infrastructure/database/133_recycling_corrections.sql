-- Administrator corrections for recycling companies: moving weight from one material to another, and the audit
-- entries for cash corrections and cancelled money entries. Every correction keeps a before and after copy in
-- recycling_transaction_edits.

-- A material move takes weight off a lot and puts it on a new lot of the other material. The new lot carries the
-- cost of the lot it came from, so profit and stock value stay right.
ALTER TABLE recycling_material_lots DROP CONSTRAINT IF EXISTS recycling_material_lots_origin_check;
ALTER TABLE recycling_material_lots ADD CONSTRAINT recycling_material_lots_origin_check
  CHECK (origin IN ('purchase', 'sorting_output', 'transfer'));

CREATE TABLE IF NOT EXISTS recycling_material_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entry_id UUID NOT NULL,
  from_lot_id UUID NOT NULL REFERENCES recycling_material_lots(id),
  to_lot_id UUID NOT NULL UNIQUE REFERENCES recycling_material_lots(id),
  from_material TEXT NOT NULL,
  to_material TEXT NOT NULL,
  quantity_kg NUMERIC(14,3) NOT NULL CHECK (quantity_kg > 0),
  transfer_date DATE NOT NULL,
  reason TEXT NOT NULL,
  recorded_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (recorded_by, organization_id) REFERENCES users(id, organization_id)
);
CREATE INDEX IF NOT EXISTS recycling_material_transfers_entry_idx ON recycling_material_transfers(organization_id, entry_id);

ALTER TABLE recycling_transaction_edits DROP CONSTRAINT IF EXISTS recycling_transaction_edits_transaction_type_check;
ALTER TABLE recycling_transaction_edits ADD CONSTRAINT recycling_transaction_edits_transaction_type_check
  CHECK (transaction_type IN ('purchase', 'sale', 'sorting_reversal', 'material_transfer', 'material_transfer_reversal', 'cash_correction', 'entry_cancelled'));

DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['recycling_material_transfers'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS kwms_tenant ON %I', t);
    EXECUTE format('CREATE POLICY kwms_tenant ON %I USING (kwms_tenant_sees(organization_id)) WITH CHECK (kwms_tenant_sees(organization_id))', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_kwms_audit ON %I', t);
    EXECUTE format('CREATE TRIGGER trg_kwms_audit AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION kwms_audit_row()', t);
  END LOOP;
END $$;
