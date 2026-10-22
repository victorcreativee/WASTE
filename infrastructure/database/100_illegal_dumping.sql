-- Module 9: illegal dumping enforcement — dumping sites reported by residents, KCCA officers and collectors; KCCA
-- inspection, responsibility, cleanup orders with deadlines and confirmation; photo evidence; recurrence at the same place.
-- Additive and idempotent. Requires 092–099.

CREATE SEQUENCE IF NOT EXISTS dumping_site_number_seq;

CREATE TABLE IF NOT EXISTS dumping_sites(
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 site_number TEXT NOT NULL UNIQUE DEFAULT ('DS-'||to_char(CURRENT_DATE,'YYYY')||'-'||lpad(nextval('dumping_site_number_seq')::text,5,'0')),
 location GEOGRAPHY(POINT,4326) NOT NULL,
 landmark TEXT CHECK(landmark IS NULL OR length(landmark)<=300),
 division_id UUID REFERENCES kampala_divisions(id),
 status TEXT NOT NULL DEFAULT 'reported' CHECK(status IN('reported','verified','cleanup_ordered','cleanup_reported','cleared','dismissed')),
 size TEXT CHECK(size IS NULL OR size IN('small','medium','large')),
 waste_types TEXT[] NOT NULL DEFAULT '{}' CHECK(waste_types <@ ARRAY['household','commercial','construction','organic','hazardous','other']),
 hazardous BOOLEAN NOT NULL DEFAULT false,
 responsible_organization_id UUID REFERENCES organizations(id),
 responsibility_basis TEXT,
 cleanup_organization_id UUID REFERENCES organizations(id),
 cleanup_due_on DATE,
 recurrence_count INTEGER NOT NULL DEFAULT 0 CHECK(recurrence_count>=0),
 first_reported_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 last_reported_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 verified_at TIMESTAMPTZ,
 cleanup_ordered_at TIMESTAMPTZ,
 cleanup_reported_at TIMESTAMPTZ,
 cleared_at TIMESTAMPTZ,
 closed_reason TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK((responsible_organization_id IS NULL)=(responsibility_basis IS NULL)),
 CHECK(responsibility_basis IS NULL OR length(responsibility_basis)>=10),
 CHECK(status NOT IN('verified','cleanup_ordered','cleanup_reported','cleared') OR (division_id IS NOT NULL AND size IS NOT NULL)),
 CHECK(status NOT IN('cleanup_ordered','cleanup_reported') OR cleanup_due_on IS NOT NULL),
 CHECK(status<>'dismissed' OR length(closed_reason)>=5)
);
CREATE INDEX IF NOT EXISTS idx_dumping_sites_location ON dumping_sites USING GIST(location);
CREATE INDEX IF NOT EXISTS idx_dumping_sites_status ON dumping_sites(status,cleanup_due_on);
CREATE INDEX IF NOT EXISTS idx_dumping_sites_cleanup_org ON dumping_sites(cleanup_organization_id) WHERE cleanup_organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dumping_sites_responsible ON dumping_sites(responsible_organization_id) WHERE responsible_organization_id IS NOT NULL;

-- Every report of a site, whoever made it. A resident's illegal-dumping issue is linked so its status follows the site.
CREATE TABLE IF NOT EXISTS dumping_reports(
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 site_id UUID NOT NULL REFERENCES dumping_sites(id) ON DELETE CASCADE,
 source TEXT NOT NULL CHECK(source IN('resident','kcca_officer','collector')),
 reporter_user_id UUID NOT NULL REFERENCES users(id),
 reporter_organization_id UUID REFERENCES organizations(id),
 citizen_issue_id UUID UNIQUE REFERENCES citizen_issues(id) ON DELETE SET NULL,
 location GEOGRAPHY(POINT,4326) NOT NULL,
 description TEXT NOT NULL CHECK(length(description) BETWEEN 5 AND 2000),
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_dumping_reports_site ON dumping_reports(site_id,created_at);
CREATE INDEX IF NOT EXISTS idx_dumping_reports_reporter ON dumping_reports(reporter_user_id);

-- Photo evidence at each stage, stored as size-limited data URLs like collection proofs and served through the API.
CREATE TABLE IF NOT EXISTS dumping_photos(
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 site_id UUID NOT NULL REFERENCES dumping_sites(id) ON DELETE CASCADE,
 report_id UUID REFERENCES dumping_reports(id) ON DELETE CASCADE,
 stage TEXT NOT NULL CHECK(stage IN('report','inspection','cleanup','verification')),
 image_data TEXT NOT NULL CHECK(image_data ~ '^data:image/(jpeg|png|webp);base64,' AND length(image_data)<=2800000),
 uploaded_by UUID NOT NULL REFERENCES users(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_dumping_photos_site ON dumping_photos(site_id,created_at);

-- What happened to a site, in order. Rows are never changed.
CREATE TABLE IF NOT EXISTS dumping_site_history(
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 site_id UUID NOT NULL REFERENCES dumping_sites(id) ON DELETE CASCADE,
 action TEXT NOT NULL CHECK(action IN('reported','additional_report','recurred','verified','dismissed','responsibility_set','responsibility_cleared','cleanup_ordered','cleanup_reported','cleanup_rejected','cleared')),
 from_status TEXT,
 to_status TEXT NOT NULL,
 note TEXT,
 actor_user_id UUID REFERENCES users(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_dumping_history_site ON dumping_site_history(site_id,created_at);

CREATE OR REPLACE FUNCTION block_dumping_history_update() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Dumping site history cannot be changed'; END $$;
DROP TRIGGER IF EXISTS trg_block_dumping_history_update ON dumping_site_history;
CREATE TRIGGER trg_block_dumping_history_update BEFORE UPDATE ON dumping_site_history FOR EACH ROW EXECUTE FUNCTION block_dumping_history_update();

-- Status moves only along the workflow; a cleared site comes back only as a recurrence (reported again), and a dismissed
-- site stays closed (a later report there starts a new site).
CREATE OR REPLACE FUNCTION guard_dumping_site() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE allowed JSONB := '{"reported":["verified","dismissed"],"verified":["cleanup_ordered","dismissed"],"cleanup_ordered":["cleanup_reported","cleared"],"cleanup_reported":["cleared","cleanup_ordered"],"cleared":["reported"],"dismissed":[]}';
BEGIN
  IF NEW.status<>OLD.status AND NOT (allowed->OLD.status) ? NEW.status THEN
    RAISE EXCEPTION 'A site that is % cannot become %',replace(OLD.status,'_',' '),replace(NEW.status,'_',' ');
  END IF;
  IF NEW.cleanup_organization_id IS NOT NULL AND NEW.cleanup_organization_id IS DISTINCT FROM OLD.cleanup_organization_id
     AND NOT EXISTS(SELECT 1 FROM organizations WHERE id=NEW.cleanup_organization_id AND is_active AND type='waste_collection_company') THEN
    RAISE EXCEPTION 'Cleanup can be ordered from an active licensed waste collector only';
  END IF;
  IF NEW.responsible_organization_id IS NOT NULL AND NEW.responsible_organization_id IS DISTINCT FROM OLD.responsible_organization_id
     AND NOT EXISTS(SELECT 1 FROM organizations WHERE id=NEW.responsible_organization_id AND type IN('waste_collection_company','recycling_company','processing_plant')) THEN
    RAISE EXCEPTION 'Responsibility can be assigned to a licensed waste company only';
  END IF;
  NEW.updated_at := CURRENT_TIMESTAMP;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_dumping_site ON dumping_sites;
CREATE TRIGGER trg_guard_dumping_site BEFORE UPDATE ON dumping_sites FOR EACH ROW EXECUTE FUNCTION guard_dumping_site();

-- Illegal dumping notices are their own notification category.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_category_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_category_check CHECK(category IN('permit','renewal','returns','compliance','custody','disposal','dumping','system'));
ALTER TABLE notification_preferences DROP CONSTRAINT IF EXISTS notification_preferences_category_check;
ALTER TABLE notification_preferences ADD CONSTRAINT notification_preferences_category_check CHECK(category IN('permit','renewal','returns','compliance','custody','disposal','dumping','system'));
