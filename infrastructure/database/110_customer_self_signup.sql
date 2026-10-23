-- Customers (households, offices, shops) can create their own account, see which collection companies serve where
-- they are, and ask one to serve them. The company accepts or declines from its customer requests (027). Companies can
-- still register customers themselves. Requires 027, 044, 098 and 108.

-- Where a self-registered customer is: the division and area they chose, and whether the map point is their real
-- position (shared from the phone) or only a stand-in until the company assigns a zone.
ALTER TABLE customer_service_locations ADD COLUMN IF NOT EXISTS division_id UUID REFERENCES kampala_divisions(id);
ALTER TABLE customer_service_locations ADD COLUMN IF NOT EXISTS catalog_area_id UUID REFERENCES kampala_division_areas(id);
ALTER TABLE customer_service_locations ADD COLUMN IF NOT EXISTS location_precise BOOLEAN NOT NULL DEFAULT true;

-- A general complaint about the service, next to missed collections and extra pickups.
ALTER TABLE citizen_issues DROP CONSTRAINT IF EXISTS citizen_issues_category_check;
ALTER TABLE citizen_issues ADD CONSTRAINT citizen_issues_category_check
  CHECK (category IN ('illegal_dumping','missed_collection','overflowing_bin','pickup_request','service_complaint'));
-- KCCA sets the response time for complaints like the other resident issues (091); it starts at that of a pickup request.
DO $$
BEGIN
  IF to_regclass('public.kcca_service_standards') IS NOT NULL THEN
    ALTER TABLE kcca_service_standards DROP CONSTRAINT IF EXISTS kcca_service_standards_issue_category_check;
    ALTER TABLE kcca_service_standards ADD CONSTRAINT kcca_service_standards_issue_category_check
      CHECK (issue_category IN ('illegal_dumping','missed_collection','overflowing_bin','pickup_request','service_complaint'));
    INSERT INTO kcca_service_standards (issue_category, response_hours) VALUES ('service_complaint', 72)
    ON CONFLICT (issue_category) DO NOTHING;
  END IF;
END $$;

-- Collection companies that serve a place, best match first, with the zone a company would serve it from:
--   1 'location'  a zone drawn on the map covers the customer's exact position,
--   2 'area'      the company has a zone for the customer's area (for example Ntinda),
--   3 'division'  the company has a zone in, or a KCCA authorisation for, the customer's division.
CREATE OR REPLACE FUNCTION recommended_collectors(p_division_id UUID, p_area_id UUID, p_point GEOGRAPHY, p_precise BOOLEAN)
RETURNS TABLE (organization_id UUID, zone_id UUID, match TEXT, rank INTEGER) LANGUAGE sql STABLE AS $$
  SELECT DISTINCT ON (candidate.organization_id) candidate.organization_id, candidate.zone_id, candidate.match, candidate.rank
    FROM (
      SELECT z.organization_id, z.id AS zone_id, 'location'::text AS match, 1 AS rank, 0::float AS distance
        FROM waste_zones z
       WHERE p_precise AND p_point IS NOT NULL AND z.is_active AND z.boundary IS NOT NULL AND ST_Covers(z.boundary, p_point::geometry)
      UNION ALL
      SELECT z.organization_id, z.id, 'area', 2, 0
        FROM waste_zones z WHERE p_area_id IS NOT NULL AND z.is_active AND z.catalog_area_id = p_area_id
      UNION ALL
      SELECT z.organization_id, z.id, 'division', 3,
             CASE WHEN p_precise AND p_point IS NOT NULL AND z.center_point IS NOT NULL THEN ST_Distance(z.center_point, p_point) ELSE 0 END
        FROM waste_zones z WHERE p_division_id IS NOT NULL AND z.is_active AND z.division_id = p_division_id
      UNION ALL
      SELECT a.organization_id, NULL::uuid, 'division', 3, 1e12
        FROM organization_division_authorizations a
       WHERE p_division_id IS NOT NULL AND a.division_id = p_division_id AND a.status = 'active'
         AND (a.expires_on IS NULL OR a.expires_on >= CURRENT_DATE)
    ) candidate
    JOIN organizations o ON o.id = candidate.organization_id AND o.type = 'waste_collection_company' AND o.is_active
   ORDER BY candidate.organization_id, candidate.rank, candidate.distance;
$$;

-- The company hears about a new request at once; the customer hears the decision on their page.
CREATE OR REPLACE FUNCTION notify_customer_provider_request() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE who TEXT; company TEXT;
BEGIN
  SELECT u.full_name INTO who FROM customer_profiles cp JOIN users u ON u.id = cp.user_id WHERE cp.id = NEW.customer_id;
  company := household_company_name(NEW.requested_organization_id);
  IF NEW.status = 'pending_new_provider' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'pending_new_provider') THEN
    PERFORM notify_organization(NEW.requested_organization_id, ARRAY['company_admin'], 'system', 'info',
      'New customer request', COALESCE(who, 'A customer') || ' asks your company to collect their waste. Review it under Customers.',
      '/dashboard/customer-service', 'provider-request:' || NEW.id);
  ELSIF TG_OP = 'UPDATE' AND NEW.status IN ('approved','rejected') AND OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM notify_household(NEW.customer_id, NEW.requested_organization_id, 'service_request',
      CASE WHEN NEW.status = 'approved' THEN 'Request accepted' ELSE 'Request declined' END,
      CASE WHEN NEW.status = 'approved'
           THEN company || ' accepted your request and will collect your waste. Your collection days appear here once set.'
           ELSE company || ' cannot serve you at the moment.' || COALESCE(' ' || NULLIF(left(NEW.review_note, 160), ''), '') || ' You can choose another company.' END,
      'provider-request-' || NEW.status || ':' || NEW.id);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_notify_customer_provider_request ON customer_provider_requests;
CREATE TRIGGER trg_notify_customer_provider_request AFTER INSERT OR UPDATE OF status ON customer_provider_requests
  FOR EACH ROW EXECUTE FUNCTION notify_customer_provider_request();
