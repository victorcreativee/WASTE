-- Traceable recycling cash control. Posted money records are immutable; corrections
-- are entered as separate reversing movements so the audit trail remains complete.
ALTER TABLE recycling_manager_float_transactions
  DROP CONSTRAINT IF EXISTS recycling_manager_float_transactions_transaction_type_check;
ALTER TABLE recycling_manager_float_transactions
  ADD CONSTRAINT recycling_manager_float_transactions_transaction_type_check
  CHECK(transaction_type IN('given','spent','returned'));
ALTER TABLE recycling_manager_float_transactions
  ADD COLUMN IF NOT EXISTS reference TEXT,
  ADD COLUMN IF NOT EXISTS sorting_batch_id UUID REFERENCES recycling_sorting_batches(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS recycling_float_reference_unique
  ON recycling_manager_float_transactions(organization_id,reference) WHERE reference IS NOT NULL;

ALTER TABLE recycling_sorting_batches
  ADD COLUMN IF NOT EXISTS worker_wages_ugx BIGINT NOT NULL DEFAULT 0 CHECK(worker_wages_ugx>=0),
  ADD COLUMN IF NOT EXISTS utilities_ugx BIGINT NOT NULL DEFAULT 0 CHECK(utilities_ugx>=0),
  ADD COLUMN IF NOT EXISTS transport_ugx BIGINT NOT NULL DEFAULT 0 CHECK(transport_ugx>=0),
  ADD COLUMN IF NOT EXISTS consumables_ugx BIGINT NOT NULL DEFAULT 0 CHECK(consumables_ugx>=0),
  ADD COLUMN IF NOT EXISTS other_expense_ugx BIGINT NOT NULL DEFAULT 0 CHECK(other_expense_ugx>=0),
  ADD COLUMN IF NOT EXISTS manager_float_used_ugx BIGINT NOT NULL DEFAULT 0 CHECK(manager_float_used_ugx>=0);

CREATE TABLE IF NOT EXISTS recycling_cash_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  movement_date DATE NOT NULL,
  direction TEXT NOT NULL CHECK(direction IN('in','out')),
  category TEXT NOT NULL CHECK(category IN('capital_contribution','other_income','owner_withdrawal','correction')),
  amount_ugx BIGINT NOT NULL CHECK(amount_ugx>0),
  reference TEXT NOT NULL,
  counterparty TEXT,
  notes TEXT NOT NULL,
  recorded_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id,reference),
  FOREIGN KEY(recorded_by,organization_id) REFERENCES users(id,organization_id)
);
CREATE INDEX IF NOT EXISTS recycling_cash_movement_org_date_idx
  ON recycling_cash_movements(organization_id,movement_date DESC,created_at DESC);

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
  -COALESCE((SELECT SUM(worker_wages_ugx+food_ugx+transport_ugx+other_expense_ugx) FROM recycling_material_sales WHERE organization_id=p_organization_id AND sold_on>=s.as_of_date),0))::bigint FROM s;
$$;
