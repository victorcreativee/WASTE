CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS waste_zones (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
    name VARCHAR(150) NOT NULL,
    description TEXT,
    area_type VARCHAR(50) NOT NULL DEFAULT 'residential' CHECK (
        area_type IN (
            'residential',
            'commercial',
            'industrial',
            'market',
            'school',
            'hospital',
            'informal_settlement',
            'mixed'
        )
    ),
    boundary GEOMETRY(POLYGON, 4326),
    center_point GEOGRAPHY(POINT, 4326),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS waste_trucks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
    plate_number VARCHAR(50) UNIQUE NOT NULL,
    truck_name VARCHAR(150),
    capacity_tons NUMERIC(10, 2),
    status VARCHAR(40) NOT NULL DEFAULT 'available' CHECK (
        status IN (
            'available',
            'assigned',
            'maintenance',
            'inactive'
        )
    ),
    current_location GEOGRAPHY(POINT, 4326),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS drivers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    full_name VARCHAR(150) NOT NULL,
    phone VARCHAR(50),
    license_number VARCHAR(100),
    status VARCHAR(40) NOT NULL DEFAULT 'available' CHECK (
        status IN (
            'available',
            'assigned',
            'off_duty',
            'inactive'
        )
    ),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pickup_schedules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
    zone_id UUID REFERENCES waste_zones(id) ON DELETE CASCADE,
    name VARCHAR(150) NOT NULL,
    frequency VARCHAR(40) NOT NULL CHECK (
        frequency IN (
            'daily',
            'weekly',
            'biweekly',
            'monthly',
            'on_demand'
        )
    ),
    preferred_time TIME,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS collection_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
    zone_id UUID REFERENCES waste_zones(id) ON DELETE SET NULL,
    truck_id UUID REFERENCES waste_trucks(id) ON DELETE SET NULL,
    driver_id UUID REFERENCES drivers(id) ON DELETE SET NULL,
    schedule_id UUID REFERENCES pickup_schedules(id) ON DELETE SET NULL,
    job_date DATE NOT NULL,
    status VARCHAR(40) NOT NULL DEFAULT 'pending' CHECK (
        status IN (
            'pending',
            'assigned',
            'in_progress',
            'completed',
            'missed',
            'cancelled'
        )
    ),
    waste_type VARCHAR(50) NOT NULL DEFAULT 'mixed' CHECK (
        waste_type IN (
            'mixed',
            'organic',
            'plastic',
            'metal',
            'paper',
            'glass',
            'hazardous',
            'medical',
            'construction'
        )
    ),
    estimated_weight_kg NUMERIC(12, 2),
    collected_weight_kg NUMERIC(12, 2),
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    notes TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_waste_zones_organization_id ON waste_zones(organization_id);
CREATE INDEX IF NOT EXISTS idx_waste_zones_area_type ON waste_zones(area_type);
CREATE INDEX IF NOT EXISTS idx_waste_zones_boundary ON waste_zones USING GIST(boundary);
CREATE INDEX IF NOT EXISTS idx_waste_zones_center_point ON waste_zones USING GIST(center_point);

CREATE INDEX IF NOT EXISTS idx_waste_trucks_organization_id ON waste_trucks(organization_id);
CREATE INDEX IF NOT EXISTS idx_waste_trucks_status ON waste_trucks(status);
CREATE INDEX IF NOT EXISTS idx_waste_trucks_location ON waste_trucks USING GIST(current_location);

CREATE INDEX IF NOT EXISTS idx_drivers_organization_id ON drivers(organization_id);
CREATE INDEX IF NOT EXISTS idx_drivers_status ON drivers(status);

CREATE INDEX IF NOT EXISTS idx_pickup_schedules_zone_id ON pickup_schedules(zone_id);
CREATE INDEX IF NOT EXISTS idx_pickup_schedules_organization_id ON pickup_schedules(organization_id);

CREATE INDEX IF NOT EXISTS idx_collection_jobs_organization_id ON collection_jobs(organization_id);
CREATE INDEX IF NOT EXISTS idx_collection_jobs_zone_id ON collection_jobs(zone_id);
CREATE INDEX IF NOT EXISTS idx_collection_jobs_truck_id ON collection_jobs(truck_id);
CREATE INDEX IF NOT EXISTS idx_collection_jobs_driver_id ON collection_jobs(driver_id);
CREATE INDEX IF NOT EXISTS idx_collection_jobs_status ON collection_jobs(status);
CREATE INDEX IF NOT EXISTS idx_collection_jobs_job_date ON collection_jobs(job_date);