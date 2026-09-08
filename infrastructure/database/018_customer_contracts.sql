CREATE TABLE IF NOT EXISTS customer_contracts (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 customer_id UUID NOT NULL REFERENCES customer_profiles(id) ON DELETE CASCADE, contract_number VARCHAR(50) UNIQUE NOT NULL,
 service_name VARCHAR(160) NOT NULL, starts_on DATE NOT NULL, ends_on DATE NOT NULL, billing_frequency VARCHAR(30) NOT NULL,
 contract_value_ugx BIGINT NOT NULL DEFAULT 0 CHECK(contract_value_ugx>=0), collections_per_period INTEGER NOT NULL DEFAULT 1 CHECK(collections_per_period>0),
 response_hours INTEGER NOT NULL DEFAULT 24 CHECK(response_hours>0), status VARCHAR(24) NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','expiring','expired','suspended','cancelled')),
 notes VARCHAR(1000), created_by UUID REFERENCES users(id) ON DELETE SET NULL, activated_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK(ends_on>=starts_on)
);
CREATE INDEX IF NOT EXISTS idx_contracts_org_status ON customer_contracts(organization_id,status,ends_on);
CREATE INDEX IF NOT EXISTS idx_contracts_customer ON customer_contracts(customer_id);
