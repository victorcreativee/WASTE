CREATE TABLE IF NOT EXISTS truck_maintenance_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  truck_id UUID NOT NULL REFERENCES waste_trucks(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  category VARCHAR(40) NOT NULL CHECK (category IN ('preventive_service','inspection','repair','tyres','engine','electrical','other')),
  title VARCHAR(160) NOT NULL,
  description TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','in_progress','completed','cancelled')),
  scheduled_date DATE NOT NULL,
  completed_at TIMESTAMPTZ,
  odometer_km INTEGER CHECK (odometer_km IS NULL OR odometer_km >= 0),
  cost_ugx BIGINT NOT NULL DEFAULT 0 CHECK (cost_ugx >= 0),
  service_provider VARCHAR(160),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS truck_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  truck_id UUID NOT NULL REFERENCES waste_trucks(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  document_type VARCHAR(40) NOT NULL CHECK (document_type IN ('registration','insurance','inspection','operating_license','other')),
  document_number VARCHAR(120) NOT NULL,
  issued_on DATE,
  expires_on DATE NOT NULL,
  file_url TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS truck_fuel_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  truck_id UUID NOT NULL REFERENCES waste_trucks(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  litres NUMERIC(10,2) NOT NULL CHECK (litres > 0),
  cost_ugx BIGINT NOT NULL CHECK (cost_ugx >= 0),
  odometer_km INTEGER CHECK (odometer_km IS NULL OR odometer_km >= 0),
  fuel_date DATE NOT NULL DEFAULT CURRENT_DATE,
  station VARCHAR(160),
  recorded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_maintenance_truck_date ON truck_maintenance_records(truck_id, scheduled_date DESC);
CREATE INDEX IF NOT EXISTS idx_maintenance_org_status ON truck_maintenance_records(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_truck_documents_expiry ON truck_documents(organization_id, expires_on);
CREATE INDEX IF NOT EXISTS idx_fuel_truck_date ON truck_fuel_records(truck_id, fuel_date DESC);
