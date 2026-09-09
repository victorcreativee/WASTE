ALTER TABLE collection_routes
  ADD COLUMN IF NOT EXISTS weighbridge_ticket_number VARCHAR(100),
  ADD COLUMN IF NOT EXISTS weighbridge_facility VARCHAR(160),
  ADD COLUMN IF NOT EXISTS verified_weight_kg NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS weight_verified_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS weight_verified_by UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS collection_routes_weighbridge_ticket_unique
  ON collection_routes(organization_id, weighbridge_ticket_number)
  WHERE weighbridge_ticket_number IS NOT NULL;
