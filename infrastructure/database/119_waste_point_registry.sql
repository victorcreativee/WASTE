-- KWMS module 1, waste point registry: every collection point (a household's or business's service location) gets a
-- registry number, a category (household, shop, market, school, health facility...), an estimate of the waste it
-- produces, and a field verification of its position. The registry view adds the operator, constituency, tariff tier
-- and last collection, and flags a tariff that does not fit the category. Additive and idempotent. Requires 112, 118.

ALTER TABLE customer_service_locations
  ADD COLUMN IF NOT EXISTS point_number TEXT,
  ADD COLUMN IF NOT EXISTS point_category TEXT,
  ADD COLUMN IF NOT EXISTS estimated_kg_week NUMERIC(10,1),
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verified_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS verified_by_name TEXT,
  ADD COLUMN IF NOT EXISTS verification_accuracy_m NUMERIC(7,1),
  ADD COLUMN IF NOT EXISTS verification_moved_m NUMERIC(9,1),
  ADD COLUMN IF NOT EXISTS verification_note TEXT;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='waste_point_category') THEN
    ALTER TABLE customer_service_locations ADD CONSTRAINT waste_point_category CHECK(point_category IS NULL OR point_category IN(
      'household','shop','market_stall','market','restaurant','hotel','office','school','health_facility','place_of_worship',
      'government','factory','construction','other'));
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='waste_point_estimate') THEN
    ALTER TABLE customer_service_locations ADD CONSTRAINT waste_point_estimate CHECK(estimated_kg_week IS NULL OR estimated_kg_week BETWEEN 0 AND 1000000);
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='waste_point_verification') THEN
    ALTER TABLE customer_service_locations ADD CONSTRAINT waste_point_verification CHECK(verified_at IS NULL OR (verified_by IS NOT NULL AND verification_accuracy_m IS NOT NULL));
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS waste_point_number ON customer_service_locations(point_number) WHERE point_number IS NOT NULL;

-- The customer type a category is normally billed as; NULL accepts any.
CREATE OR REPLACE FUNCTION waste_point_customer_type(p_category TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_category='household' THEN 'residential'
    WHEN p_category IN('shop','market_stall','market','restaurant','hotel') THEN 'commercial'
    WHEN p_category IN('office','school','health_facility','place_of_worship','government') THEN 'office_business'
    WHEN p_category IN('factory','construction') THEN 'industrial'
  END
$$;

-- Registry numbers: KWP-<division>-<sequence>, given once and never reused.
CREATE SEQUENCE IF NOT EXISTS waste_point_seq;
CREATE OR REPLACE FUNCTION waste_point_number(p_division UUID) RETURNS TEXT LANGUAGE sql VOLATILE AS $$
  SELECT 'KWP-'||coalesce((SELECT upper(left(code,3)) FROM kampala_divisions WHERE id=p_division),'KLA')||'-'||lpad(nextval('waste_point_seq')::text,6,'0')
$$;

CREATE OR REPLACE FUNCTION prepare_waste_point() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.point_number IS NULL THEN
    NEW.point_number:=waste_point_number(coalesce(NEW.division_id,(SELECT division_id FROM kampala_division_areas WHERE id=NEW.catalog_area_id)));
  END IF;
  IF NEW.point_category IS NULL THEN
    NEW.point_category:=CASE (SELECT customer_type FROM customer_profiles WHERE id=NEW.customer_id)
      WHEN 'residential' THEN 'household' WHEN 'industrial' THEN 'factory' WHEN 'office_business' THEN 'office' ELSE NULL END;
  END IF;
  -- A position moved by more than 50 m outside a field verification is no longer verified.
  IF TG_OP='UPDATE' AND OLD.verified_at IS NOT NULL AND NEW.verified_at IS NOT DISTINCT FROM OLD.verified_at
     AND NEW.location IS NOT NULL AND OLD.location IS NOT NULL AND ST_Distance(NEW.location,OLD.location)>50 THEN
    NEW.verified_at:=NULL; NEW.verified_by:=NULL; NEW.verified_by_name:=NULL; NEW.verification_accuracy_m:=NULL;
    NEW.verification_moved_m:=NULL; NEW.verification_note:=NULL;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_prepare_waste_point ON customer_service_locations;
CREATE TRIGGER trg_prepare_waste_point BEFORE INSERT OR UPDATE ON customer_service_locations FOR EACH ROW EXECUTE FUNCTION prepare_waste_point();

-- Existing points get a number (oldest first) and a category from the customer type.
DO $$ DECLARE r RECORD; BEGIN
  FOR r IN SELECT id FROM customer_service_locations WHERE point_number IS NULL ORDER BY created_at,id LOOP
    UPDATE customer_service_locations SET point_number=NULL WHERE id=r.id;
  END LOOP;
END $$;

-- The registry: every point with its operator, place, tariff and last collection, and what needs attention.
CREATE OR REPLACE VIEW waste_point_registry WITH (security_invoker=true) AS
SELECT l.id,l.point_number,l.point_category,l.estimated_kg_week,l.label,l.address,
  ST_Y(l.location::geometry) AS latitude,ST_X(l.location::geometry) AS longitude,l.location_precise,
  l.verified_at,l.verified_by_name,l.verification_accuracy_m,l.verification_moved_m,l.verification_note,
  l.customer_id,u.full_name AS customer_name,u.phone AS customer_phone,cp.customer_type,cp.service_status,
  coalesce(rel.organization_id,l.organization_id) AS organization_id,o.name AS organization_name,
  l.division_id,d.name AS division,l.catalog_area_id,a.name AS area,c.id AS constituency_id,c.name AS constituency,
  plan.name AS plan_name,plan.customer_type AS plan_customer_type,band.code AS tariff_band,band.name AS tariff_band_name,
  waste_point_customer_type(l.point_category) AS expected_customer_type,
  (plan.customer_type IS NOT NULL AND waste_point_customer_type(l.point_category) IS NOT NULL
    AND plan.customer_type<>waste_point_customer_type(l.point_category)) AS tariff_mismatch,
  last.completed_at AS last_collected_at,
  l.created_at
FROM customer_service_locations l
JOIN customer_profiles cp ON cp.id=l.customer_id
JOIN users u ON u.id=cp.user_id
LEFT JOIN LATERAL(SELECT r.organization_id FROM customer_service_relationships r WHERE r.service_location_id=l.id AND r.status='active'
  ORDER BY r.created_at DESC LIMIT 1) rel ON true
LEFT JOIN organizations o ON o.id=coalesce(rel.organization_id,l.organization_id)
LEFT JOIN kampala_division_areas a ON a.id=l.catalog_area_id
LEFT JOIN kampala_divisions d ON d.id=coalesce(l.division_id,a.division_id)
LEFT JOIN kampala_constituencies c ON c.id=a.constituency_id
LEFT JOIN LATERAL(SELECT p.name,p.customer_type,p.tariff_band_id FROM customer_subscriptions s JOIN service_plans p ON p.id=s.plan_id
  WHERE s.service_location_id=l.id AND s.status='active' ORDER BY s.created_at DESC LIMIT 1) plan ON true
LEFT JOIN kcca_tariff_bands band ON band.id=plan.tariff_band_id
LEFT JOIN LATERAL(SELECT max(s.completed_at) AS completed_at FROM customer_collection_stops s WHERE s.service_location_id=l.id AND s.status='completed') last ON true;
