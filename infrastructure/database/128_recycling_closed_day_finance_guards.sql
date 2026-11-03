-- A recycling close must protect every record that changes cash, float, stock
-- or the daily expense ledger. API guards provide friendly messages; these
-- triggers are the final protection for imports, older clients and maintenance
-- scripts. Waste-collection organizations are unaffected because they have no
-- recycling_daily_closures rows.

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
    WHEN 'recycling_cash_movements' THEN 'movement_date'
    WHEN 'recycling_loans' THEN 'received_on'
    WHEN 'organization_expenses' THEN 'expense_date'
  END)::date;
  IF EXISTS (
    SELECT 1 FROM recycling_daily_closures
    WHERE organization_id=NEW.organization_id AND operating_date=record_date AND status='closed'
  ) THEN
    RAISE EXCEPTION 'Business day % is closed. Reopen it before changing financial or operational records.', record_date
      USING ERRCODE='check_violation';
  END IF;
  RETURN NEW;
END $$;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'recycling_cash_movements','recycling_loans','organization_expenses'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS prevent_closed_day_write ON %I', table_name);
    EXECUTE format('CREATE TRIGGER prevent_closed_day_write BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION prevent_recycling_closed_day_write()', table_name);
  END LOOP;
END $$;

-- Corrections to dated finance records are protected too. Payment rows and the
-- main purchase/sale records already have their own closed-day protections.
CREATE OR REPLACE FUNCTION prevent_recycling_closed_finance_update()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_date date; new_date date; date_key text;
BEGIN
  date_key := CASE TG_TABLE_NAME
    WHEN 'recycling_cash_movements' THEN 'movement_date'
    WHEN 'recycling_loans' THEN 'received_on'
    WHEN 'organization_expenses' THEN 'expense_date'
  END;
  old_date := (to_jsonb(OLD)->>date_key)::date;
  new_date := (to_jsonb(NEW)->>date_key)::date;
  IF EXISTS (
    SELECT 1 FROM recycling_daily_closures
    WHERE organization_id=NEW.organization_id
      AND operating_date IN(old_date,new_date) AND status='closed'
  ) THEN
    RAISE EXCEPTION 'Business day is closed. Reopen it before changing financial records.'
      USING ERRCODE='check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS prevent_closed_finance_update ON recycling_cash_movements;
CREATE TRIGGER prevent_closed_finance_update BEFORE UPDATE OF
 movement_date,direction,category,amount_ugx,reference,counterparty,notes
 ON recycling_cash_movements FOR EACH ROW EXECUTE FUNCTION prevent_recycling_closed_finance_update();

DROP TRIGGER IF EXISTS prevent_closed_finance_update ON recycling_loans;
CREATE TRIGGER prevent_closed_finance_update BEFORE UPDATE OF
 lender_name,amount_ugx,received_on,due_on,reference,notes
 ON recycling_loans FOR EACH ROW EXECUTE FUNCTION prevent_recycling_closed_finance_update();

DROP TRIGGER IF EXISTS prevent_closed_finance_update ON organization_expenses;
CREATE TRIGGER prevent_closed_finance_update BEFORE UPDATE OF
 category,description,vendor,amount_ugx,expense_date,reference,status
 ON organization_expenses FOR EACH ROW EXECUTE FUNCTION prevent_recycling_closed_finance_update();

