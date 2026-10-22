-- Module 3: company regulatory portal — monthly statutory returns to KCCA.
-- Additive and idempotent. Requires 093.

CREATE TABLE IF NOT EXISTS regulatory_returns(
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 return_number TEXT UNIQUE NOT NULL,
 organization_id UUID NOT NULL REFERENCES organizations(id),
 organization_type TEXT NOT NULL CHECK(organization_type IN('waste_collection_company','recycling_company')),
 period_month DATE NOT NULL CHECK(EXTRACT(DAY FROM period_month)=1),
 due_on DATE NOT NULL,
 status TEXT NOT NULL DEFAULT 'submitted' CHECK(status IN('submitted','queried','accepted')),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
 -- What the company declares, what the platform had recorded at the time, and where they differ.
 figures JSONB NOT NULL,
 platform_figures JSONB NOT NULL DEFAULT '{}'::jsonb,
 variances JSONB NOT NULL DEFAULT '[]'::jsonb,
 declarant_name TEXT NOT NULL,
 declarant_title TEXT NOT NULL,
 submitted_by UUID NOT NULL REFERENCES users(id),
 submitted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 first_submitted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 submitted_late BOOLEAN NOT NULL DEFAULT false,
 review_notes TEXT,
 reviewed_by UUID REFERENCES users(id),
 reviewed_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(organization_id,period_month),
 CHECK(due_on>period_month)
);
CREATE INDEX IF NOT EXISTS idx_regulatory_returns_period ON regulatory_returns(period_month,status);

-- Every submission, resubmission and KCCA decision, with the figures as they stood. Cannot be changed.
CREATE TABLE IF NOT EXISTS regulatory_return_history(
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 return_id UUID NOT NULL REFERENCES regulatory_returns(id) ON DELETE CASCADE,
 version INTEGER NOT NULL,
 action TEXT NOT NULL CHECK(action IN('submitted','resubmitted','queried','accepted')),
 figures JSONB,
 notes TEXT,
 actor_id UUID REFERENCES users(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_regulatory_return_history ON regulatory_return_history(return_id,created_at);

CREATE OR REPLACE FUNCTION prevent_return_history_change() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Return history cannot be changed or deleted' USING ERRCODE='P0001'; END $$;
DROP TRIGGER IF EXISTS trg_return_history_immutable ON regulatory_return_history;
CREATE TRIGGER trg_return_history_immutable BEFORE UPDATE OR DELETE ON regulatory_return_history
FOR EACH ROW WHEN (pg_trigger_depth()=0) EXECUTE FUNCTION prevent_return_history_change();

-- An accepted return is final: its figures and decision cannot be rewritten.
CREATE OR REPLACE FUNCTION protect_accepted_return() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status='accepted' THEN RAISE EXCEPTION 'An accepted return cannot be changed' USING ERRCODE='P0001'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_protect_accepted_return ON regulatory_returns;
CREATE TRIGGER trg_protect_accepted_return BEFORE UPDATE ON regulatory_returns FOR EACH ROW EXECUTE FUNCTION protect_accepted_return();

-- KCCA can raise compliance cases about missing or inaccurate returns.
ALTER TABLE collector_compliance_cases DROP CONSTRAINT IF EXISTS collector_compliance_cases_category_check;
ALTER TABLE collector_compliance_cases ADD CONSTRAINT collector_compliance_cases_category_check
  CHECK(category IN('permit','service_delivery','weighbridge','customer_service','fleet_safety','recycling_operations','statutory_returns','other'));
