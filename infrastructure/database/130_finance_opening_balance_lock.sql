-- Once real money or accountable float has been recorded, the opening balance is
-- an accounting baseline. It must be corrected through ledger entries, never by
-- rewriting or deleting the baseline.
CREATE OR REPLACE FUNCTION organization_has_finance_activity(p_organization_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT
    EXISTS(SELECT 1 FROM customer_payments WHERE organization_id=p_organization_id AND status='successful') OR
    EXISTS(SELECT 1 FROM organization_expenses WHERE organization_id=p_organization_id AND status='paid') OR
    EXISTS(SELECT 1 FROM supplier_payments WHERE organization_id=p_organization_id) OR
    EXISTS(SELECT 1 FROM recycling_sale_payments WHERE organization_id=p_organization_id) OR
    EXISTS(SELECT 1 FROM recycling_purchase_payments WHERE organization_id=p_organization_id) OR
    EXISTS(SELECT 1 FROM recycling_cash_movements WHERE organization_id=p_organization_id) OR
    EXISTS(SELECT 1 FROM recycling_manager_float_transactions WHERE organization_id=p_organization_id) OR
    EXISTS(SELECT 1 FROM recycling_sorting_batches WHERE organization_id=p_organization_id AND processing_cost_ugx>0) OR
    EXISTS(SELECT 1 FROM recycling_material_sales WHERE organization_id=p_organization_id AND worker_wages_ugx+food_ugx+transport_ugx+other_expense_ugx>0)
$$;

CREATE OR REPLACE FUNCTION prevent_finance_baseline_rewrite()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_organization uuid;
BEGIN
  target_organization := CASE WHEN TG_OP='DELETE' THEN OLD.organization_id ELSE NEW.organization_id END;
  IF current_setting('app.allow_audit_reset', true)='true' THEN
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='DELETE' AND organization_has_finance_activity(target_organization) THEN
    RAISE EXCEPTION 'Opening balance is locked because financial activity has been recorded. Use a reviewed ledger correction.'
      USING ERRCODE='check_violation';
  END IF;
  IF TG_OP='UPDATE'
     AND (NEW.opening_balance_ugx IS DISTINCT FROM OLD.opening_balance_ugx OR NEW.as_of_date IS DISTINCT FROM OLD.as_of_date)
     AND organization_has_finance_activity(target_organization) THEN
    RAISE EXCEPTION 'Opening balance is locked because financial activity has been recorded. Use a reviewed ledger correction.'
      USING ERRCODE='check_violation';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS prevent_finance_baseline_update ON organization_finance_settings;
CREATE TRIGGER prevent_finance_baseline_update
  BEFORE UPDATE OF opening_balance_ugx,as_of_date ON organization_finance_settings
  FOR EACH ROW EXECUTE FUNCTION prevent_finance_baseline_rewrite();

DROP TRIGGER IF EXISTS prevent_finance_baseline_delete ON organization_finance_settings;
CREATE TRIGGER prevent_finance_baseline_delete
  BEFORE DELETE ON organization_finance_settings
  FOR EACH ROW EXECUTE FUNCTION prevent_finance_baseline_rewrite();
