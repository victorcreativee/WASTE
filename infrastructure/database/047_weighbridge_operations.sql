CREATE TABLE IF NOT EXISTS weighbridge_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  trip_id UUID REFERENCES collection_routes(id) ON DELETE SET NULL,
  vehicle_id UUID REFERENCES waste_trucks(id) ON DELETE SET NULL,
  driver_id UUID REFERENCES drivers(id) ON DELETE SET NULL,
  ticket_number VARCHAR(100) NOT NULL,
  facility VARCHAR(160) NOT NULL,
  registration VARCHAR(50) NOT NULL,
  driver_name VARCHAR(150),
  route_source VARCHAR(200),
  operation_date DATE NOT NULL,
  arrival_at TIMESTAMPTZ NOT NULL,
  departure_at TIMESTAMPTZ,
  gross_kg NUMERIC(12,2) NOT NULL CHECK (gross_kg > 0),
  tare_kg NUMERIC(12,2),
  net_kg NUMERIC(12,2),
  status VARCHAR(20) NOT NULL CHECK (status IN ('open','completed','voided')),
  void_reason TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id,ticket_number)
);
CREATE INDEX IF NOT EXISTS weighbridge_transactions_org_date ON weighbridge_transactions(organization_id,operation_date DESC,status);
CREATE INDEX IF NOT EXISTS weighbridge_transactions_trip ON weighbridge_transactions(trip_id) WHERE trip_id IS NOT NULL;
