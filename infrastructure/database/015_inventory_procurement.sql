CREATE TABLE IF NOT EXISTS inventory_items (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 sku VARCHAR(60) NOT NULL, name VARCHAR(160) NOT NULL, category VARCHAR(40) NOT NULL CHECK(category IN ('bins','ppe','vehicle_parts','tools','cleaning_supplies','office','other')),
 unit VARCHAR(30) NOT NULL DEFAULT 'units', quantity NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK(quantity>=0), reorder_level NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK(reorder_level>=0),
 unit_cost_ugx BIGINT NOT NULL DEFAULT 0 CHECK(unit_cost_ugx>=0), storage_location VARCHAR(160), is_active BOOLEAN NOT NULL DEFAULT true,
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(organization_id,sku)
);
CREATE TABLE IF NOT EXISTS inventory_movements (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE, movement_type VARCHAR(20) NOT NULL CHECK(movement_type IN ('receipt','issue','adjustment')),
 quantity NUMERIC(12,2) NOT NULL CHECK(quantity<>0), reason VARCHAR(240) NOT NULL, reference VARCHAR(120), recorded_by UUID REFERENCES users(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS purchase_requests (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 request_number VARCHAR(40) UNIQUE NOT NULL, item_name VARCHAR(160) NOT NULL, category VARCHAR(40) NOT NULL,
 quantity NUMERIC(12,2) NOT NULL CHECK(quantity>0), unit VARCHAR(30) NOT NULL DEFAULT 'units', estimated_cost_ugx BIGINT NOT NULL DEFAULT 0 CHECK(estimated_cost_ugx>=0),
 justification VARCHAR(500) NOT NULL, status VARCHAR(24) NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','approved','ordered','received','rejected','cancelled')),
 requested_by UUID REFERENCES users(id) ON DELETE SET NULL, approved_by UUID REFERENCES users(id) ON DELETE SET NULL, approved_at TIMESTAMPTZ, received_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_inventory_org_category ON inventory_items(organization_id,category);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_item ON inventory_movements(item_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_purchase_requests_org_status ON purchase_requests(organization_id,status);
