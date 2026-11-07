-- Settings a recycling company administrator controls instead of values fixed in code: expense categories, cost
-- names, quality grades, loss reasons and payment rules. Missing values fall back to the defaults in the waste
-- service. Every change is kept in recycling_transaction_edits.
CREATE TABLE IF NOT EXISTS recycling_company_settings (
  organization_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(settings) = 'object'),
  updated_by UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (updated_by, organization_id) REFERENCES users(id, organization_id)
);

DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['recycling_company_settings'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS kwms_tenant ON %I', t);
    EXECUTE format('CREATE POLICY kwms_tenant ON %I USING (kwms_tenant_sees(organization_id)) WITH CHECK (kwms_tenant_sees(organization_id))', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_kwms_audit ON %I', t);
    EXECUTE format('CREATE TRIGGER trg_kwms_audit AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION kwms_audit_row()', t);
  END LOOP;
END $$;

-- Companies can add their own expense categories and quality grades, so the database no longer fixes the list.
-- The waste service checks each value against the company's settings.
ALTER TABLE organization_expenses DROP CONSTRAINT IF EXISTS organization_expenses_category_check;
ALTER TABLE organization_expenses ADD CONSTRAINT organization_expenses_category_check CHECK (category ~ '^[a-z0-9_]{2,30}$');
ALTER TABLE recycling_material_lots DROP CONSTRAINT IF EXISTS recycling_material_lots_quality_check;
ALTER TABLE recycling_material_lots ADD CONSTRAINT recycling_material_lots_quality_check CHECK (quality ~ '^[a-z0-9_]{2,30}$');

ALTER TABLE recycling_transaction_edits DROP CONSTRAINT IF EXISTS recycling_transaction_edits_transaction_type_check;
ALTER TABLE recycling_transaction_edits ADD CONSTRAINT recycling_transaction_edits_transaction_type_check
  CHECK (transaction_type IN ('purchase', 'sale', 'sorting_reversal', 'material_transfer', 'material_transfer_reversal', 'cash_correction', 'entry_cancelled', 'settings_change', 'material_rename'));

-- Payment deadlines use the company's own credit and payment days, 30 when not set.
CREATE OR REPLACE FUNCTION recycling_setting_days(p_organization_id UUID, p_key TEXT, p_default INT)
RETURNS INT LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT CASE WHEN settings->'rules'->>p_key ~ '^[0-9]{1,3}$' THEN (settings->'rules'->>p_key)::int END
    FROM recycling_company_settings WHERE organization_id = p_organization_id), p_default)
$$;
CREATE OR REPLACE FUNCTION set_recycling_payment_deadlines() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='recycling_material_lots' THEN
  IF NEW.origin='purchase' AND NEW.purchase_payment_status='credit' AND NEW.purchase_due_on IS NULL THEN NEW.purchase_due_on:=NEW.collected_on+recycling_setting_days(NEW.organization_id,'supplierCreditDays',30); END IF;
  IF NEW.purchase_payment_status='paid' THEN NEW.purchase_due_on:=NULL; END IF;
 ELSE
  IF NEW.status='recorded' AND NEW.due_on IS NULL THEN NEW.due_on:=NEW.sold_on+recycling_setting_days(NEW.organization_id,'buyerPaymentDays',30); END IF;
 END IF;
 RETURN NEW;
END $$;

-- Renaming a material only changes its name on past stock, so it is allowed on closed days when the waste service
-- marks the transaction as a rename and nothing else on the row changes.
CREATE OR REPLACE FUNCTION prevent_recycling_closed_day_update()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_date date; new_date date; date_key text;
BEGIN
 IF TG_TABLE_NAME='recycling_material_lots' AND current_setting('kwms.material_rename', true)='on'
    AND (to_jsonb(NEW)-'material_type'-'updated_at') = (to_jsonb(OLD)-'material_type'-'updated_at') THEN
  RETURN NEW;
 END IF;
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
