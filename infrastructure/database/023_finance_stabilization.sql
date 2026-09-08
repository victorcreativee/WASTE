-- Phase 0B. Preserves existing balances and business transactions.
-- Without an opening setting, include all modern recorded history rather than only today.
CREATE OR REPLACE FUNCTION organization_cash_position(p_organization_id UUID)
RETURNS BIGINT LANGUAGE sql STABLE AS $$
  WITH settings AS (
    SELECT COALESCE(s.opening_balance_ugx,0)::bigint opening_balance_ugx,
           COALESCE(s.as_of_date,DATE '1970-01-01')::date as_of_date
    FROM (SELECT 1) seed LEFT JOIN organization_finance_settings s ON s.organization_id=p_organization_id
  )
  SELECT (s.opening_balance_ugx
    + COALESCE((SELECT SUM(amount_ugx) FROM customer_payments WHERE organization_id=p_organization_id AND status='successful' AND COALESCE(confirmed_at,created_at)::date>=s.as_of_date),0)
    - COALESCE((SELECT SUM(amount_ugx) FROM organization_expenses WHERE organization_id=p_organization_id AND status='paid' AND COALESCE(paid_at::date,expense_date)>=s.as_of_date),0)
    - COALESCE((SELECT SUM(amount_ugx) FROM supplier_payments WHERE organization_id=p_organization_id AND paid_on>=s.as_of_date),0))::bigint
  FROM settings s;
$$;


CREATE TABLE IF NOT EXISTS organization_finance_setting_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  previous_balance_ugx BIGINT,
  previous_as_of_date DATE,
  opening_balance_ugx BIGINT NOT NULL,
  as_of_date DATE NOT NULL,
  changed_by UUID REFERENCES users(id),
  action VARCHAR(20) NOT NULL DEFAULT 'updated' CHECK(action IN ('baseline','created','updated')),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_finance_setting_history_org
  ON organization_finance_setting_history(organization_id,changed_at);
-- Snapshot pre-existing settings once; do not invent historical changes.
INSERT INTO organization_finance_setting_history
  (organization_id,opening_balance_ugx,as_of_date,changed_by,action)
SELECT s.organization_id,s.opening_balance_ugx,s.as_of_date,s.updated_by,'baseline'
FROM organization_finance_settings s
WHERE NOT EXISTS(SELECT 1 FROM organization_finance_setting_history h WHERE h.organization_id=s.organization_id);
