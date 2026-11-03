ALTER TABLE organization_expenses
  DROP CONSTRAINT IF EXISTS organization_expenses_category_check;

ALTER TABLE organization_expenses
  ADD CONSTRAINT organization_expenses_category_check CHECK (category IN (
    'fuel','maintenance','payroll','equipment','utilities','disposal_fees','office','other',
    'food','transport','worker_credit','daily_wages'
  ));

CREATE INDEX IF NOT EXISTS organization_expenses_org_category_date_idx
  ON organization_expenses(organization_id,category,expense_date DESC);
