CREATE TABLE IF NOT EXISTS recycling_transaction_edits (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 transaction_type text NOT NULL CHECK(transaction_type IN('purchase','sale')),
 transaction_id uuid NOT NULL,
 before_state jsonb NOT NULL,
 after_state jsonb NOT NULL,
 edited_by uuid NOT NULL,
 edited_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE recycling_transaction_edits
 DROP CONSTRAINT IF EXISTS recycling_transaction_edit_actor_tenant_fkey,
 ADD CONSTRAINT recycling_transaction_edit_actor_tenant_fkey
  FOREIGN KEY(edited_by,organization_id) REFERENCES users(id,organization_id);

CREATE INDEX IF NOT EXISTS recycling_transaction_edits_lookup_idx
 ON recycling_transaction_edits(organization_id,transaction_type,transaction_id,edited_at DESC);

-- Closed business days protect corrections as well as new entries. Both the
-- original and replacement date are checked so records cannot be moved into
-- or out of a locked day.
CREATE OR REPLACE FUNCTION prevent_recycling_closed_day_update()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_date date; new_date date; date_key text;
BEGIN
 date_key := CASE TG_TABLE_NAME
  WHEN 'recycling_material_lots' THEN 'collected_on'
  WHEN 'recycling_material_sales' THEN 'sold_on'
 END;
 old_date := (to_jsonb(OLD)->>date_key)::date;
 new_date := (to_jsonb(NEW)->>date_key)::date;
 IF EXISTS (
  SELECT 1 FROM recycling_daily_closures
  WHERE organization_id=NEW.organization_id
   AND operating_date IN(old_date,new_date) AND status='closed'
 ) THEN
  RAISE EXCEPTION 'Business day is closed. Reopen it before editing this transaction.'
   USING ERRCODE='check_violation';
 END IF;
 RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS prevent_closed_day_update ON recycling_material_lots;
CREATE TRIGGER prevent_closed_day_update BEFORE UPDATE OF
 material_type,supplier_partner_id,source_name,quantity_kg,unit_purchase_price_ugx,
 collected_on,quality,worker_wages_ugx,food_ugx,transport_ugx,driver_fee_ugx,
 other_expense_ugx,notes ON recycling_material_lots
 FOR EACH ROW EXECUTE FUNCTION prevent_recycling_closed_day_update();
DROP TRIGGER IF EXISTS prevent_closed_day_update ON recycling_material_sales;
CREATE TRIGGER prevent_closed_day_update BEFORE UPDATE OF
 lot_id,buyer_partner_id,buyer_name,sale_channel,industry,invoice_number,
 quantity_kg,unit_price_ugx,sold_on,worker_wages_ugx,food_ugx,transport_ugx,
 other_expense_ugx,notes ON recycling_material_sales
 FOR EACH ROW EXECUTE FUNCTION prevent_recycling_closed_day_update();
