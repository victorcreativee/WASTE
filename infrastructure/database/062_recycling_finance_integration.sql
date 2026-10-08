-- Include recycling trade cash movements and unpaid commitments in the shared
-- organization finance controls without duplicating source transactions.
CREATE OR REPLACE FUNCTION organization_cash_position(p_organization_id UUID)
RETURNS BIGINT LANGUAGE sql STABLE AS $$
  WITH settings AS (
    SELECT COALESCE(s.opening_balance_ugx,0)::bigint opening_balance_ugx,
           COALESCE(s.as_of_date,DATE '1970-01-01')::date as_of_date
    FROM (SELECT 1) seed LEFT JOIN organization_finance_settings s ON s.organization_id=p_organization_id
  )
  SELECT (s.opening_balance_ugx
    + COALESCE((SELECT SUM(amount_ugx) FROM customer_payments WHERE organization_id=p_organization_id AND status='successful' AND COALESCE(confirmed_at,created_at)::date>=s.as_of_date),0)
    + COALESCE((SELECT SUM(quantity_kg*unit_price_ugx) FROM recycling_material_sales WHERE organization_id=p_organization_id AND status='paid' AND COALESCE(paid_on,sold_on)>=s.as_of_date),0)
    - COALESCE((SELECT SUM(amount_ugx) FROM organization_expenses WHERE organization_id=p_organization_id AND status='paid' AND COALESCE(paid_at::date,expense_date)>=s.as_of_date),0)
    - COALESCE((SELECT SUM(amount_ugx) FROM supplier_payments WHERE organization_id=p_organization_id AND paid_on>=s.as_of_date),0)
    - COALESCE((SELECT SUM(GREATEST(quantity_kg*unit_purchase_price_ugx+worker_wages_ugx+food_ugx+transport_ugx+driver_fee_ugx+other_expense_ugx-manager_float_used_ugx,0)) FROM recycling_material_lots WHERE organization_id=p_organization_id AND origin='purchase' AND purchase_payment_status='paid' AND COALESCE(purchase_paid_on,collected_on)>=s.as_of_date),0)
    - COALESCE((SELECT SUM(amount_ugx) FROM recycling_manager_float_transactions WHERE organization_id=p_organization_id AND transaction_type='spent' AND transaction_date>=s.as_of_date),0)
    - COALESCE((SELECT SUM(processing_cost_ugx) FROM recycling_sorting_batches WHERE organization_id=p_organization_id AND processed_on>=s.as_of_date),0)
    - COALESCE((SELECT SUM(worker_wages_ugx+food_ugx+transport_ugx+other_expense_ugx) FROM recycling_material_sales WHERE organization_id=p_organization_id AND sold_on>=s.as_of_date),0))::bigint
  FROM settings s;
$$;

CREATE OR REPLACE FUNCTION organization_committed_funds(p_organization_id UUID)
RETURNS BIGINT LANGUAGE sql STABLE AS $$
  SELECT (COALESCE((SELECT SUM(amount_ugx) FROM organization_expenses WHERE organization_id=p_organization_id AND status='approved'),0)
    + COALESCE((SELECT SUM(balance_ugx) FROM supplier_bills WHERE organization_id=p_organization_id AND status IN ('open','partially_paid','overdue')),0)
    + COALESCE((SELECT SUM(po.quantity*po.unit_price_ugx) FROM purchase_orders po WHERE po.organization_id=p_organization_id AND po.status IN ('issued','received') AND NOT EXISTS(SELECT 1 FROM supplier_bills b WHERE b.purchase_order_id=po.id AND b.status<>'void')),0)
    + COALESCE((SELECT SUM(l.basic_pay_ugx+l.allowance_ugx-l.deduction_ugx) FROM payroll_periods p JOIN payroll_lines l ON l.period_id=p.id WHERE p.organization_id=p_organization_id AND p.status='approved'),0)
    + COALESCE((SELECT SUM(quantity_kg*unit_purchase_price_ugx+worker_wages_ugx+food_ugx+transport_ugx+driver_fee_ugx+other_expense_ugx) FROM recycling_material_lots WHERE organization_id=p_organization_id AND origin='purchase' AND purchase_payment_status='credit'),0))::bigint;
$$;

CREATE OR REPLACE FUNCTION organization_available_to_commit(p_organization_id UUID)
RETURNS BIGINT LANGUAGE sql STABLE AS $$
  SELECT (organization_cash_position(p_organization_id)-organization_committed_funds(p_organization_id))::bigint;
$$;
