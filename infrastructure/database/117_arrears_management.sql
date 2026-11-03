-- KWMS module 4, arrears management: how much each household owes past its due date and for how long, the collection
-- team's follow-ups (calls, visits, promises to pay), payment plans for large arrears, and an "overdue bill" household
-- reminder. Collection companies only; nothing in recycling changes. Additive and idempotent. Requires 108, 113.

-- 1. Overdue reminder ----------------------------------------------------------------------------------------
ALTER TABLE household_sms_settings ADD COLUMN IF NOT EXISTS bill_overdue BOOLEAN NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION notify_household(p_customer_id UUID, p_organization_id UUID, p_kind TEXT, p_title TEXT, p_body TEXT, p_dedupe_key TEXT)
RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE household RECORD; company_wants BOOLEAN; new_id UUID;
BEGIN
  SELECT u.id AS user_id, u.phone, u.status, cp.sms_reminders INTO household
    FROM customer_profiles cp JOIN users u ON u.id = cp.user_id WHERE cp.id = p_customer_id;
  IF NOT FOUND OR household.status <> 'active' THEN RETURN NULL; END IF;
  INSERT INTO notifications(recipient_user_id, organization_id, category, severity, title, body, link, dedupe_key)
  VALUES (household.user_id, p_organization_id, 'household', 'info', left(p_title, 200), left(p_body, 2000), '/my', p_dedupe_key)
  ON CONFLICT (recipient_user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
  RETURNING id INTO new_id;
  IF new_id IS NULL THEN RETURN NULL; END IF;
  SELECT CASE p_kind
           WHEN 'collection_tomorrow' THEN s.collection_tomorrow WHEN 'bill_issued' THEN s.bill_issued
           WHEN 'bill_due' THEN s.bill_due WHEN 'payment_received' THEN s.payment_received
           WHEN 'missed_collection' THEN s.missed_collection WHEN 'request_resolved' THEN s.request_resolved
           WHEN 'bill_overdue' THEN s.bill_overdue END
    INTO company_wants FROM household_sms_settings s WHERE s.organization_id = p_organization_id;
  IF COALESCE(company_wants, false) AND household.sms_reminders AND COALESCE(household.phone, '') <> '' THEN
    INSERT INTO notification_deliveries(notification_id, channel, destination) VALUES (new_id, 'sms', household.phone);
  END IF;
  RETURN new_id;
END $$;

-- 2. Follow-ups ----------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS arrears_follow_ups(
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 organization_id UUID NOT NULL REFERENCES organizations(id),
 customer_id UUID NOT NULL REFERENCES customer_profiles(id) ON DELETE CASCADE,
 channel TEXT NOT NULL CHECK(channel IN('call','visit','sms','letter','other')),
 outcome TEXT NOT NULL CHECK(outcome IN('promise_to_pay','paid_elsewhere','disputed','no_answer','refused','moved_away','other')),
 note TEXT CHECK(note IS NULL OR length(note)<=1000),
 promised_amount_ugx BIGINT CHECK(promised_amount_ugx IS NULL OR promised_amount_ugx>0),
 promised_on DATE,
 balance_at_follow_up_ugx BIGINT NOT NULL DEFAULT 0,
 created_by UUID REFERENCES users(id),
 created_by_name TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK((outcome='promise_to_pay')=(promised_amount_ugx IS NOT NULL AND promised_on IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_arrears_follow_ups_customer ON arrears_follow_ups(organization_id,customer_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_arrears_follow_ups_promises ON arrears_follow_ups(organization_id,promised_on) WHERE outcome='promise_to_pay';

-- 3. Payment plans --------------------------------------------------------------------------------------------
-- An agreed schedule for clearing a household's arrears. Progress is measured from the confirmed payments the household
-- makes after the plan starts; a plan is kept, never edited: to change it, cancel it and agree a new one.
CREATE TABLE IF NOT EXISTS arrears_payment_plans(
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 organization_id UUID NOT NULL REFERENCES organizations(id),
 customer_id UUID NOT NULL REFERENCES customer_profiles(id) ON DELETE CASCADE,
 total_ugx BIGINT NOT NULL CHECK(total_ugx>0),
 instalments INT NOT NULL CHECK(instalments BETWEEN 2 AND 24),
 frequency TEXT NOT NULL CHECK(frequency IN('weekly','monthly')),
 first_due_on DATE NOT NULL,
 note TEXT CHECK(note IS NULL OR length(note)<=1000),
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN('active','cancelled')),
 created_by UUID REFERENCES users(id),
 created_by_name TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 cancelled_by UUID REFERENCES users(id),
 cancelled_by_name TEXT,
 cancelled_at TIMESTAMPTZ,
 cancel_reason TEXT,
 CHECK((status='cancelled')=(cancelled_at IS NOT NULL AND length(cancel_reason)>=5))
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_plan_per_household ON arrears_payment_plans(organization_id,customer_id) WHERE status='active';

-- Instalment n (1-based) of a plan falls due on this day; the last instalment takes the rounding remainder.
CREATE OR REPLACE FUNCTION arrears_plan_due_on(p arrears_payment_plans, n INT) RETURNS DATE LANGUAGE sql IMMUTABLE AS $$
  SELECT (p.first_due_on + CASE p.frequency WHEN 'weekly' THEN make_interval(weeks=>n-1) ELSE make_interval(months=>n-1) END)::date
$$;
CREATE OR REPLACE FUNCTION arrears_plan_due_by(p arrears_payment_plans, p_day DATE) RETURNS BIGINT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN count(*)=p.instalments THEN p.total_ugx ELSE count(*)*(p.total_ugx/p.instalments) END
    FROM generate_series(1,p.instalments) n WHERE arrears_plan_due_on(p,n)<=p_day
$$;

-- 4. Arrears per household ------------------------------------------------------------------------------------
-- Overdue balance by age (days past the due date, Kampala time), with the latest payment, follow-up and plan.
CREATE OR REPLACE VIEW customer_arrears WITH (security_invoker=true) AS
WITH today AS (SELECT (now() AT TIME ZONE 'Africa/Kampala')::date AS d),
open_bills AS (
  SELECT i.organization_id,i.customer_id,i.balance_ugx,i.due_on,(SELECT d FROM today)-i.due_on AS days_late
  FROM customer_invoices i WHERE i.balance_ugx>0 AND i.status IN('issued','partially_paid','overdue')
)
SELECT b.organization_id,b.customer_id,
  sum(b.balance_ugx)::bigint AS open_ugx,
  coalesce(sum(b.balance_ugx) FILTER (WHERE b.days_late>0),0)::bigint AS overdue_ugx,
  coalesce(sum(b.balance_ugx) FILTER (WHERE b.days_late BETWEEN 1 AND 30),0)::bigint AS days_1_30_ugx,
  coalesce(sum(b.balance_ugx) FILTER (WHERE b.days_late BETWEEN 31 AND 60),0)::bigint AS days_31_60_ugx,
  coalesce(sum(b.balance_ugx) FILTER (WHERE b.days_late BETWEEN 61 AND 90),0)::bigint AS days_61_90_ugx,
  coalesce(sum(b.balance_ugx) FILTER (WHERE b.days_late>90),0)::bigint AS days_over_90_ugx,
  count(*) FILTER (WHERE b.days_late>0)::int AS overdue_bills,
  min(b.due_on) FILTER (WHERE b.days_late>0) AS oldest_due_on,
  coalesce(max(b.days_late),0)::int AS days_late
FROM open_bills b GROUP BY b.organization_id,b.customer_id;

-- 5. Access and audit -----------------------------------------------------------------------------------------
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['arrears_follow_ups','arrears_payment_plans'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS kwms_tenant ON %I', t);
    EXECUTE format('CREATE POLICY kwms_tenant ON %I USING (kwms_tenant_sees(organization_id)) WITH CHECK (kwms_tenant_sees(organization_id))', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_kwms_audit ON %I', t);
    EXECUTE format('CREATE TRIGGER trg_kwms_audit AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION kwms_audit_row()', t);
  END LOOP;
END $$;
-- Follow-ups are a record of what happened: they are added, never changed.
REVOKE UPDATE,DELETE,TRUNCATE ON arrears_follow_ups FROM kwms_app;
