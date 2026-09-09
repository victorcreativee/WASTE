ALTER TABLE collection_routes ADD COLUMN IF NOT EXISTS service_route_id UUID REFERENCES service_routes(id) ON DELETE SET NULL;
ALTER TABLE collection_routes ADD COLUMN IF NOT EXISTS supervisor_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE collection_routes ADD COLUMN IF NOT EXISTS trip_number VARCHAR(40);
ALTER TABLE collection_routes ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS collection_trip_number_unique ON collection_routes(trip_number) WHERE trip_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS collection_routes_service_route ON collection_routes(service_route_id,route_date,status);

