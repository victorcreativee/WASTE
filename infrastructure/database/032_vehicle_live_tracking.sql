CREATE TABLE IF NOT EXISTS vehicle_location_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  truck_id UUID NOT NULL REFERENCES waste_trucks(id) ON DELETE CASCADE,
  driver_id UUID REFERENCES drivers(id) ON DELETE SET NULL,
  route_id UUID REFERENCES collection_routes(id) ON DELETE SET NULL,
  location GEOGRAPHY(POINT,4326) NOT NULL,
  accuracy_m NUMERIC(10,2),
  speed_kph NUMERIC(10,2),
  heading_degrees NUMERIC(6,2),
  source VARCHAR(30) NOT NULL DEFAULT 'driver_mobile',
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_vehicle_location_latest ON vehicle_location_events(truck_id,recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_vehicle_location_org ON vehicle_location_events(organization_id,recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_vehicle_location_geo ON vehicle_location_events USING GIST(location);
