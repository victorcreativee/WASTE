CREATE TABLE IF NOT EXISTS customer_provider_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id UUID NOT NULL REFERENCES customer_profiles(id) ON DELETE CASCADE,
  service_location_id UUID NOT NULL REFERENCES customer_service_locations(id) ON DELETE CASCADE,
  current_relationship_id UUID REFERENCES customer_service_relationships(id),
  requested_organization_id UUID NOT NULL REFERENCES organizations(id),
  status VARCHAR(30) NOT NULL CHECK (status IN (
    'pending_current_provider','pending_new_provider','approved','rejected','cancelled'
  )),
  customer_note TEXT,
  review_note TEXT,
  requested_by UUID NOT NULL REFERENCES users(id),
  current_provider_reviewed_by UUID REFERENCES users(id),
  current_provider_reviewed_at TIMESTAMPTZ,
  final_reviewed_by UUID REFERENCES users(id),
  final_reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS one_open_provider_request_per_location
  ON customer_provider_requests(service_location_id)
  WHERE status IN ('pending_current_provider','pending_new_provider');
CREATE INDEX IF NOT EXISTS provider_requests_target_queue
  ON customer_provider_requests(requested_organization_id,status,created_at);
CREATE INDEX IF NOT EXISTS provider_requests_customer_history
  ON customer_provider_requests(customer_id,created_at DESC);
