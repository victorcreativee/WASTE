CREATE TABLE IF NOT EXISTS organization_finance_settings (
  organization_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  opening_balance_ugx BIGINT NOT NULL DEFAULT 0 CHECK (opening_balance_ugx >= 0),
  as_of_date DATE NOT NULL DEFAULT CURRENT_DATE,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
