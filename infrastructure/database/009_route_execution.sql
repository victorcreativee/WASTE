ALTER TABLE collection_routes
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP;

ALTER TABLE collection_route_jobs
  ADD COLUMN IF NOT EXISTS status VARCHAR(30) NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS arrived_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS collected_weight_kg NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS completion_notes TEXT,
  ADD COLUMN IF NOT EXISTS evidence_url TEXT;

DO $$ BEGIN
  ALTER TABLE collection_route_jobs ADD CONSTRAINT collection_route_jobs_status_check
    CHECK (status IN ('pending', 'arrived', 'completed', 'skipped'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_route_jobs_execution ON collection_route_jobs(route_id, stop_order, status);
