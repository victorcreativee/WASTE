-- One daily-expense posting may be paid from accountable manager float.
-- Keep the expense ledger as the reporting source and link the matching float
-- reduction so finance totals do not count the same spend twice.
ALTER TABLE recycling_manager_float_transactions
  ADD COLUMN IF NOT EXISTS expense_batch_reference TEXT;

CREATE INDEX IF NOT EXISTS recycling_float_expense_batch_idx
  ON recycling_manager_float_transactions(organization_id,expense_batch_reference)
  WHERE expense_batch_reference IS NOT NULL;

CREATE OR REPLACE FUNCTION organization_cash_position(p_organization_id UUID)
RETURNS BIGINT LANGUAGE sql STABLE AS $$
 WITH s AS (SELECT COALESCE(opening_balance_ugx,0)::bigint opening_balance_ugx,COALESCE(as_of_date,DATE '1970-01-01') as_of_date FROM (SELECT 1)seed LEFT JOIN organization_finance_settings ON organization_id=p_organization_id)
 SELECT (s.opening_balance_ugx
  +COALESCE((SELECT SUM(amount_ugx) FROM recycling_cash_movements WHERE organization_id=p_organization_id AND direction='in' AND movement_date>=s.as_of_date),0)
  -COALESCE((SELECT SUM(amount_ugx) FROM recycling_cash_movements WHERE organization_id=p_organization_id AND direction='out' AND movement_date>=s.as_of_date),0)
  +COALESCE((SELECT SUM(amount_ugx) FROM customer_payments WHERE organization_id=p_organization_id AND status='successful' AND COALESCE(confirmed_at,created_at)::date>=s.as_of_date),0)
  +COALESCE((SELECT SUM(amount_ugx) FROM recycling_sale_payments WHERE organization_id=p_organization_id AND paid_on>=s.as_of_date),0)
  -COALESCE((SELECT SUM(amount_ugx) FROM organization_expenses WHERE organization_id=p_organization_id AND status='paid' AND COALESCE(paid_at::date,expense_date)>=s.as_of_date),0)
  -COALESCE((SELECT SUM(amount_ugx) FROM supplier_payments WHERE organization_id=p_organization_id AND paid_on>=s.as_of_date),0)
  -COALESCE((SELECT SUM(GREATEST(p.paid-l.manager_float_used_ugx,0)) FROM recycling_material_lots l JOIN(SELECT lot_id,SUM(amount_ugx) paid FROM recycling_purchase_payments WHERE organization_id=p_organization_id AND paid_on>=s.as_of_date GROUP BY lot_id)p ON p.lot_id=l.id),0)
  -COALESCE((SELECT SUM(amount_ugx) FROM recycling_manager_float_transactions WHERE organization_id=p_organization_id AND transaction_type='spent' AND transaction_date>=s.as_of_date AND expense_batch_reference IS NULL),0)
  -COALESCE((SELECT SUM(processing_cost_ugx-manager_float_used_ugx) FROM recycling_sorting_batches WHERE organization_id=p_organization_id AND processed_on>=s.as_of_date),0)
  -COALESCE((SELECT SUM(worker_wages_ugx+food_ugx+transport_ugx+other_expense_ugx-manager_float_used_ugx) FROM recycling_material_sales WHERE organization_id=p_organization_id AND sold_on>=s.as_of_date),0))::bigint FROM s;
$$;
