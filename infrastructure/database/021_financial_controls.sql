CREATE OR REPLACE FUNCTION organization_cash_position(p_organization_id UUID)
RETURNS BIGINT LANGUAGE sql STABLE AS $$
  WITH settings AS (
    SELECT COALESCE(s.opening_balance_ugx,0)::bigint opening_balance_ugx,
           COALESCE(s.as_of_date,CURRENT_DATE)::date as_of_date
    FROM (SELECT 1) seed LEFT JOIN organization_finance_settings s ON s.organization_id=p_organization_id
  )
  SELECT (s.opening_balance_ugx
    + COALESCE((SELECT SUM(amount_ugx) FROM customer_payments WHERE organization_id=p_organization_id AND status='successful' AND COALESCE(confirmed_at,created_at)::date>=s.as_of_date),0)
    - COALESCE((SELECT SUM(amount_ugx) FROM organization_expenses WHERE organization_id=p_organization_id AND status='paid' AND COALESCE(paid_at::date,expense_date)>=s.as_of_date),0)
    - COALESCE((SELECT SUM(amount_ugx) FROM supplier_payments WHERE organization_id=p_organization_id AND paid_on>=s.as_of_date),0))::bigint
  FROM settings s;
$$;

CREATE OR REPLACE FUNCTION organization_committed_funds(p_organization_id UUID)
RETURNS BIGINT LANGUAGE sql STABLE AS $$
  SELECT (COALESCE((SELECT SUM(amount_ugx) FROM organization_expenses WHERE organization_id=p_organization_id AND status='approved'),0)
    + COALESCE((SELECT SUM(balance_ugx) FROM supplier_bills WHERE organization_id=p_organization_id AND status IN ('open','partially_paid','overdue')),0)
    + COALESCE((SELECT SUM(po.quantity*po.unit_price_ugx) FROM purchase_orders po WHERE po.organization_id=p_organization_id AND po.status IN ('issued','received') AND NOT EXISTS(SELECT 1 FROM supplier_bills b WHERE b.purchase_order_id=po.id AND b.status<>'void')),0)
    + COALESCE((SELECT SUM(l.basic_pay_ugx+l.allowance_ugx-l.deduction_ugx) FROM payroll_periods p JOIN payroll_lines l ON l.period_id=p.id WHERE p.organization_id=p_organization_id AND p.status='approved'),0))::bigint;
$$;

CREATE OR REPLACE FUNCTION organization_available_to_commit(p_organization_id UUID)
RETURNS BIGINT LANGUAGE sql STABLE AS $$
  SELECT (organization_cash_position(p_organization_id)-organization_committed_funds(p_organization_id))::bigint;
$$;
