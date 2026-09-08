CREATE TABLE IF NOT EXISTS platform_packages (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 code TEXT UNIQUE NOT NULL,
 name TEXT NOT NULL,
 description TEXT NOT NULL,
 monthly_fee_ugx BIGINT NOT NULL CHECK (monthly_fee_ugx >= 0),
 is_active BOOLEAN NOT NULL DEFAULT true,
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO platform_packages(code,name,description,monthly_fee_ugx) VALUES
 ('core_collector','Core Collector','Licensing connection, customers, schedules, dispatch, routes and compliance.',0),
 ('operations_pro','Operations Pro','Core Collector plus HR, payroll, finance, fleet maintenance, inventory and procurement.',0)
ON CONFLICT(code) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description;

CREATE TABLE IF NOT EXISTS organization_account_applications (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 application_number TEXT UNIQUE NOT NULL,
 permit_application_id UUID UNIQUE NOT NULL REFERENCES organization_permit_applications(id),
 requested_package_id UUID NOT NULL REFERENCES platform_packages(id),
 administrator_name TEXT NOT NULL,
 administrator_email TEXT NOT NULL,
 administrator_phone TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'submitted' CHECK(status IN('submitted','under_review','approved','rejected')),
 review_notes TEXT,
 reviewed_by UUID REFERENCES users(id),
 reviewed_at TIMESTAMPTZ,
 organization_id UUID UNIQUE REFERENCES organizations(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_account_applications_status ON organization_account_applications(status,created_at DESC);

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS platform_package_id UUID REFERENCES platform_packages(id);
