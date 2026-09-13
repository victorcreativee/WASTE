CREATE TABLE IF NOT EXISTS collector_compliance_cases (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 case_number TEXT UNIQUE NOT NULL,
 organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 category TEXT NOT NULL CHECK(category IN ('permit','service_delivery','weighbridge','customer_service','fleet_safety','other')),
 severity TEXT NOT NULL CHECK(severity IN ('advisory','warning','critical')),
 title TEXT NOT NULL,
 details TEXT NOT NULL,
 required_action TEXT NOT NULL,
 due_date DATE NOT NULL,
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','acknowledged','remediation_submitted','closed')),
 company_response TEXT,
 responded_at TIMESTAMPTZ,
 resolution_notes TEXT,
 closed_at TIMESTAMPTZ,
 created_by UUID NOT NULL REFERENCES users(id),
 updated_by UUID REFERENCES users(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_collector_compliance_org_status ON collector_compliance_cases(organization_id,status,due_date);

CREATE TABLE IF NOT EXISTS collector_compliance_history (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 case_id UUID NOT NULL REFERENCES collector_compliance_cases(id) ON DELETE CASCADE,
 previous_status TEXT,
 new_status TEXT NOT NULL,
 note TEXT,
 changed_by UUID NOT NULL REFERENCES users(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_collector_compliance_history_case ON collector_compliance_history(case_id,created_at);
