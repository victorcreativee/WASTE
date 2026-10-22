-- Module 2: KCCA recycling oversight and recycling-company licensing.
-- Additive and idempotent. Requires 092 (permit lifecycle).

-- 1. Permit checks now cover recycling companies too. The two-argument form keeps Module 1 callers working.
CREATE OR REPLACE FUNCTION organization_permit_block_reason(p_organization_id UUID,p_activities TEXT[],p_blocked_action TEXT) RETURNS TEXT LANGUAGE plpgsql STABLE AS $$
DECLARE org_type TEXT; latest RECORD; activity_names TEXT;
BEGIN
  SELECT type INTO org_type FROM organizations WHERE id=p_organization_id;
  IF org_type IS NULL OR org_type NOT IN('waste_collection_company','recycling_company') THEN RETURN NULL; END IF;
  IF EXISTS(
    SELECT 1 FROM organization_permit_applications p JOIN organization_permit_activities a ON a.permit_application_id=p.id
    WHERE p.organization_id=p_organization_id AND p.status='approved' AND (p.valid_until IS NULL OR p.valid_until>=CURRENT_DATE)
      AND a.activity_code=ANY(p_activities)
  ) THEN RETURN NULL; END IF;
  -- Transitional rule: organizations with no permit on record are listed for KCCA but not blocked.
  SELECT p.permit_number,p.status,p.valid_until INTO latest FROM organization_permit_applications p
  WHERE p.organization_id=p_organization_id AND p.permit_number IS NOT NULL
  ORDER BY (p.status='approved') DESC,p.valid_until DESC NULLS LAST,p.created_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF latest.status='suspended' THEN
    RETURN 'KCCA permit '||latest.permit_number||' is suspended. '||p_blocked_action||' until KCCA reinstates it.';
  END IF;
  IF latest.status='expired' OR (latest.valid_until IS NOT NULL AND latest.valid_until<CURRENT_DATE) THEN
    RETURN 'KCCA permit '||latest.permit_number||' expired on '||to_char(latest.valid_until,'DD Mon YYYY')||'. '||p_blocked_action||' until KCCA renews it.';
  END IF;
  SELECT string_agg(lower(name),' or ' ORDER BY sort_order) INTO activity_names FROM permit_activity_types WHERE code=ANY(p_activities);
  RETURN 'KCCA permit '||latest.permit_number||' does not authorize '||COALESCE(activity_names,array_to_string(p_activities,' or '))||'. Ask KCCA to add it to your permit.';
END $$;

CREATE OR REPLACE FUNCTION organization_permit_block_reason(p_organization_id UUID,p_activities TEXT[]) RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT organization_permit_block_reason(p_organization_id,p_activities,'Routes cannot be planned or dispatched')
$$;

-- 1b. Permits created already approved (issued directly by KCCA) get their certificate date and verification code too;
-- the 038/092 trigger only covers updates.
CREATE OR REPLACE FUNCTION record_permit_certificate_on_insert() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status='approved' AND NEW.permit_number IS NOT NULL THEN
    NEW.certificate_issued_at := COALESCE(NEW.certificate_issued_at,CURRENT_TIMESTAMP);
  END IF;
  IF NEW.permit_number IS NOT NULL AND NEW.verification_code IS NULL THEN
    NEW.verification_code := new_permit_verification_code();
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_permit_certificate_on_insert ON organization_permit_applications;
CREATE TRIGGER trg_permit_certificate_on_insert BEFORE INSERT ON organization_permit_applications
FOR EACH ROW EXECUTE FUNCTION record_permit_certificate_on_insert();

-- 2. Recording new purchases and sales requires a permit that covers them.
CREATE OR REPLACE FUNCTION enforce_recycling_permit() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE reason TEXT;
BEGIN
  IF TG_TABLE_NAME='recycling_material_lots' THEN
    IF NEW.origin IS DISTINCT FROM 'purchase' THEN RETURN NEW; END IF;
    reason := organization_permit_block_reason(NEW.organization_id,ARRAY['recyclables_collection'],'New material purchases cannot be recorded');
  ELSE
    reason := organization_permit_block_reason(NEW.organization_id,ARRAY['recyclables_trading','recycling_processing'],'New material sales cannot be recorded');
  END IF;
  IF reason IS NOT NULL THEN RAISE EXCEPTION '%',reason USING ERRCODE='P0001'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_recycling_lot_permit ON recycling_material_lots;
CREATE TRIGGER trg_recycling_lot_permit BEFORE INSERT ON recycling_material_lots FOR EACH ROW EXECUTE FUNCTION enforce_recycling_permit();
DROP TRIGGER IF EXISTS trg_recycling_sale_permit ON recycling_material_sales;
CREATE TRIGGER trg_recycling_sale_permit BEFORE INSERT ON recycling_material_sales FOR EACH ROW EXECUTE FUNCTION enforce_recycling_permit();

-- 3. Expiry notices describe what actually stops for each kind of organization.
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
    SELECT l.id,l.organization_id,'expired',l.valid_until,'Permit '||l.permit_number||' expired on '||to_char(l.valid_until,'DD Mon YYYY')||'. '||
      CASE WHEN o.type='recycling_company' THEN 'New material purchases and sales cannot be recorded' ELSE 'New collection routes cannot be planned or dispatched' END||' until KCCA renews it.'
    FROM lapsed l LEFT JOIN organizations o ON o.id=l.organization_id ON CONFLICT DO NOTHING
  )
  SELECT count(*) INTO expired_count FROM lapsed;
  RETURN expired_count;
END $$;

-- 4. KCCA can raise compliance cases about recycling operations.
ALTER TABLE collector_compliance_cases DROP CONSTRAINT IF EXISTS collector_compliance_cases_category_check;
ALTER TABLE collector_compliance_cases ADD CONSTRAINT collector_compliance_cases_category_check
  CHECK(category IN('permit','service_delivery','weighbridge','customer_service','fleet_safety','recycling_operations','other'));

-- 5. City-wide period queries (the existing indexes lead on organization).
CREATE INDEX IF NOT EXISTS idx_recycling_lots_collected_on ON recycling_material_lots(collected_on) WHERE origin='purchase' AND status<>'rejected';
CREATE INDEX IF NOT EXISTS idx_recycling_sales_sold_on ON recycling_material_sales(sold_on);
CREATE INDEX IF NOT EXISTS idx_recycling_sorting_processed_on ON recycling_sorting_batches(processed_on);
CREATE INDEX IF NOT EXISTS idx_weighbridge_completed_date ON weighbridge_transactions(operation_date) WHERE status='completed';
