CREATE TABLE IF NOT EXISTS suppliers (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 name VARCHAR(180) NOT NULL, contact_person VARCHAR(160), phone VARCHAR(50), email VARCHAR(180), address TEXT,
 tax_number VARCHAR(80), payment_terms VARCHAR(120), status VARCHAR(24) NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive','suspended')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(organization_id,name)
);
CREATE TABLE IF NOT EXISTS purchase_orders (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 order_number VARCHAR(40) UNIQUE NOT NULL, purchase_request_id UUID REFERENCES purchase_requests(id) ON DELETE SET NULL,
 supplier_id UUID NOT NULL REFERENCES suppliers(id), item_name VARCHAR(160) NOT NULL, quantity NUMERIC(12,2) NOT NULL CHECK(quantity>0),
 unit VARCHAR(30) NOT NULL, unit_price_ugx BIGINT NOT NULL CHECK(unit_price_ugx>=0), expected_on DATE,
 status VARCHAR(24) NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','issued','received','cancelled')),
 notes VARCHAR(500), created_by UUID REFERENCES users(id) ON DELETE SET NULL, issued_at TIMESTAMPTZ, received_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_suppliers_org ON suppliers(organization_id,status);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_org ON purchase_orders(organization_id,status,expected_on);
