CREATE TABLE IF NOT EXISTS desktop_sync_requests (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  idempotency_key UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  method VARCHAR(10) NOT NULL,
  endpoint TEXT NOT NULL,
  request_hash CHAR(64) NOT NULL,
  state VARCHAR(20) NOT NULL DEFAULT 'processing' CHECK (state IN ('processing', 'completed')),
  response_status INTEGER,
  response_body JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMPTZ,
  PRIMARY KEY (organization_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_desktop_sync_requests_created_at
  ON desktop_sync_requests(created_at);

