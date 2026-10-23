-- Field staff pay sale costs (loading, food, transport) from the manager float, so office cash only
-- moves when money is handed to or returned by the manager. The float-funded share of each sale is
-- recorded on the sale and as a linked 'spent' float movement; cash position counts it once.
ALTER TABLE recycling_material_sales
  ADD COLUMN IF NOT EXISTS manager_float_used_ugx BIGINT NOT NULL DEFAULT 0 CHECK(manager_float_used_ugx>=0);
ALTER TABLE recycling_material_sales DROP CONSTRAINT IF EXISTS recycling_sale_float_within_costs;
ALTER TABLE recycling_material_sales
  ADD CONSTRAINT recycling_sale_float_within_costs
  CHECK(manager_float_used_ugx<=worker_wages_ugx+food_ugx+transport_ugx+other_expense_ugx);

ALTER TABLE recycling_manager_float_transactions
  ADD COLUMN IF NOT EXISTS sale_id UUID REFERENCES recycling_material_sales(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS recycling_float_sale_idx
  ON recycling_manager_float_transactions(sale_id) WHERE sale_id IS NOT NULL;

-- Same definition as 089 except the sale-cost term, which now leaves out the float-funded share
-- (that share is already counted through the linked 'spent' float movement).
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
  -COALESCE((SELECT SUM(amount_ugx) FROM recycling_manager_float_transactions WHERE organization_id=p_organization_id AND transaction_type='spent' AND transaction_date>=s.as_of_date),0)
  -COALESCE((SELECT SUM(processing_cost_ugx-manager_float_used_ugx) FROM recycling_sorting_batches WHERE organization_id=p_organization_id AND processed_on>=s.as_of_date),0)
  -COALESCE((SELECT SUM(worker_wages_ugx+food_ugx+transport_ugx+other_expense_ugx-manager_float_used_ugx) FROM recycling_material_sales WHERE organization_id=p_organization_id AND sold_on>=s.as_of_date),0))::bigint FROM s;
$$;
