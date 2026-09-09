-- KCCA authorizes divisions. Licensed organizations configure zones and reusable
-- service routes only inside those divisions.
ALTER TABLE waste_zones
  ADD COLUMN IF NOT EXISTS division_id UUID REFERENCES kampala_divisions(id);

CREATE TABLE IF NOT EXISTS service_routes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  division_id UUID NOT NULL REFERENCES kampala_divisions(id),
  zone_id UUID NOT NULL REFERENCES waste_zones(id) ON DELETE CASCADE,
  name VARCHAR(150) NOT NULL,
  code VARCHAR(50),
  default_truck_id UUID REFERENCES waste_trucks(id) ON DELETE SET NULL,
  default_driver_id UUID REFERENCES drivers(id) ON DELETE SET NULL,
  default_supervisor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  estimated_duration_minutes INTEGER CHECK (estimated_duration_minutes IS NULL OR estimated_duration_minutes > 0),
  estimated_distance_km NUMERIC(10,2) CHECK (estimated_distance_km IS NULL OR estimated_distance_km >= 0),
  route_geometry GEOMETRY(LINESTRING,4326),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS service_route_name_per_zone
  ON service_routes(organization_id,zone_id,LOWER(name));
CREATE UNIQUE INDEX IF NOT EXISTS service_route_code_per_organization
  ON service_routes(organization_id,LOWER(code)) WHERE code IS NOT NULL;
CREATE INDEX IF NOT EXISTS service_routes_area
  ON service_routes(organization_id,division_id,zone_id,is_active);
CREATE INDEX IF NOT EXISTS service_routes_geometry
  ON service_routes USING GIST(route_geometry);

CREATE TABLE IF NOT EXISTS service_route_customers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  service_route_id UUID NOT NULL REFERENCES service_routes(id) ON DELETE CASCADE,
  service_location_id UUID NOT NULL REFERENCES customer_service_locations(id) ON DELETE CASCADE,
  stop_order INTEGER NOT NULL CHECK (stop_order > 0),
  is_active BOOLEAN NOT NULL DEFAULT true,
  assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(service_route_id,service_location_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS one_active_service_route_per_location
  ON service_route_customers(organization_id,service_location_id)
  WHERE is_active;
CREATE INDEX IF NOT EXISTS service_route_customer_order
  ON service_route_customers(service_route_id,is_active,stop_order);

CREATE OR REPLACE FUNCTION enforce_service_route_scope() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE zone_record RECORD;
BEGIN
  SELECT organization_id,division_id,is_active INTO zone_record
  FROM waste_zones WHERE id=NEW.zone_id;
  IF zone_record IS NULL OR zone_record.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Choose an active service zone';
  END IF;
  IF zone_record.organization_id IS DISTINCT FROM NEW.organization_id THEN
    RAISE EXCEPTION 'The service zone must belong to your organization';
  END IF;
  IF zone_record.division_id IS DISTINCT FROM NEW.division_id THEN
    RAISE EXCEPTION 'The route division must match the service zone division';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM organization_division_authorizations authz
    WHERE authz.organization_id=NEW.organization_id
      AND authz.division_id=NEW.division_id
      AND authz.status='active'
      AND (authz.expires_on IS NULL OR authz.expires_on>=CURRENT_DATE)
  ) THEN
    RAISE EXCEPTION 'KCCA has not authorized your organization for this division';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_service_route_scope ON service_routes;
CREATE TRIGGER trg_service_route_scope
  BEFORE INSERT OR UPDATE OF organization_id,division_id,zone_id ON service_routes
  FOR EACH ROW EXECUTE FUNCTION enforce_service_route_scope();

CREATE OR REPLACE FUNCTION enforce_service_route_customer_scope() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM service_routes route
    JOIN customer_service_locations location ON location.id=NEW.service_location_id
    JOIN customer_service_relationships relationship
      ON relationship.service_location_id=location.id
      AND relationship.organization_id=route.organization_id
      AND relationship.status='active'
    WHERE route.id=NEW.service_route_id
      AND route.organization_id=NEW.organization_id
      AND route.zone_id=location.zone_id
      AND route.is_active
  ) THEN
    RAISE EXCEPTION 'Customer location must be active and belong to the selected route zone';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_service_route_customer_scope ON service_route_customers;
CREATE TRIGGER trg_service_route_customer_scope
  BEFORE INSERT OR UPDATE OF organization_id,service_route_id,service_location_id ON service_route_customers
  FOR EACH ROW EXECUTE FUNCTION enforce_service_route_customer_scope();
