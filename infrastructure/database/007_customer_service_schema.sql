CREATE TABLE IF NOT EXISTS customer_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    customer_type VARCHAR(30) NOT NULL CHECK (
        customer_type IN ('residential', 'commercial', 'office_business', 'industrial')
    ),
    service_status VARCHAR(30) NOT NULL DEFAULT 'pending' CHECK (
        service_status IN ('pending', 'active', 'suspended', 'inactive')
    ),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS customer_service_locations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL REFERENCES customer_profiles(id) ON DELETE CASCADE,
    zone_id UUID REFERENCES waste_zones(id) ON DELETE SET NULL,
    organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
    label VARCHAR(100) NOT NULL DEFAULT 'Primary location',
    address TEXT NOT NULL,
    location GEOGRAPHY(POINT, 4326) NOT NULL,
    is_primary BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_primary_location
    ON customer_service_locations(customer_id) WHERE is_primary = true;
CREATE INDEX IF NOT EXISTS idx_customer_locations_zone ON customer_service_locations(zone_id);
CREATE INDEX IF NOT EXISTS idx_customer_locations_org ON customer_service_locations(organization_id);
CREATE INDEX IF NOT EXISTS idx_customer_locations_geo ON customer_service_locations USING GIST(location);
