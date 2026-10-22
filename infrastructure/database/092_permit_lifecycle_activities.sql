-- Module 1: KCCA permit lifecycle and authorized activities.
-- Additive and idempotent. Existing permits keep their status, dates and numbers.

-- 1. Catalogue of activities KCCA can authorize on a permit.
CREATE TABLE IF NOT EXISTS permit_activity_types(
 code TEXT PRIMARY KEY CHECK(code ~ '^[a-z_]{3,60}$'),
 name TEXT NOT NULL,
 description TEXT NOT NULL,
 organization_type TEXT NOT NULL CHECK(organization_type IN('waste_collection_company','recycling_company')),
 sort_order INTEGER NOT NULL DEFAULT 0,
 is_active BOOLEAN NOT NULL DEFAULT true
);
INSERT INTO permit_activity_types(code,name,description,organization_type,sort_order) VALUES
 ('household_collection','Household collection','Scheduled collection from residential premises.','waste_collection_company',10),
 ('commercial_collection','Commercial and institutional collection','Collection from businesses, markets, schools and institutions.','waste_collection_company',20),
 ('waste_transport','Transport to disposal site','Haulage of collected waste to a KCCA-approved disposal or transfer site.','waste_collection_company',30),
 ('bulky_waste','Bulky and construction waste','Collection of bulky items, garden waste and construction debris.','waste_collection_company',40),
 ('recyclables_collection','Recyclable material collection','Buying or collecting recyclable materials from households and businesses.','recycling_company',110),
 ('recyclables_trading','Recyclable material trading','Aggregating and selling recyclable materials to processors.','recycling_company',120),
 ('recycling_processing','Recycling and processing','Sorting, baling or processing recyclable materials at a facility.','recycling_company',130)
ON CONFLICT(code) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,organization_type=EXCLUDED.organization_type,sort_order=EXCLUDED.sort_order;

-- 2. Activities granted on each permit.
CREATE TABLE IF NOT EXISTS organization_permit_activities(
 permit_application_id UUID NOT NULL REFERENCES organization_permit_applications(id) ON DELETE CASCADE,
 activity_code TEXT NOT NULL REFERENCES permit_activity_types(code),
 granted_by UUID REFERENCES users(id),
 granted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(permit_application_id,activity_code)
);

-- Permits issued before activities existed were collection permits: record that scope explicitly once.
WITH legacy AS (
 SELECT p.id,p.status FROM organization_permit_applications p
 WHERE p.permit_number IS NOT NULL
   AND NOT EXISTS(SELECT 1 FROM organization_permit_activities a WHERE a.permit_application_id=p.id)
), granted AS (
 INSERT INTO organization_permit_activities(permit_application_id,activity_code)
 SELECT legacy.id,code FROM legacy CROSS JOIN unnest(ARRAY['household_collection','commercial_collection','waste_transport']) code
 ON CONFLICT DO NOTHING RETURNING permit_application_id
)
INSERT INTO organization_permit_history(application_id,previous_status,new_status,notes)
SELECT DISTINCT legacy.id,legacy.status,legacy.status,'Authorized activities recorded from the original collection permit scope: household collection, commercial collection, transport to disposal site.'
FROM legacy JOIN granted ON granted.permit_application_id=legacy.id;

-- 3. Public verification code and lifecycle timestamps.
ALTER TABLE organization_permit_applications
 ADD COLUMN IF NOT EXISTS verification_code TEXT,
 ADD COLUMN IF NOT EXISTS expired_at TIMESTAMPTZ,
 ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS idx_permit_verification_code ON organization_permit_applications(verification_code) WHERE verification_code IS NOT NULL;

CREATE OR REPLACE FUNCTION new_permit_verification_code() RETURNS TEXT LANGUAGE sql VOLATILE AS $$
 SELECT regexp_replace(upper(substr(md5(random()::text||clock_timestamp()::text),1,12)),'(.{4})(.{4})(.{4})','\1-\2-\3')
$$;

UPDATE organization_permit_applications SET verification_code=new_permit_verification_code()
WHERE permit_number IS NOT NULL AND verification_code IS NULL;

CREATE OR REPLACE FUNCTION record_permit_certificate_issuance()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'approved' AND NEW.permit_number IS NOT NULL
     AND (OLD.status IS DISTINCT FROM 'approved' OR NEW.permit_number IS DISTINCT FROM OLD.permit_number) THEN
    NEW.certificate_issued_at = CURRENT_TIMESTAMP;
  END IF;
  IF NEW.permit_number IS NOT NULL AND NEW.verification_code IS NULL THEN
    NEW.verification_code = new_permit_verification_code();
  END IF;
  RETURN NEW;
END $$;

-- 4. Division authorizations suspended because their permit was suspended (so reinstatement restores only those).
ALTER TABLE organization_division_authorizations ADD COLUMN IF NOT EXISTS suspended_by_permit BOOLEAN NOT NULL DEFAULT false;

-- 5. Renewal requests submitted by licensed companies.
CREATE TABLE IF NOT EXISTS permit_renewal_requests(
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 request_number TEXT UNIQUE NOT NULL,
 permit_application_id UUID NOT NULL REFERENCES organization_permit_applications(id) ON DELETE CASCADE,
 organization_id UUID NOT NULL REFERENCES organizations(id),
 requested_by UUID NOT NULL REFERENCES users(id),
 requested_valid_until DATE NOT NULL,
 statement TEXT NOT NULL,
 evidence_file_name TEXT,
 evidence_mime_type TEXT,
 evidence_data_url TEXT,
 status TEXT NOT NULL DEFAULT 'submitted' CHECK(status IN('submitted','approved','rejected','withdrawn')),
 review_notes TEXT,
 reviewed_by UUID REFERENCES users(id),
 reviewed_at TIMESTAMPTZ,
 granted_valid_until DATE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK(status<>'approved' OR granted_valid_until IS NOT NULL),
 CHECK((evidence_data_url IS NULL)=(evidence_file_name IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS one_open_renewal_per_permit ON permit_renewal_requests(permit_application_id) WHERE status='submitted';
CREATE INDEX IF NOT EXISTS idx_permit_renewals_status ON permit_renewal_requests(status,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_permit_renewals_organization ON permit_renewal_requests(organization_id,created_at DESC);

-- 6. Lifecycle notices: expiry reminders and status changes the company must see.
CREATE TABLE IF NOT EXISTS permit_lifecycle_notices(
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 permit_application_id UUID NOT NULL REFERENCES organization_permit_applications(id) ON DELETE CASCADE,
 organization_id UUID REFERENCES organizations(id),
 notice_type TEXT NOT NULL CHECK(notice_type IN('expiry_60','expiry_30','expiry_7','expired','suspended','reinstated','renewed','renewal_rejected')),
 valid_until DATE,
 message TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 acknowledged_at TIMESTAMPTZ,
 acknowledged_by UUID REFERENCES users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_expiry_notice_per_validity ON permit_lifecycle_notices(permit_application_id,notice_type,valid_until)
 WHERE notice_type IN('expiry_60','expiry_30','expiry_7','expired');
CREATE INDEX IF NOT EXISTS idx_permit_notices_organization ON permit_lifecycle_notices(organization_id,created_at DESC);

-- 7. Expire permits whose validity has ended. Returns the number expired. Safe to run repeatedly.
CREATE OR REPLACE FUNCTION expire_lapsed_permits() RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE expired_count INTEGER;
BEGIN
  WITH lapsed AS (
    UPDATE organization_permit_applications
    SET status='expired',expired_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
    WHERE status='approved' AND valid_until IS NOT NULL AND valid_until<CURRENT_DATE
    RETURNING id,organization_id,valid_until,permit_number
  ), history AS (
    INSERT INTO organization_permit_history(application_id,previous_status,new_status,notes)
    SELECT id,'approved','expired','Validity ended on '||to_char(valid_until,'DD Mon YYYY')||'. Expired automatically.' FROM lapsed
  ), authorizations AS (
    UPDATE organization_division_authorizations SET status='expired'
    WHERE permit_application_id IN(SELECT id FROM lapsed) AND status='active'
  ), notices AS (
    INSERT INTO permit_lifecycle_notices(permit_application_id,organization_id,notice_type,valid_until,message)
    SELECT id,organization_id,'expired',valid_until,'Permit '||permit_number||' expired on '||to_char(valid_until,'DD Mon YYYY')||'. New collection routes cannot be planned or dispatched until KCCA renews it.'
    FROM lapsed ON CONFLICT DO NOTHING
  )
  SELECT count(*) INTO expired_count FROM lapsed;
  RETURN expired_count;
END $$;

-- 8. Issue the tightest applicable reminder (60, 30 or 7 days) once per validity period.
CREATE OR REPLACE FUNCTION issue_permit_expiry_reminders() RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE issued INTEGER;
BEGIN
  WITH due AS (
    SELECT id,organization_id,valid_until,permit_number,valid_until-CURRENT_DATE days_left
    FROM organization_permit_applications
    WHERE status='approved' AND valid_until IS NOT NULL AND valid_until>=CURRENT_DATE AND valid_until-CURRENT_DATE<=60
  ), inserted AS (
    INSERT INTO permit_lifecycle_notices(permit_application_id,organization_id,notice_type,valid_until,message)
    SELECT id,organization_id,
      CASE WHEN days_left<=7 THEN 'expiry_7' WHEN days_left<=30 THEN 'expiry_30' ELSE 'expiry_60' END,
      valid_until,
      'Permit '||permit_number||' expires on '||to_char(valid_until,'DD Mon YYYY')||' ('||days_left||CASE WHEN days_left=1 THEN ' day' ELSE ' days' END||' left). Submit a renewal request so KCCA can review it in time.'
    FROM due ON CONFLICT DO NOTHING RETURNING id
  )
  SELECT count(*) INTO issued FROM inserted;
  RETURN issued;
END $$;

-- 9. Why an organization may not carry out an activity right now (NULL = allowed).
-- Transitional rule: collectors with no permit on record (created before permits existed) are not blocked;
-- KCCA sees them in the "no permit on record" list until a permit is linked.
CREATE OR REPLACE FUNCTION organization_permit_block_reason(p_organization_id UUID,p_activities TEXT[]) RETURNS TEXT LANGUAGE plpgsql STABLE AS $$
DECLARE org_type TEXT; latest RECORD;
BEGIN
  SELECT type INTO org_type FROM organizations WHERE id=p_organization_id;
  IF org_type IS DISTINCT FROM 'waste_collection_company' THEN RETURN NULL; END IF;
  IF EXISTS(
    SELECT 1 FROM organization_permit_applications p JOIN organization_permit_activities a ON a.permit_application_id=p.id
    WHERE p.organization_id=p_organization_id AND p.status='approved' AND (p.valid_until IS NULL OR p.valid_until>=CURRENT_DATE)
      AND a.activity_code=ANY(p_activities)
  ) THEN RETURN NULL; END IF;
  SELECT p.permit_number,p.status,p.valid_until INTO latest FROM organization_permit_applications p
  WHERE p.organization_id=p_organization_id AND p.permit_number IS NOT NULL
  ORDER BY (p.status='approved') DESC,p.valid_until DESC NULLS LAST,p.created_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF latest.status='suspended' THEN
    RETURN 'KCCA permit '||latest.permit_number||' is suspended. Routes cannot be planned or dispatched until KCCA reinstates it.';
  END IF;
  IF latest.status='expired' OR (latest.valid_until IS NOT NULL AND latest.valid_until<CURRENT_DATE) THEN
    RETURN 'KCCA permit '||latest.permit_number||' expired on '||to_char(latest.valid_until,'DD Mon YYYY')||'. Request a renewal before planning or dispatching routes.';
  END IF;
  RETURN 'KCCA permit '||latest.permit_number||' does not authorize this activity ('||array_to_string(p_activities,' or ')||').';
END $$;

-- 10. Enforce at the database so every path (routes, trips, dispatch) obeys the permit.
CREATE OR REPLACE FUNCTION enforce_collection_route_permit() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE reason TEXT;
BEGIN
  IF (TG_OP='INSERT' AND NEW.status IN('planned','dispatched'))
     OR (TG_OP='UPDATE' AND NEW.status='dispatched' AND OLD.status IS DISTINCT FROM 'dispatched') THEN
    reason := organization_permit_block_reason(NEW.organization_id,ARRAY['household_collection','commercial_collection']);
    IF reason IS NOT NULL THEN RAISE EXCEPTION '%',reason USING ERRCODE='P0001'; END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_collection_route_permit ON collection_routes;
CREATE TRIGGER trg_collection_route_permit BEFORE INSERT OR UPDATE OF status ON collection_routes
FOR EACH ROW EXECUTE FUNCTION enforce_collection_route_permit();

-- 11. Permit history must stay an audit trail.
CREATE OR REPLACE FUNCTION prevent_permit_history_change() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Permit history cannot be changed or deleted' USING ERRCODE='P0001'; END $$;
DROP TRIGGER IF EXISTS trg_permit_history_immutable ON organization_permit_history;
CREATE TRIGGER trg_permit_history_immutable BEFORE UPDATE OR DELETE ON organization_permit_history
FOR EACH ROW WHEN (pg_trigger_depth()=0) EXECUTE FUNCTION prevent_permit_history_change();
