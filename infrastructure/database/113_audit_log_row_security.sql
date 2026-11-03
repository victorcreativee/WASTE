-- KWMS-CN-001-2026: multi-tenant row-level security and an audit log with before/after state and IP.
--
-- The services log in as the database owner but switch to the restricted role kwms_app for every
-- connection (SET ROLE, see runtime.ts). Before each use of a connection they call
-- kwms_set_request_context(), which works out from the signed-in user who is asking:
--   tenant     company staff: sees only rows of their own organization
--   city       KCCA staff and weighbridge operators: all operators
--   household  citizens (their services filter by household)
--   public     requests without a signed-in user (login, public receipt checks, callbacks)
--   system     background work with no request (scheduler)
-- The policies below only narrow the tenant scope. Sessions that never set a scope (psql,
-- migrations) are not filtered.

-- 1. Runtime role --------------------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kwms_app') THEN
    CREATE ROLE kwms_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
  EXECUTE format('GRANT kwms_app TO %I', current_user);
  EXECUTE format('GRANT CONNECT, TEMPORARY ON DATABASE %I TO kwms_app', current_database());
END $$;

GRANT USAGE ON SCHEMA public TO kwms_app;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public TO kwms_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO kwms_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO kwms_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES TO kwms_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO kwms_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO kwms_app;

-- Views run with their owner's rights unless told otherwise, which would skip the policies.
DO $$ DECLARE v TEXT; BEGIN
  FOR v IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind = 'v'
             AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e') LOOP
    EXECUTE format('ALTER VIEW %I SET (security_invoker = true)', v);
  END LOOP;
END $$;

-- 2. Request context ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION kwms_set_request_context(p_user UUID, p_ip TEXT, p_request_id TEXT, p_path TEXT)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE org UUID; r TEXT[] := '{}'; scope TEXT;
BEGIN
  IF p_user IS NULL THEN
    scope := CASE WHEN p_request_id IS NULL THEN 'system' ELSE 'public' END;
  ELSE
    SELECT u.organization_id, COALESCE(array_agg(ro.name) FILTER (WHERE ro.name IS NOT NULL), '{}')
      INTO org, r
      FROM users u LEFT JOIN user_roles ur ON ur.user_id = u.id LEFT JOIN roles ro ON ro.id = ur.role_id
     WHERE u.id = p_user GROUP BY u.id;
    r := COALESCE(r, '{}');
    scope := CASE
      WHEN 'system_admin' = ANY(r) THEN 'system'
      WHEN r && ARRAY['kcca_admin', 'weighbridge_operator'] THEN 'city'
      WHEN r && ARRAY['company_admin', 'supervisor', 'driver', 'iot_operator', 'recycling_collector',
                      'recycling_sales', 'recycling_field_manager', 'organization_applicant'] THEN 'tenant'
      WHEN 'citizen' = ANY(r) THEN 'household'
      ELSE 'tenant' END; -- an account with no known role sees no operator's rows
  END IF;
  PERFORM set_config('app.scope', scope, false),
          set_config('app.org', CASE WHEN scope = 'tenant' THEN COALESCE(org::TEXT, '') ELSE '' END, false),
          set_config('app.user_id', COALESCE(p_user::TEXT, ''), false),
          set_config('app.roles', array_to_string(r, ','), false),
          set_config('app.ip', left(COALESCE(p_ip, ''), 64), false),
          set_config('app.request_id', left(COALESCE(p_request_id, ''), 64), false),
          set_config('app.path', left(COALESCE(p_path, ''), 200), false);
  RETURN scope;
END $$;

CREATE OR REPLACE FUNCTION kwms_tenant_sees(p_org UUID) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT current_setting('app.scope', true) IS DISTINCT FROM 'tenant'
      OR p_org = NULLIF(current_setting('app.org', true), '')::UUID
$$;

-- 3. Tenant isolation -----------------------------------------------------------------------------
-- Operator-owned operational, customer and finance records. Regulatory records, identity and access,
-- notifications, the weighbridge and the recycling factory flow are shared across organizations by
-- design and stay filtered by the services.
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY[
    'collection_route_status_history','customer_collection_stops','customer_contracts','customer_invoices',
    'customer_payments','customer_service_relationships','customer_subscriptions','desktop_sync_requests',
    'household_access_links','household_sms_settings','organization_expenses','organization_finance_settings',
    'organization_finance_setting_history','organization_payment_accounts','payroll_lines','payroll_periods',
    'purchase_orders','purchase_requests','inventory_items','inventory_movements','receipt_counters','receipt_series',
    'collection_receipts','collection_receipt_voids','collection_receipt_exports','service_plans','service_routes',
    'service_route_customers','staff_attendance','supervisor_drivers','supplier_bills','supplier_payments','suppliers',
    'truck_documents','truck_fuel_records','truck_maintenance_records','vehicle_location_events','fleet_alert_reviews',
    'trip_track_checks','trip_disposal_explanations','recycling_cash_movements','recycling_daily_closures',
    'recycling_manager_float_transactions','recycling_payment_followups','recycling_purchase_payments',
    'recycling_sale_payments','recycling_sorting_batches','recycling_stock_adjustments','recycling_trade_partners',
    'recycling_transaction_edits'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS kwms_tenant ON %I', t);
    EXECUTE format('CREATE POLICY kwms_tenant ON %I USING (kwms_tenant_sees(organization_id)) WITH CHECK (kwms_tenant_sees(organization_id))', t);
  END LOOP;
  -- Older rows here may have no organization; those stay visible as before.
  FOREACH t IN ARRAY ARRAY['collection_jobs','collection_routes','customer_service_locations','driver_job_problems',
                           'drivers','pickup_schedules','waste_trucks'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS kwms_tenant ON %I', t);
    EXECUTE format('CREATE POLICY kwms_tenant ON %I USING (organization_id IS NULL OR kwms_tenant_sees(organization_id)) WITH CHECK (organization_id IS NULL OR kwms_tenant_sees(organization_id))', t);
  END LOOP;
END $$;

-- A processing plant sees the sales made to it and the lots they came from (migration 097).
ALTER TABLE recycling_material_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE recycling_material_sales FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kwms_tenant ON recycling_material_sales;
CREATE POLICY kwms_tenant ON recycling_material_sales
  USING (kwms_tenant_sees(organization_id) OR (buyer_organization_id IS NOT NULL AND kwms_tenant_sees(buyer_organization_id)))
  WITH CHECK (kwms_tenant_sees(organization_id));
ALTER TABLE recycling_material_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE recycling_material_lots FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kwms_tenant ON recycling_material_lots;
CREATE POLICY kwms_tenant ON recycling_material_lots
  USING (kwms_tenant_sees(organization_id) OR EXISTS (SELECT 1 FROM recycling_material_sales s WHERE s.lot_id = recycling_material_lots.id AND s.buyer_organization_id IS NOT NULL AND kwms_tenant_sees(s.buyer_organization_id)))
  WITH CHECK (kwms_tenant_sees(organization_id));

-- Receipt codes must be unique across every operator, so this check has to see them all.
ALTER FUNCTION new_receipt_code(TEXT) SECURITY DEFINER SET search_path = public;

-- 4. Audit log ------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  organization_id UUID,
  actor_id UUID,
  actor_roles TEXT,
  actor_scope TEXT,
  ip TEXT,
  request_id TEXT,
  request_path TEXT,
  source TEXT,          -- the program that made the change (waste-service, psql, ...)
  db_user TEXT,         -- the database login used
  table_name TEXT NOT NULL,
  record_id TEXT,
  action TEXT NOT NULL CHECK (action IN ('insert', 'update', 'delete')),
  changed_fields TEXT[],
  before_state JSONB,
  after_state JSONB
);
CREATE INDEX IF NOT EXISTS idx_audit_log_time ON audit_log (occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_org_time ON audit_log (organization_id, occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_record ON audit_log (table_name, record_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log (actor_id, occurred_at DESC) WHERE actor_id IS NOT NULL;

CREATE OR REPLACE FUNCTION kwms_audit_redact(j JSONB) RETURNS JSONB LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(jsonb_object_agg(k, CASE WHEN k ~* '(password|secret|token|credentials_encrypted|otp|pin_hash|api_key)' AND v <> 'null'::JSONB
                                           THEN to_jsonb('[redacted]'::TEXT) ELSE v END), '{}'::JSONB)
    FROM jsonb_each(j) AS e(k, v)
$$;

-- Runs as the owner: the application role cannot write to audit_log itself.
CREATE OR REPLACE FUNCTION kwms_audit_row() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE raw_before JSONB; raw_after JSONB; changed TEXT[]; v JSONB; org UUID;
BEGIN
  IF TG_OP <> 'INSERT' THEN raw_before := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN raw_after := to_jsonb(NEW); END IF;
  IF TG_OP = 'UPDATE' THEN
    SELECT array_agg(k ORDER BY k) INTO changed FROM jsonb_each(raw_after) AS n(k, val)
     WHERE n.val IS DISTINCT FROM raw_before -> k
       AND k NOT IN ('updated_at', 'last_login_at', 'last_checked_at', 'next_check_at', 'check_attempts');
    IF changed IS NULL THEN RETURN NULL; END IF;
  END IF;
  v := COALESCE(raw_after, raw_before);
  org := CASE TG_TABLE_NAME
           WHEN 'organizations' THEN (v ->> 'id')::UUID
           WHEN 'user_roles' THEN (SELECT organization_id FROM users WHERE id = (v ->> 'user_id')::UUID)
           ELSE (v ->> 'organization_id')::UUID END;
  INSERT INTO audit_log (organization_id, actor_id, actor_roles, actor_scope, ip, request_id, request_path, source, db_user,
                         table_name, record_id, action, changed_fields, before_state, after_state)
  VALUES (org,
          COALESCE(NULLIF(current_setting('app.user_id', true), ''), NULLIF(current_setting('wms.actor_id', true), ''))::UUID,
          NULLIF(current_setting('app.roles', true), ''), NULLIF(current_setting('app.scope', true), ''),
          NULLIF(current_setting('app.ip', true), ''), NULLIF(current_setting('app.request_id', true), ''),
          NULLIF(current_setting('app.path', true), ''), NULLIF(current_setting('application_name', true), ''), session_user,
          TG_TABLE_NAME, COALESCE(v ->> 'id', v ->> 'user_id', v ->> 'organization_id'), lower(TG_OP), changed,
          kwms_audit_redact(raw_before), kwms_audit_redact(raw_after));
  RETURN NULL;
END $$;

DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY[
    'organizations','users','user_roles','organization_memberships','organization_membership_roles','organization_roles',
    'organization_role_permissions','customer_service_relationships','customer_service_locations','customer_contracts',
    'customer_subscriptions','service_plans','customer_invoices','customer_payments','organization_payment_accounts',
    'kcca_tariff_bands','kcca_tariff_rates','receipt_settings','receipt_series','collection_receipt_voids',
    'organization_permit_applications','organization_division_authorizations','penalty_notices','collector_compliance_cases',
    'regulatory_returns','waste_trucks','drivers','weighbridge_transactions','organization_expenses','supplier_payments',
    'payroll_periods','payroll_lines','recycling_material_sales','recycling_purchase_payments','recycling_sale_payments',
    'recycling_cash_movements','recycling_stock_adjustments','organization_subscriptions','subscription_invoices',
    'organization_package_feature_overrides','organization_finance_settings','truck_documents'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_kwms_audit ON %I', t);
    EXECUTE format('CREATE TRIGGER trg_kwms_audit AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION kwms_audit_row()', t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION kwms_audit_log_immutable() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'The audit log cannot be changed or deleted'; END $$;
DROP TRIGGER IF EXISTS trg_audit_log_immutable ON audit_log;
CREATE TRIGGER trg_audit_log_immutable BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION kwms_audit_log_immutable();
DROP TRIGGER IF EXISTS trg_audit_log_no_truncate ON audit_log;
CREATE TRIGGER trg_audit_log_no_truncate BEFORE TRUNCATE ON audit_log FOR EACH STATEMENT EXECUTE FUNCTION kwms_audit_log_immutable();

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON audit_log FROM kwms_app;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kwms_audit_read ON audit_log;
CREATE POLICY kwms_audit_read ON audit_log FOR SELECT USING (kwms_tenant_sees(organization_id));
DROP POLICY IF EXISTS kwms_audit_write ON audit_log;
CREATE POLICY kwms_audit_write ON audit_log FOR INSERT WITH CHECK (true);

-- 5. Isolation report -----------------------------------------------------------------------------
-- Tables that carry an organization and whether the database enforces isolation on them.
CREATE OR REPLACE FUNCTION kwms_row_security_report()
RETURNS TABLE (table_name TEXT, isolated BOOLEAN, forced BOOLEAN, policies INTEGER, audited BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.relname::TEXT, c.relrowsecurity, c.relforcerowsecurity,
         (SELECT count(*)::INTEGER FROM pg_policy p WHERE p.polrelid = c.oid),
         EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = c.oid AND tg.tgname = 'trg_kwms_audit')
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r'
     AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'organization_id' AND NOT a.attisdropped)
   ORDER BY 1
$$;
