ALTER TABLE customer_collection_stops
  ADD COLUMN IF NOT EXISTS exception_reason VARCHAR(40),
  ADD COLUMN IF NOT EXISTS exception_notes TEXT,
  ADD COLUMN IF NOT EXISTS exception_review_status VARCHAR(20),
  ADD COLUMN IF NOT EXISTS exception_reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS exception_reviewed_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS rescheduled_to_stop_id UUID REFERENCES customer_collection_stops(id);

DO $$ BEGIN
  ALTER TABLE customer_collection_stops ADD CONSTRAINT customer_stop_exception_reason_check
    CHECK (exception_reason IS NULL OR exception_reason IN ('blocked_access','customer_unavailable','waste_not_ready','unsafe_conditions','vehicle_access','other'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE customer_collection_stops ADD CONSTRAINT customer_stop_exception_review_check
    CHECK (exception_review_status IS NULL OR exception_review_status IN ('pending','resolved','rescheduled'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS customer_stops_exception_queue
  ON customer_collection_stops(organization_id, exception_review_status, scheduled_date DESC)
  WHERE status = 'skipped';
