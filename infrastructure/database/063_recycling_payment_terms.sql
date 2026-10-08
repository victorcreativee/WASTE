ALTER TABLE recycling_material_lots ADD COLUMN IF NOT EXISTS purchase_due_on DATE;
ALTER TABLE recycling_material_sales ADD COLUMN IF NOT EXISTS due_on DATE;

ALTER TABLE recycling_material_lots DROP CONSTRAINT IF EXISTS recycling_purchase_due_sequence;
ALTER TABLE recycling_material_lots ADD CONSTRAINT recycling_purchase_due_sequence
 CHECK(purchase_due_on IS NULL OR purchase_due_on>=collected_on);
ALTER TABLE recycling_material_sales DROP CONSTRAINT IF EXISTS recycling_sale_due_sequence;
ALTER TABLE recycling_material_sales ADD CONSTRAINT recycling_sale_due_sequence
 CHECK(due_on IS NULL OR due_on>=sold_on);

CREATE INDEX IF NOT EXISTS recycling_credit_purchase_due_idx
 ON recycling_material_lots(organization_id,purchase_due_on)
 WHERE origin='purchase' AND purchase_payment_status='credit';
CREATE INDEX IF NOT EXISTS recycling_sale_due_idx
 ON recycling_material_sales(organization_id,due_on)
 WHERE status='recorded';

CREATE OR REPLACE FUNCTION set_recycling_payment_deadlines() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='recycling_material_lots' THEN
  IF NEW.origin='purchase' AND NEW.purchase_payment_status='credit' AND NEW.purchase_due_on IS NULL THEN NEW.purchase_due_on:=NEW.collected_on+30; END IF;
  IF NEW.purchase_payment_status='paid' THEN NEW.purchase_due_on:=NULL; END IF;
 ELSE
  IF NEW.status='recorded' AND NEW.due_on IS NULL THEN NEW.due_on:=NEW.sold_on+30; END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS recycling_purchase_deadline_default ON recycling_material_lots;
CREATE TRIGGER recycling_purchase_deadline_default BEFORE INSERT OR UPDATE OF purchase_payment_status,purchase_due_on ON recycling_material_lots FOR EACH ROW EXECUTE FUNCTION set_recycling_payment_deadlines();
DROP TRIGGER IF EXISTS recycling_sale_deadline_default ON recycling_material_sales;
CREATE TRIGGER recycling_sale_deadline_default BEFORE INSERT OR UPDATE OF status,due_on ON recycling_material_sales FOR EACH ROW EXECUTE FUNCTION set_recycling_payment_deadlines();

UPDATE recycling_material_lots SET purchase_due_on=collected_on+30 WHERE origin='purchase' AND purchase_payment_status='credit' AND purchase_due_on IS NULL;
UPDATE recycling_material_sales SET due_on=sold_on+30 WHERE status='recorded' AND due_on IS NULL;
