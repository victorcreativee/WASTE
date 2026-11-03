-- KCCA tariff schedule and mobile money collection (concept note KWMS-CN-001, module 4).
--
-- Tariffs: KCCA keeps tariff bands (e.g. residential standard) and dated rates for each. A rate already in force can
-- never change; KCCA publishes a new rate with a later effective date, and may withdraw a rate before it starts.
-- A company's service plan can follow a band: the plan's price then comes from KCCA, and every bill for it is priced
-- here, from the rate in force on the first day of the billing period, and records which rate it used.
--
-- Mobile money: each company connects its own MTN MoMo and Airtel Money collection accounts (credentials encrypted by
-- the service). Payments made through them are confirmed by asking the provider, never by trusting a callback.
-- Requires 082 and 083.

CREATE TABLE IF NOT EXISTS kcca_tariff_bands (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code VARCHAR(30) NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9_]{2,30}$'),
  name VARCHAR(120) NOT NULL CHECK (length(btrim(name)) >= 2),
  customer_type VARCHAR(30) NOT NULL CHECK (customer_type IN ('residential','commercial','office_business','industrial')),
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS kcca_tariff_rates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  band_id UUID NOT NULL REFERENCES kcca_tariff_bands(id),
  monthly_fee_ugx BIGINT NOT NULL CHECK (monthly_fee_ugx >= 0),
  effective_from DATE NOT NULL,
  notice_reference VARCHAR(120),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (band_id, effective_from)
);

CREATE OR REPLACE FUNCTION kampala_today() RETURNS DATE LANGUAGE sql STABLE AS $$
  SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Kampala')::DATE;
$$;

CREATE OR REPLACE FUNCTION guard_kcca_tariff_rate() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'A published tariff rate cannot be changed. Publish a new rate with a later effective date.';
  END IF;
  IF OLD.effective_from <= kampala_today() THEN
    RAISE EXCEPTION 'This rate is already in force and cannot be withdrawn. Publish a new rate instead.';
  END IF;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS trg_guard_kcca_tariff_rate ON kcca_tariff_rates;
CREATE TRIGGER trg_guard_kcca_tariff_rate BEFORE UPDATE OR DELETE ON kcca_tariff_rates
  FOR EACH ROW EXECUTE FUNCTION guard_kcca_tariff_rate();

CREATE OR REPLACE FUNCTION kcca_tariff_rate_at(p_band_id UUID, p_on DATE) RETURNS kcca_tariff_rates LANGUAGE sql STABLE AS $$
  SELECT * FROM kcca_tariff_rates WHERE band_id = p_band_id AND effective_from <= p_on ORDER BY effective_from DESC LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION plan_period_months(p_frequency TEXT) RETURNS INTEGER LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_frequency WHEN 'quarterly' THEN 3 WHEN 'annual' THEN 12 ELSE 1 END;
$$;

ALTER TABLE service_plans ADD COLUMN IF NOT EXISTS tariff_band_id UUID REFERENCES kcca_tariff_bands(id);
ALTER TABLE customer_invoices ADD COLUMN IF NOT EXISTS tariff_rate_id UUID REFERENCES kcca_tariff_rates(id);
CREATE INDEX IF NOT EXISTS service_plans_tariff_band ON service_plans(tariff_band_id) WHERE tariff_band_id IS NOT NULL;

-- A plan that follows a band takes its customer type from the band and its price from the rate in force today.
CREATE OR REPLACE FUNCTION price_plan_from_tariff() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE band kcca_tariff_bands; rate kcca_tariff_rates;
BEGIN
  IF NEW.tariff_band_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO band FROM kcca_tariff_bands WHERE id = NEW.tariff_band_id;
  IF NOT band.is_active THEN RAISE EXCEPTION 'KCCA has retired the tariff band %', band.name; END IF;
  rate := kcca_tariff_rate_at(NEW.tariff_band_id, kampala_today());
  IF rate.id IS NULL THEN RAISE EXCEPTION 'KCCA has no rate in force yet for the tariff band %', band.name; END IF;
  NEW.customer_type := band.customer_type;
  NEW.fee_ugx := rate.monthly_fee_ugx * plan_period_months(NEW.billing_frequency);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_price_plan_from_tariff ON service_plans;
CREATE TRIGGER trg_price_plan_from_tariff BEFORE INSERT OR UPDATE OF tariff_band_id, billing_frequency, fee_ugx, customer_type ON service_plans
  FOR EACH ROW EXECUTE FUNCTION price_plan_from_tariff();

-- Every bill for a tariff plan is priced from the rate in force on the first day it covers, whichever code path
-- creates it. A bill created with its full amount outstanding keeps it so.
CREATE OR REPLACE FUNCTION price_invoice_from_tariff() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE plan RECORD; rate kcca_tariff_rates; amount BIGINT;
BEGIN
  SELECT sp.tariff_band_id, sp.billing_frequency, b.name AS band_name INTO plan
    FROM customer_subscriptions cs JOIN service_plans sp ON sp.id = cs.plan_id
    LEFT JOIN kcca_tariff_bands b ON b.id = sp.tariff_band_id
   WHERE cs.id = NEW.subscription_id;
  IF plan.tariff_band_id IS NULL THEN RETURN NEW; END IF;
  rate := kcca_tariff_rate_at(plan.tariff_band_id, COALESCE(NEW.billing_period_start, NEW.issued_on));
  IF rate.id IS NULL THEN
    RAISE EXCEPTION 'KCCA had no rate for the tariff band % on %', plan.band_name, COALESCE(NEW.billing_period_start, NEW.issued_on);
  END IF;
  amount := rate.monthly_fee_ugx * plan_period_months(plan.billing_frequency);
  IF NEW.balance_ugx = NEW.amount_ugx THEN NEW.balance_ugx := amount; END IF;
  NEW.amount_ugx := amount;
  NEW.tariff_rate_id := rate.id;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_price_invoice_from_tariff ON customer_invoices;
CREATE TRIGGER trg_price_invoice_from_tariff BEFORE INSERT ON customer_invoices
  FOR EACH ROW EXECUTE FUNCTION price_invoice_from_tariff();

-- Brings the shown price of tariff plans up to today's rates. Run when a rate is published and daily by the service,
-- so a rate that starts on a future date shows from that day. Returns how many plans changed.
CREATE OR REPLACE FUNCTION sync_tariff_plan_fees() RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE changed INTEGER;
BEGIN
  UPDATE service_plans sp SET fee_ugx = r.monthly_fee_ugx * plan_period_months(sp.billing_frequency), updated_at = CURRENT_TIMESTAMP
    FROM kcca_tariff_bands b, LATERAL kcca_tariff_rate_at(b.id, kampala_today()) r
   WHERE b.id = sp.tariff_band_id AND b.is_active AND r.id IS NOT NULL
     AND sp.fee_ugx IS DISTINCT FROM r.monthly_fee_ugx * plan_period_months(sp.billing_frequency);
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed;
END $$;

CREATE OR REPLACE FUNCTION sync_tariff_plans_after_rate() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM sync_tariff_plan_fees();
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_sync_tariff_plans ON kcca_tariff_rates;
CREATE TRIGGER trg_sync_tariff_plans AFTER INSERT OR DELETE ON kcca_tariff_rates
  FOR EACH STATEMENT EXECUTE FUNCTION sync_tariff_plans_after_rate();

-- ---------- Mobile money ----------

CREATE TABLE IF NOT EXISTS organization_payment_accounts (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider VARCHAR(20) NOT NULL CHECK (provider IN ('mtn_momo','airtel_money')),
  environment VARCHAR(20) NOT NULL CHECK (environment IN ('sandbox','production')),
  credentials_encrypted TEXT NOT NULL,
  credentials_hint TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  last_verified_at TIMESTAMPTZ,
  last_error TEXT,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id, provider)
);

ALTER TABLE customer_payments
  ADD COLUMN IF NOT EXISTS provider_request_id VARCHAR(64),
  ADD COLUMN IF NOT EXISTS provider_environment VARCHAR(20),
  ADD COLUMN IF NOT EXISTS provider_status VARCHAR(40),
  ADD COLUMN IF NOT EXISTS provider_message TEXT,
  ADD COLUMN IF NOT EXISTS provider_amount_ugx BIGINT,
  ADD COLUMN IF NOT EXISTS initiated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS next_check_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS check_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failure_reason TEXT,
  ADD COLUMN IF NOT EXISTS needs_review BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS review_reason TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS customer_payments_provider_request ON customer_payments(provider, provider_request_id) WHERE provider_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS customer_payments_due_checks ON customer_payments(next_check_at) WHERE status = 'pending' AND provider_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS customer_payments_review ON customer_payments(organization_id) WHERE needs_review;
CREATE INDEX IF NOT EXISTS customer_payments_org_created ON customer_payments(organization_id, created_at DESC);

-- Every callback received, kept for reconciliation and disputes. Callbacks only prompt a status check with the provider.
CREATE TABLE IF NOT EXISTS payment_provider_callbacks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider VARCHAR(20) NOT NULL,
  payment_id UUID REFERENCES customer_payments(id) ON DELETE SET NULL,
  request_id VARCHAR(64),
  body JSONB,
  remote_ip TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS payment_provider_callbacks_payment ON payment_provider_callbacks(payment_id, received_at DESC);
CREATE INDEX IF NOT EXISTS payment_provider_callbacks_received ON payment_provider_callbacks(received_at);
