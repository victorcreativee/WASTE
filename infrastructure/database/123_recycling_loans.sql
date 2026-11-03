-- Recycling: money borrowed into office cash and paid back from it.
--
-- A loan is recorded once, with its lender, and brings its amount into office cash as a cash movement
-- (category loan_received). Each repayment is a cash movement out (category loan_repayment) against that loan,
-- usually from sale income. Neither is income or an expense, so profit is not affected; the loan is what the
-- business owes until it is repaid.

CREATE TABLE IF NOT EXISTS recycling_loans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lender_name TEXT NOT NULL CHECK (length(trim(lender_name)) >= 2),
  amount_ugx BIGINT NOT NULL CHECK (amount_ugx > 0),
  received_on DATE NOT NULL,
  due_on DATE CHECK (due_on IS NULL OR due_on >= received_on),
  reference TEXT NOT NULL,
  notes TEXT,
  recorded_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, reference),
  FOREIGN KEY (recorded_by, organization_id) REFERENCES users(id, organization_id)
);
CREATE INDEX IF NOT EXISTS recycling_loans_org_idx ON recycling_loans(organization_id, received_on DESC);

ALTER TABLE recycling_cash_movements ADD COLUMN IF NOT EXISTS loan_id UUID REFERENCES recycling_loans(id);
CREATE INDEX IF NOT EXISTS recycling_cash_movements_loan_idx ON recycling_cash_movements(loan_id) WHERE loan_id IS NOT NULL;
ALTER TABLE recycling_cash_movements DROP CONSTRAINT IF EXISTS recycling_cash_movements_category_check;
ALTER TABLE recycling_cash_movements ADD CONSTRAINT recycling_cash_movements_category_check
  CHECK (category IN ('capital_contribution', 'other_income', 'owner_withdrawal', 'correction', 'loan_received', 'loan_repayment'));
-- Loan movements always belong to a loan and go the right way; other movements never belong to one.
ALTER TABLE recycling_cash_movements DROP CONSTRAINT IF EXISTS recycling_cash_movements_loan_check;
ALTER TABLE recycling_cash_movements ADD CONSTRAINT recycling_cash_movements_loan_check CHECK (
  CASE category
    WHEN 'loan_received' THEN loan_id IS NOT NULL AND direction = 'in'
    WHEN 'loan_repayment' THEN loan_id IS NOT NULL AND direction = 'out'
    ELSE loan_id IS NULL
  END);

ALTER TABLE recycling_loans ENABLE ROW LEVEL SECURITY;
ALTER TABLE recycling_loans FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kwms_tenant ON recycling_loans;
CREATE POLICY kwms_tenant ON recycling_loans
  USING (kwms_tenant_sees(organization_id)) WITH CHECK (kwms_tenant_sees(organization_id));
DROP TRIGGER IF EXISTS trg_kwms_audit ON recycling_loans;
CREATE TRIGGER trg_kwms_audit AFTER INSERT OR UPDATE OR DELETE ON recycling_loans FOR EACH ROW EXECUTE FUNCTION kwms_audit_row();
