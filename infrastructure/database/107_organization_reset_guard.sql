CREATE TABLE IF NOT EXISTS organization_data_resets (
  organization_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  reset_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reset_by UUID NOT NULL REFERENCES users(id),
  mode VARCHAR(32) NOT NULL CHECK (mode IN ('data_only', 'data_and_credentials')),
  reason VARCHAR(500) NOT NULL
);

CREATE INDEX IF NOT EXISTS organization_data_resets_reset_at_idx
  ON organization_data_resets(reset_at);
