ALTER TABLE collection_routes
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS cancellation_reason VARCHAR(50),
  ADD COLUMN IF NOT EXISTS cancellation_notes TEXT;

ALTER TABLE collection_route_jobs DROP CONSTRAINT IF EXISTS collection_route_jobs_status_check;
ALTER TABLE collection_route_jobs ADD CONSTRAINT collection_route_jobs_status_check
  CHECK (status IN ('pending','arrived','completed','skipped','cancelled'));

CREATE TABLE IF NOT EXISTS collection_route_status_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  route_id UUID NOT NULL REFERENCES collection_routes(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  previous_status VARCHAR(40) NOT NULL,
  new_status VARCHAR(40) NOT NULL,
  reason VARCHAR(50),
  notes TEXT,
  changed_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_route_status_history_route
  ON collection_route_status_history(route_id, created_at DESC);
