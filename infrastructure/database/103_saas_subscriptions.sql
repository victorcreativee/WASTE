-- Module 12: Waste Management SaaS subscriptions — plan prices and limits on the existing platform packages, one
-- subscription per company (trial, active, past due, suspended, cancelled, complimentary), invoices per billing period
-- with payment submitted by the company and confirmed by the platform, plan limits enforced in the database.
-- Additive and idempotent. Requires 092–102.

-- Plans are the existing platform packages. Prices are placeholders until the business sets them.
ALTER TABLE platform_packages
  ADD COLUMN IF NOT EXISTS annual_fee_ugx BIGINT NOT NULL DEFAULT 0 CHECK(annual_fee_ugx>=0),
  ADD COLUMN IF NOT EXISTS max_vehicles INTEGER CHECK(max_vehicles IS NULL OR max_vehicles>0),
  ADD COLUMN IF NOT EXISTS max_users INTEGER CHECK(max_users IS NULL OR max_users>0),
  ADD COLUMN IF NOT EXISTS trial_days INTEGER NOT NULL DEFAULT 30 CHECK(trial_days BETWEEN 0 AND 90),
  ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT true;

-- Placeholder prices and limits, applied once (a plan that already has a price keeps it).
UPDATE platform_packages p SET monthly_fee_ugx=v.monthly,annual_fee_ugx=v.annual,max_vehicles=v.vehicles,max_users=v.users,is_public=v.public
FROM (VALUES
  ('collector_standard',150000,1500000,5,15,true),
  ('collector_professional',350000,3500000,NULL,NULL,true),
  ('recycling_starter',0,0,2,5,true),
  ('recycling_standard',100000,1000000,5,15,true),
  ('recycling_professional',250000,2500000,NULL,NULL,true),
  ('factory_standard',300000,3000000,NULL,NULL,true),
  ('operations_pro',0,0,NULL,NULL,false),
  ('core_collector',0,0,NULL,NULL,false),
  ('collector_custom',0,0,NULL,NULL,false)
) AS v(code,monthly,annual,vehicles,users,public)
WHERE p.code=v.code AND p.monthly_fee_ugx=0 AND p.annual_fee_ugx=0;

CREATE TABLE IF NOT EXISTS organization_subscriptions(
 organization_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
 package_id UUID NOT NULL REFERENCES platform_packages(id),
 billing_cycle TEXT NOT NULL DEFAULT 'monthly' CHECK(billing_cycle IN('monthly','annual')),
 status TEXT NOT NULL CHECK(status IN('trialing','active','past_due','suspended','cancelled','complimentary')),
 trial_ends_at TIMESTAMPTZ,
 current_period_start DATE NOT NULL,
 current_period_end DATE NOT NULL,
 cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
 pending_package_id UUID REFERENCES platform_packages(id),
 pending_billing_cycle TEXT CHECK(pending_billing_cycle IN('monthly','annual')),
 status_reason TEXT,
 started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK(current_period_end>current_period_start),
 CHECK(status<>'trialing' OR trial_ends_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_due ON organization_subscriptions(status,current_period_end);

CREATE SEQUENCE IF NOT EXISTS subscription_invoice_number_seq;
CREATE TABLE IF NOT EXISTS subscription_invoices(
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 invoice_number TEXT NOT NULL UNIQUE DEFAULT ('SI-'||to_char(CURRENT_DATE,'YYYY')||'-'||lpad(nextval('subscription_invoice_number_seq')::text,5,'0')),
 organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 package_id UUID NOT NULL REFERENCES platform_packages(id),
 kind TEXT NOT NULL CHECK(kind IN('period','proration')),
 billing_cycle TEXT NOT NULL CHECK(billing_cycle IN('monthly','annual')),
 period_start DATE NOT NULL,
 period_end DATE NOT NULL,
 amount_ugx BIGINT NOT NULL CHECK(amount_ugx>0),
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN('open','payment_submitted','paid','void')),
 issued_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 due_on DATE NOT NULL,
 payment_reference TEXT,
 paid_on DATE,
 payment_submitted_by UUID REFERENCES users(id),
 payment_submitted_at TIMESTAMPTZ,
 confirmed_by UUID REFERENCES users(id),
 confirmed_at TIMESTAMPTZ,
 void_reason TEXT,
 CHECK(period_end>period_start),
 CHECK(status NOT IN('payment_submitted','paid') OR (payment_reference IS NOT NULL AND paid_on IS NOT NULL)),
 CHECK(status<>'paid' OR confirmed_at IS NOT NULL),
 CHECK(status<>'void' OR length(void_reason)>=5)
);
CREATE INDEX IF NOT EXISTS idx_subscription_invoices_org ON subscription_invoices(organization_id,issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_subscription_invoices_open ON subscription_invoices(status,due_on) WHERE status IN('open','payment_submitted');
-- A billing period is invoiced once.
CREATE UNIQUE INDEX IF NOT EXISTS one_invoice_per_period ON subscription_invoices(organization_id,period_start) WHERE kind='period' AND status<>'void';

CREATE OR REPLACE FUNCTION guard_subscription_invoice() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE allowed JSONB := '{"open":["payment_submitted","paid","void"],"payment_submitted":["paid","open"],"paid":[],"void":[]}';
BEGIN
  IF NEW.status<>OLD.status AND NOT (allowed->OLD.status) ? NEW.status THEN
    RAISE EXCEPTION 'An invoice that is % cannot become %',replace(OLD.status,'_',' '),replace(NEW.status,'_',' ');
  END IF;
  IF NEW.amount_ugx<>OLD.amount_ugx OR NEW.organization_id<>OLD.organization_id OR NEW.period_start<>OLD.period_start OR NEW.period_end<>OLD.period_end THEN
    RAISE EXCEPTION 'The company, period and amount of an invoice cannot be changed; void it and issue another';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_subscription_invoice ON subscription_invoices;
CREATE TRIGGER trg_guard_subscription_invoice BEFORE UPDATE ON subscription_invoices FOR EACH ROW EXECUTE FUNCTION guard_subscription_invoice();

CREATE TABLE IF NOT EXISTS subscription_events(
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 action TEXT NOT NULL,
 note TEXT,
 actor_user_id UUID REFERENCES users(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_subscription_events_org ON subscription_events(organization_id,created_at);
CREATE OR REPLACE FUNCTION block_subscription_event_update() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Subscription history cannot be changed'; END $$;
DROP TRIGGER IF EXISTS trg_block_subscription_event_update ON subscription_events;
CREATE TRIGGER trg_block_subscription_event_update BEFORE UPDATE ON subscription_events FOR EACH ROW EXECUTE FUNCTION block_subscription_event_update();

-- Starts a company's subscription on its plan: a trial for a paid plan, or straight to active for a free one.
CREATE OR REPLACE FUNCTION start_subscription_trial(p_organization_id UUID,p_package_id UUID) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE plan RECORD; result TEXT;
BEGIN
  SELECT monthly_fee_ugx,trial_days INTO plan FROM platform_packages WHERE id=p_package_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown plan'; END IF;
  IF plan.monthly_fee_ugx=0 THEN
    INSERT INTO organization_subscriptions(organization_id,package_id,status,current_period_start,current_period_end)
    VALUES(p_organization_id,p_package_id,'active',CURRENT_DATE,(CURRENT_DATE+interval '1 month')::date) ON CONFLICT(organization_id) DO NOTHING;
    result := 'active';
  ELSE
    INSERT INTO organization_subscriptions(organization_id,package_id,status,trial_ends_at,current_period_start,current_period_end)
    VALUES(p_organization_id,p_package_id,'trialing',CURRENT_TIMESTAMP+make_interval(days=>GREATEST(plan.trial_days,1)),CURRENT_DATE,CURRENT_DATE+GREATEST(plan.trial_days,1))
    ON CONFLICT(organization_id) DO NOTHING;
    result := 'trialing';
  END IF;
  INSERT INTO subscription_events(organization_id,action,note) VALUES(p_organization_id,'started',result);
  RETURN result;
END $$;

-- Plan limits on vehicles and active staff, for companies on a managed subscription (complimentary and unmanaged
-- companies are not limited).
CREATE OR REPLACE FUNCTION plan_limit_reason(p_organization_id UUID,p_kind TEXT) RETURNS TEXT LANGUAGE plpgsql STABLE AS $$
DECLARE plan RECORD; used INTEGER;
BEGIN
  SELECT p.name,p.max_vehicles,p.max_users,s.status INTO plan FROM organization_subscriptions s JOIN platform_packages p ON p.id=s.package_id WHERE s.organization_id=p_organization_id;
  IF NOT FOUND OR plan.status='complimentary' THEN RETURN NULL; END IF;
  IF p_kind='vehicle' AND plan.max_vehicles IS NOT NULL THEN
    SELECT COUNT(*) INTO used FROM waste_trucks WHERE organization_id=p_organization_id;
    IF used>=plan.max_vehicles THEN RETURN format('The %s plan allows %s vehicles. Upgrade the plan to add more.',plan.name,plan.max_vehicles); END IF;
  ELSIF p_kind='user' AND plan.max_users IS NOT NULL THEN
    SELECT COUNT(*) INTO used FROM users WHERE organization_id=p_organization_id AND status='active';
    IF used>=plan.max_users THEN RETURN format('The %s plan allows %s active staff accounts. Upgrade the plan to add more.',plan.name,plan.max_users); END IF;
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION enforce_vehicle_plan_limit() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE reason TEXT;
BEGIN
  IF NEW.organization_id IS NOT NULL THEN
    reason := plan_limit_reason(NEW.organization_id,'vehicle');
    IF reason IS NOT NULL THEN RAISE EXCEPTION '%',reason; END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_vehicle_plan_limit ON waste_trucks;
CREATE TRIGGER trg_vehicle_plan_limit BEFORE INSERT ON waste_trucks FOR EACH ROW EXECUTE FUNCTION enforce_vehicle_plan_limit();

CREATE OR REPLACE FUNCTION enforce_user_plan_limit() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE reason TEXT;
BEGIN
  IF NEW.organization_id IS NOT NULL AND NEW.status='active'
     AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM 'active' OR OLD.organization_id IS DISTINCT FROM NEW.organization_id) THEN
    reason := plan_limit_reason(NEW.organization_id,'user');
    IF reason IS NOT NULL THEN RAISE EXCEPTION '%',reason; END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_user_plan_limit ON users;
CREATE TRIGGER trg_user_plan_limit BEFORE INSERT OR UPDATE OF organization_id,status ON users FOR EACH ROW EXECUTE FUNCTION enforce_user_plan_limit();

-- Companies already on the platform keep full access free of charge until the platform starts billing them.
INSERT INTO organization_subscriptions(organization_id,package_id,status,current_period_start,current_period_end,status_reason)
SELECT o.id,o.platform_package_id,'complimentary',CURRENT_DATE,(CURRENT_DATE+interval '1 month')::date,'On the platform before subscriptions'
FROM organizations o WHERE o.is_active AND o.platform_package_id IS NOT NULL AND o.type IN('waste_collection_company','recycling_company','processing_plant')
ON CONFLICT(organization_id) DO NOTHING;

-- Subscription and billing notices are their own notification category.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_category_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_category_check CHECK(category IN('permit','renewal','returns','compliance','custody','disposal','dumping','penalties','billing','system'));
ALTER TABLE notification_preferences DROP CONSTRAINT IF EXISTS notification_preferences_category_check;
ALTER TABLE notification_preferences ADD CONSTRAINT notification_preferences_category_check CHECK(category IN('permit','renewal','returns','compliance','custody','disposal','dumping','penalties','billing','system'));
