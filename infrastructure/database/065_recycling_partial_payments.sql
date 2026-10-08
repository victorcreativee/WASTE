ALTER TABLE recycling_material_sales DROP CONSTRAINT IF EXISTS recycling_material_sales_status_check;
ALTER TABLE recycling_material_sales ADD CONSTRAINT recycling_material_sales_status_check CHECK(status IN('recorded','partially_paid','paid'));
ALTER TABLE recycling_material_lots DROP CONSTRAINT IF EXISTS recycling_lots_purchase_payment_status_check;
ALTER TABLE recycling_material_lots ADD CONSTRAINT recycling_lots_purchase_payment_status_check CHECK(purchase_payment_status IN('paid','credit','partially_paid'));

CREATE TABLE IF NOT EXISTS recycling_sale_payments (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 sale_id UUID NOT NULL REFERENCES recycling_material_sales(id) ON DELETE CASCADE,
 amount_ugx BIGINT NOT NULL CHECK(amount_ugx>0), paid_on DATE NOT NULL, reference TEXT NOT NULL,
 recorded_by UUID REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(organization_id,reference)
);
CREATE TABLE IF NOT EXISTS recycling_purchase_payments (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 lot_id UUID NOT NULL REFERENCES recycling_material_lots(id) ON DELETE CASCADE,
 amount_ugx BIGINT NOT NULL CHECK(amount_ugx>0), paid_on DATE NOT NULL, reference TEXT NOT NULL,
 recorded_by UUID REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(organization_id,reference)
);
CREATE INDEX IF NOT EXISTS recycling_sale_payments_sale_idx ON recycling_sale_payments(organization_id,sale_id,paid_on);
CREATE INDEX IF NOT EXISTS recycling_purchase_payments_lot_idx ON recycling_purchase_payments(organization_id,lot_id,paid_on);

INSERT INTO recycling_sale_payments(organization_id,sale_id,amount_ugx,paid_on,reference,recorded_by)
 SELECT organization_id,id,ROUND(quantity_kg*unit_price_ugx)::bigint,COALESCE(paid_on,sold_on),COALESCE(payment_reference,'LEGACY-SALE-'||id),recorded_by
 FROM recycling_material_sales WHERE status='paid'
 ON CONFLICT(organization_id,reference) DO NOTHING;
INSERT INTO recycling_purchase_payments(organization_id,lot_id,amount_ugx,paid_on,reference,recorded_by)
 SELECT organization_id,id,ROUND(quantity_kg*unit_purchase_price_ugx+worker_wages_ugx+food_ugx+transport_ugx+driver_fee_ugx+other_expense_ugx)::bigint,COALESCE(purchase_paid_on,collected_on),COALESCE(purchase_payment_reference,'LEGACY-PURCHASE-'||id),created_by
 FROM recycling_material_lots WHERE origin='purchase' AND purchase_payment_status='paid'
 ON CONFLICT(organization_id,reference) DO NOTHING;

CREATE OR REPLACE FUNCTION organization_cash_position(p_organization_id UUID)
RETURNS BIGINT LANGUAGE sql STABLE AS $$
 WITH s AS (SELECT COALESCE(opening_balance_ugx,0)::bigint opening_balance_ugx,COALESCE(as_of_date,DATE '1970-01-01') as_of_date FROM (SELECT 1)seed LEFT JOIN organization_finance_settings ON organization_id=p_organization_id)
 SELECT (s.opening_balance_ugx
  +COALESCE((SELECT SUM(amount_ugx) FROM customer_payments WHERE organization_id=p_organization_id AND status='successful' AND COALESCE(confirmed_at,created_at)::date>=s.as_of_date),0)
  +COALESCE((SELECT SUM(amount_ugx) FROM recycling_sale_payments WHERE organization_id=p_organization_id AND paid_on>=s.as_of_date),0)
  -COALESCE((SELECT SUM(amount_ugx) FROM organization_expenses WHERE organization_id=p_organization_id AND status='paid' AND COALESCE(paid_at::date,expense_date)>=s.as_of_date),0)
  -COALESCE((SELECT SUM(amount_ugx) FROM supplier_payments WHERE organization_id=p_organization_id AND paid_on>=s.as_of_date),0)
  -COALESCE((SELECT SUM(GREATEST(p.paid-l.manager_float_used_ugx,0)) FROM recycling_material_lots l JOIN(SELECT lot_id,SUM(amount_ugx) paid FROM recycling_purchase_payments WHERE organization_id=p_organization_id AND paid_on>=s.as_of_date GROUP BY lot_id)p ON p.lot_id=l.id),0)
  -COALESCE((SELECT SUM(amount_ugx) FROM recycling_manager_float_transactions WHERE organization_id=p_organization_id AND transaction_type='spent' AND transaction_date>=s.as_of_date),0)
  -COALESCE((SELECT SUM(processing_cost_ugx) FROM recycling_sorting_batches WHERE organization_id=p_organization_id AND processed_on>=s.as_of_date),0)
  -COALESCE((SELECT SUM(worker_wages_ugx+food_ugx+transport_ugx+other_expense_ugx) FROM recycling_material_sales WHERE organization_id=p_organization_id AND sold_on>=s.as_of_date),0))::bigint FROM s;
$$;
CREATE OR REPLACE FUNCTION organization_committed_funds(p_organization_id UUID)
RETURNS BIGINT LANGUAGE sql STABLE AS $$
 SELECT (COALESCE((SELECT SUM(amount_ugx) FROM organization_expenses WHERE organization_id=p_organization_id AND status='approved'),0)
  +COALESCE((SELECT SUM(balance_ugx) FROM supplier_bills WHERE organization_id=p_organization_id AND status IN('open','partially_paid','overdue')),0)
  +COALESCE((SELECT SUM(po.quantity*po.unit_price_ugx) FROM purchase_orders po WHERE po.organization_id=p_organization_id AND po.status IN('issued','received') AND NOT EXISTS(SELECT 1 FROM supplier_bills b WHERE b.purchase_order_id=po.id AND b.status<>'void')),0)
  +COALESCE((SELECT SUM(l.basic_pay_ugx+l.allowance_ugx-l.deduction_ugx) FROM payroll_periods p JOIN payroll_lines l ON l.period_id=p.id WHERE p.organization_id=p_organization_id AND p.status='approved'),0)
  +COALESCE((SELECT SUM(ROUND(l.quantity_kg*l.unit_purchase_price_ugx+l.worker_wages_ugx+l.food_ugx+l.transport_ugx+l.driver_fee_ugx+l.other_expense_ugx)-COALESCE(p.paid,0)) FROM recycling_material_lots l LEFT JOIN(SELECT lot_id,SUM(amount_ugx) paid FROM recycling_purchase_payments GROUP BY lot_id)p ON p.lot_id=l.id WHERE l.organization_id=p_organization_id AND l.origin='purchase' AND l.purchase_payment_status IN('credit','partially_paid')),0))::bigint;
$$;
CREATE OR REPLACE FUNCTION organization_available_to_commit(p_organization_id UUID) RETURNS BIGINT LANGUAGE sql STABLE AS $$ SELECT organization_cash_position(p_organization_id)-organization_committed_funds(p_organization_id) $$;
