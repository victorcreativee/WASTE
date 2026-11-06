-- Recycling: investors, what they put in and took out, and the updates the company writes to them.
--
-- An investor is a person or business with a stake in the company. They may have a sign-in (user_id), and then see their
-- own position on the investor page; the record can exist without one.
--
-- An investment or payout normally moves office cash, through a cash movement it points to. cash_movement_id stays empty
-- for money that is already counted, such as an investment made before the opening balance was set.
--
-- An entry is never edited or deleted. A mistake is cancelled: the row stays, marked reversed and left out of the totals,
-- and any cash it moved goes back through a correction movement dated the day of the cancellation.
--
-- Investors read one summarised report and nothing else: operational data names staff, suppliers and buyers. So the
-- investor role loses its read permissions here, and the investor routes admit it by role.

CREATE TABLE IF NOT EXISTS recycling_investors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID,
  display_name TEXT NOT NULL CHECK (length(trim(display_name)) >= 2),
  share_percent NUMERIC(5,2) CHECK (share_percent IS NULL OR share_percent BETWEEN 0 AND 100),
  notes TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (user_id, organization_id) REFERENCES users(id, organization_id),
  FOREIGN KEY (created_by, organization_id) REFERENCES users(id, organization_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS recycling_investors_user_idx ON recycling_investors(organization_id, user_id) WHERE user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS recycling_investor_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  investor_id UUID NOT NULL REFERENCES recycling_investors(id),
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('investment', 'payout')),
  amount_ugx BIGINT NOT NULL CHECK (amount_ugx > 0),
  transaction_date DATE NOT NULL,
  reference TEXT NOT NULL,
  notes TEXT,
  cash_movement_id UUID REFERENCES recycling_cash_movements(id),
  recorded_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reversed_at TIMESTAMPTZ,
  reversed_by UUID,
  reversal_reason TEXT,
  reversal_cash_movement_id UUID REFERENCES recycling_cash_movements(id),
  UNIQUE (organization_id, reference),
  CHECK ((reversed_at IS NULL) = (reversed_by IS NULL) AND (reversed_at IS NULL) = (reversal_reason IS NULL)),
  FOREIGN KEY (recorded_by, organization_id) REFERENCES users(id, organization_id),
  FOREIGN KEY (reversed_by, organization_id) REFERENCES users(id, organization_id)
);
CREATE INDEX IF NOT EXISTS recycling_investor_transactions_investor_idx ON recycling_investor_transactions(investor_id, transaction_date DESC);

CREATE TABLE IF NOT EXISTS recycling_investor_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(trim(title)) >= 3),
  body TEXT NOT NULL CHECK (length(trim(body)) >= 3),
  posted_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (posted_by, organization_id) REFERENCES users(id, organization_id)
);
CREATE INDEX IF NOT EXISTS recycling_investor_updates_org_idx ON recycling_investor_updates(organization_id, created_at DESC);

DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['recycling_investors', 'recycling_investor_transactions', 'recycling_investor_updates'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS kwms_tenant ON %I', t);
    EXECUTE format('CREATE POLICY kwms_tenant ON %I USING (kwms_tenant_sees(organization_id)) WITH CHECK (kwms_tenant_sees(organization_id))', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_kwms_audit ON %I', t);
    EXECUTE format('CREATE TRIGGER trg_kwms_audit AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION kwms_audit_row()', t);
  END LOOP;
END $$;

DELETE FROM organization_role_permissions permission
USING organization_roles role
WHERE permission.role_id = role.id
  AND role.legacy_role_name = 'company_investor'
  AND permission.permission_code IN ('reports.organization.read', 'finance.read', 'inventory.read', 'recycling.read');
