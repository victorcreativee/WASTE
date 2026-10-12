CREATE TABLE IF NOT EXISTS recycling_daily_closures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  operating_date date NOT NULL,
  status text NOT NULL DEFAULT 'closed' CHECK (status IN ('closed', 'reopened')),
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  closed_by uuid NOT NULL REFERENCES users(id),
  closed_at timestamptz NOT NULL DEFAULT now(),
  reopened_by uuid REFERENCES users(id),
  reopened_at timestamptz,
  reopen_reason text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, operating_date)
);

CREATE INDEX IF NOT EXISTS idx_recycling_daily_closures_org_date
  ON recycling_daily_closures (organization_id, operating_date DESC);

CREATE OR REPLACE FUNCTION prevent_recycling_closed_day_write()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE record_date date;
BEGIN
  record_date := (to_jsonb(NEW) ->> CASE TG_TABLE_NAME
    WHEN 'recycling_material_lots' THEN 'collected_on'
    WHEN 'recycling_material_sales' THEN 'sold_on'
    WHEN 'recycling_manager_float_transactions' THEN 'transaction_date'
    WHEN 'recycling_sorting_batches' THEN 'processed_on'
    WHEN 'recycling_stock_adjustments' THEN 'adjustment_date'
    WHEN 'recycling_sale_payments' THEN 'paid_on'
    WHEN 'recycling_purchase_payments' THEN 'paid_on'
  END)::date;
  IF EXISTS (
    SELECT 1 FROM recycling_daily_closures
    WHERE organization_id=NEW.organization_id AND operating_date=record_date AND status='closed'
  ) THEN
    RAISE EXCEPTION 'Business day % is closed. A company administrator must reopen it before records can be changed.', record_date
      USING ERRCODE='check_violation';
  END IF;
  RETURN NEW;
END $$;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'recycling_material_lots','recycling_material_sales','recycling_manager_float_transactions',
    'recycling_sorting_batches','recycling_stock_adjustments','recycling_sale_payments','recycling_purchase_payments'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS prevent_closed_day_write ON %I', table_name);
    EXECUTE format('CREATE TRIGGER prevent_closed_day_write BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION prevent_recycling_closed_day_write()', table_name);
  END LOOP;
END $$;
