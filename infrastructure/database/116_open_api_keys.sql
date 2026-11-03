-- KWMS open API (concept note phase 3: "Open API with key management"). Read-only keys for other systems: a company's own
-- integrations, or partners KCCA admits (NEMA, development finance, carbon verifiers). Only a hash of each secret is
-- kept. Requests made with a key run under row-level security as that key's company, or city-wide for a partner key.
-- Additive and idempotent. Requires 113.

CREATE TABLE IF NOT EXISTS api_keys(
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 organization_id UUID REFERENCES organizations(id),          -- NULL: a partner key issued by KCCA
 name TEXT NOT NULL CHECK(length(name) BETWEEN 3 AND 100),
 holder_name TEXT CHECK(holder_name IS NULL OR length(holder_name) BETWEEN 2 AND 150),
 contact_email TEXT CHECK(contact_email IS NULL OR contact_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
 purpose TEXT CHECK(purpose IS NULL OR length(purpose)<=500),
 key_prefix TEXT NOT NULL UNIQUE CHECK(key_prefix ~ '^[a-z0-9]{8}$'),
 secret_hash TEXT NOT NULL CHECK(secret_hash ~ '^[0-9a-f]{64}$'),
 scopes TEXT[] NOT NULL CHECK(cardinality(scopes)>0 AND scopes <@ ARRAY['operators:read','tonnage:read','certificates:read','carbon:read','receipts:read']),
 rate_limit_per_minute INT NOT NULL DEFAULT 60 CHECK(rate_limit_per_minute BETWEEN 1 AND 600),
 expires_at TIMESTAMPTZ NOT NULL,
 created_by UUID REFERENCES users(id),
 created_by_name TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 last_used_at TIMESTAMPTZ,
 last_used_ip TEXT,
 revoked_at TIMESTAMPTZ,
 revoked_by UUID REFERENCES users(id),
 revoked_by_name TEXT,
 revoked_reason TEXT,
 -- Household receipts are personal data: only a company's own key may read them.
 CHECK(organization_id IS NOT NULL OR NOT 'receipts:read'=ANY(scopes)),
 CHECK(organization_id IS NOT NULL OR holder_name IS NOT NULL),
 CHECK(revoked_at IS NULL OR (revoked_by IS NOT NULL AND length(revoked_reason)>=5))
);
CREATE INDEX IF NOT EXISTS idx_api_keys_org ON api_keys(organization_id,created_at DESC);

-- Requests per key, endpoint and Kampala day.
CREATE TABLE IF NOT EXISTS api_key_usage(
 key_id UUID NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
 organization_id UUID REFERENCES organizations(id),
 day DATE NOT NULL,
 endpoint TEXT NOT NULL,
 requests INT NOT NULL DEFAULT 0,
 refused INT NOT NULL DEFAULT 0,
 PRIMARY KEY(key_id,day,endpoint)
);

-- A key's secret is checked here, so the app never reads secret hashes. Answers the key only while it is usable.
CREATE OR REPLACE FUNCTION kwms_authenticate_api_key(p_prefix TEXT,p_secret_hash TEXT,p_ip TEXT)
RETURNS TABLE(id UUID,organization_id UUID,name TEXT,holder_name TEXT,scopes TEXT[],rate_limit_per_minute INT,expires_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  RETURN QUERY UPDATE api_keys k SET last_used_at=CURRENT_TIMESTAMP,last_used_ip=left(p_ip,64)
    WHERE k.key_prefix=p_prefix AND k.secret_hash=p_secret_hash AND k.revoked_at IS NULL AND k.expires_at>CURRENT_TIMESTAMP
      AND (k.organization_id IS NULL OR EXISTS(SELECT 1 FROM organizations o WHERE o.id=k.organization_id AND o.is_active))
    RETURNING k.id,k.organization_id,k.name,k.holder_name,k.scopes,k.rate_limit_per_minute,k.expires_at;
END $$;

-- Who a key acts as: its company (tenant scope) or, for a partner key, the city.
CREATE OR REPLACE FUNCTION kwms_api_key_scope(p_key UUID) RETURNS TABLE(org UUID,scope TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT k.organization_id,CASE WHEN k.organization_id IS NULL THEN 'city' ELSE 'tenant' END
  FROM api_keys k WHERE k.id=p_key AND k.revoked_at IS NULL
$$;

-- The request context of migration 113, now also for API keys. The four-argument form is replaced by one with an
-- optional key, so services that still pass four arguments keep working.
DROP FUNCTION IF EXISTS kwms_set_request_context(UUID,TEXT,TEXT,TEXT);
CREATE OR REPLACE FUNCTION kwms_set_request_context(p_user UUID, p_ip TEXT, p_request_id TEXT, p_path TEXT, p_api_key UUID DEFAULT NULL)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE org UUID; r TEXT[] := '{}'; scope TEXT;
BEGIN
  IF p_api_key IS NOT NULL THEN
    SELECT s.org,s.scope INTO org,scope FROM kwms_api_key_scope(p_api_key) s;
    scope := COALESCE(scope,'tenant'); -- a key revoked mid-request sees no operator's rows
    r := ARRAY['api_key'];
  ELSIF p_user IS NULL THEN
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
          set_config('app.api_key', COALESCE(p_api_key::TEXT, ''), false),
          set_config('app.roles', array_to_string(r, ','), false),
          set_config('app.ip', left(COALESCE(p_ip, ''), 64), false),
          set_config('app.request_id', left(COALESCE(p_request_id, ''), 64), false),
          set_config('app.path', left(COALESCE(p_path, ''), 200), false);
  RETURN scope;
END $$;

-- Companies see and manage only their own keys and usage; partner keys are visible to KCCA and system administrators.
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['api_keys','api_key_usage'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS kwms_tenant ON %I', t);
    EXECUTE format('CREATE POLICY kwms_tenant ON %I USING (kwms_tenant_sees(organization_id)) WITH CHECK (kwms_tenant_sees(organization_id))', t);
  END LOOP;
END $$;
-- The secret hash never leaves the database through the app role.
REVOKE SELECT ON api_keys FROM kwms_app;
GRANT SELECT(id,organization_id,name,holder_name,contact_email,purpose,key_prefix,scopes,rate_limit_per_minute,expires_at,created_by,
  created_by_name,created_at,last_used_at,last_used_ip,revoked_at,revoked_by,revoked_by_name,revoked_reason) ON api_keys TO kwms_app;
DROP TRIGGER IF EXISTS trg_kwms_audit ON api_keys;
CREATE TRIGGER trg_kwms_audit AFTER INSERT OR UPDATE OF name,scopes,rate_limit_per_minute,expires_at,revoked_at ON api_keys
  FOR EACH ROW EXECUTE FUNCTION kwms_audit_row();
