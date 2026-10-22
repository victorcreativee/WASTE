-- KCCA-owned response-time standards for resident issues, used by the city command centre.
-- Additive and idempotent: safe to run on an existing database.
CREATE TABLE IF NOT EXISTS kcca_service_standards (
  issue_category VARCHAR(40) PRIMARY KEY
    CHECK (issue_category IN ('illegal_dumping', 'missed_collection', 'overflowing_bin', 'pickup_request')),
  response_hours INTEGER NOT NULL CHECK (response_hours BETWEEN 1 AND 720),
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO kcca_service_standards (issue_category, response_hours) VALUES
  ('missed_collection', 24),
  ('overflowing_bin', 24),
  ('illegal_dumping', 48),
  ('pickup_request', 72)
ON CONFLICT (issue_category) DO NOTHING;

CREATE TABLE IF NOT EXISTS kcca_service_standard_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  issue_category VARCHAR(40) NOT NULL REFERENCES kcca_service_standards(issue_category),
  previous_hours INTEGER NOT NULL,
  new_hours INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK (length(trim(reason)) >= 5),
  changed_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_kcca_service_standard_history_created
  ON kcca_service_standard_history(created_at DESC);

-- The history is evidence for regulatory decisions: it can be added to, never rewritten.
CREATE OR REPLACE FUNCTION prevent_kcca_standard_history_change() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Service standard history cannot be changed or deleted';
END $$;
DROP TRIGGER IF EXISTS trg_kcca_standard_history_immutable ON kcca_service_standard_history;
CREATE TRIGGER trg_kcca_standard_history_immutable
  BEFORE UPDATE OR DELETE ON kcca_service_standard_history
  FOR EACH ROW EXECUTE FUNCTION prevent_kcca_standard_history_change();
