CREATE TABLE IF NOT EXISTS payroll_periods (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 name VARCHAR(100) NOT NULL, starts_on DATE NOT NULL, ends_on DATE NOT NULL, pay_date DATE NOT NULL,
 status VARCHAR(24) NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','paid','cancelled')),
 created_by UUID REFERENCES users(id) ON DELETE SET NULL, approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
 approved_at TIMESTAMPTZ, paid_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(organization_id,starts_on,ends_on), CHECK(ends_on>=starts_on)
);
CREATE TABLE IF NOT EXISTS payroll_lines (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), period_id UUID NOT NULL REFERENCES payroll_periods(id) ON DELETE CASCADE,
 organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 basic_pay_ugx BIGINT NOT NULL DEFAULT 0 CHECK(basic_pay_ugx>=0), allowance_ugx BIGINT NOT NULL DEFAULT 0 CHECK(allowance_ugx>=0),
 deduction_ugx BIGINT NOT NULL DEFAULT 0 CHECK(deduction_ugx>=0), notes VARCHAR(500),
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(period_id,user_id)
);
CREATE INDEX IF NOT EXISTS idx_payroll_period_org ON payroll_periods(organization_id,starts_on DESC);
CREATE INDEX IF NOT EXISTS idx_payroll_lines_period ON payroll_lines(period_id);
