CREATE TABLE IF NOT EXISTS fleet_alert_reviews (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  truck_id UUID NOT NULL REFERENCES waste_trucks(id) ON DELETE CASCADE,
  route_id UUID REFERENCES collection_routes(id) ON DELETE SET NULL,
  alert_code VARCHAR(40) NOT NULL CHECK (alert_code IN ('signal_missing','off_route','stopped_too_long')),
  action VARCHAR(20) NOT NULL CHECK (action IN ('acknowledged','resolved','escalated')),
  outcome VARCHAR(40) CHECK (outcome IN ('driver_contacted','vehicle_redirected','assistance_dispatched','false_alarm','work_resumed','other')),
  notes TEXT,
  signal_recorded_at TIMESTAMPTZ,
  reviewed_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_fleet_alert_reviews_truck ON fleet_alert_reviews(truck_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fleet_alert_reviews_org ON fleet_alert_reviews(organization_id,created_at DESC);
