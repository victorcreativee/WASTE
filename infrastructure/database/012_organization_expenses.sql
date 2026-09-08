CREATE TABLE IF NOT EXISTS organization_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  expense_number VARCHAR(40) UNIQUE NOT NULL,
  category VARCHAR(40) NOT NULL CHECK (category IN ('fuel','maintenance','payroll','equipment','utilities','disposal_fees','office','other')),
  description VARCHAR(240) NOT NULL,
  vendor VARCHAR(160),
  amount_ugx BIGINT NOT NULL CHECK (amount_ugx > 0),
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status VARCHAR(30) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','paid','void')),
  reference VARCHAR(120),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_org_expenses_date ON organization_expenses(organization_id, expense_date DESC);
CREATE INDEX IF NOT EXISTS idx_org_expenses_status ON organization_expenses(organization_id, status);
