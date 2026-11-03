-- KWMS-CN-001-2026 data governance: GPS consent at driver onboarding and retention schedules under Uganda's Data
-- Protection and Privacy Act 2019.
--
-- Drivers' phones send their position only during an active trip (fleet.repository.recordDriverLocation). From this
-- migration the database also refuses those positions unless the driver has agreed to the current GPS notice, and raw
-- positions are deleted once they are older than the retention period KCCA sets, except for trips on hold.

-- 1. Notices --------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gps_privacy_notices (
  version INTEGER PRIMARY KEY CHECK (version > 0),
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 3 AND 150),
  body TEXT NOT NULL CHECK (length(trim(body)) BETWEEN 50 AND 8000),
  change_summary TEXT,
  published_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_by UUID REFERENCES users(id),
  published_by_name TEXT
);

INSERT INTO gps_privacy_notices (version, title, body, change_summary, published_by_name) VALUES (1,
'Sharing your location during trips',
'What we collect: while you have a trip in progress, and until the load is weighed at the disposal site, the driver app sends your phone''s position about every 15 seconds: location, accuracy, speed, direction and time. Nothing is collected outside trips.

Why: to dispatch and support crews during the day, to show households when their collection is near, and to show KCCA that waste reached a licensed disposal site. Collection and disposal records are required under KCCA''s waste regulations.

Who sees it: your company''s supervisors and administrators, and KCCA officers for regulation. It is not sold or shared with anyone else.

How long: individual positions are deleted after the period KCCA sets, shown below, unless a trip is under investigation. The summary of each trip (distance, stops, disposal site visit) stays with the trip record.

Your rights under the Data Protection and Privacy Act 2019: you can see and download your location data in the driver app at any time, and you can withdraw this permission at any time. Withdrawing stops location sharing from then on; it does not delete what was already recorded. Questions or complaints go to your company administrator, or to KCCA.',
'First notice', 'KWMS') ON CONFLICT (version) DO NOTHING;

-- 2. Consent records (append-only) ----------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gps_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  organization_id UUID REFERENCES organizations(id),
  notice_version INTEGER NOT NULL REFERENCES gps_privacy_notices(version),
  decision TEXT NOT NULL CHECK (decision IN ('granted', 'declined', 'withdrawn')),
  decided_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  ip TEXT,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_gps_consents_user ON gps_consents (user_id, decided_at DESC);
CREATE INDEX IF NOT EXISTS idx_gps_consents_org ON gps_consents (organization_id, decided_at DESC);

CREATE OR REPLACE FUNCTION gps_record_immutable() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% records cannot be changed or deleted', TG_TABLE_NAME; END $$;
DROP TRIGGER IF EXISTS trg_gps_consents_immutable ON gps_consents;
CREATE TRIGGER trg_gps_consents_immutable BEFORE UPDATE OR DELETE ON gps_consents FOR EACH ROW EXECUTE FUNCTION gps_record_immutable();
DROP TRIGGER IF EXISTS trg_gps_notices_immutable ON gps_privacy_notices;
CREATE TRIGGER trg_gps_notices_immutable BEFORE UPDATE OR DELETE ON gps_privacy_notices FOR EACH ROW EXECUTE FUNCTION gps_record_immutable();

-- The latest decision counts, and only a yes to the newest notice is consent.
CREATE OR REPLACE FUNCTION gps_consent_given(p_user UUID) RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT c.decision = 'granted' AND c.notice_version = (SELECT max(version) FROM gps_privacy_notices)
                     FROM gps_consents c WHERE c.user_id = p_user ORDER BY c.decided_at DESC, c.id DESC LIMIT 1), false)
$$;

CREATE OR REPLACE FUNCTION require_gps_consent() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE driver_user UUID;
BEGIN
  IF NEW.driver_id IS NULL THEN RETURN NEW; END IF; -- a vehicle tracker with no driver attached
  SELECT user_id INTO driver_user FROM drivers WHERE id = NEW.driver_id;
  IF driver_user IS NOT NULL AND NOT gps_consent_given(driver_user) THEN
    RAISE EXCEPTION 'The driver has not agreed to share location during trips' USING ERRCODE = 'KW403';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_require_gps_consent ON vehicle_location_events;
CREATE TRIGGER trg_require_gps_consent BEFORE INSERT ON vehicle_location_events FOR EACH ROW EXECUTE FUNCTION require_gps_consent();

-- 3. Retention ------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gps_retention_settings (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  -- At least 30 days: disposal track checks look back 3 days and disputes need time to be raised.
  raw_point_days INTEGER NOT NULL DEFAULT 90 CHECK (raw_point_days BETWEEN 30 AND 730),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by UUID REFERENCES users(id),
  updated_by_name TEXT
);
INSERT INTO gps_retention_settings (id) VALUES (true) ON CONFLICT DO NOTHING;

-- A trip under investigation (a penalty, a dumping report, a dispute) keeps its positions until the hold is released.
CREATE TABLE IF NOT EXISTS gps_retention_holds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id UUID NOT NULL REFERENCES collection_routes(id),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 5 AND 500),
  placed_by UUID NOT NULL REFERENCES users(id),
  placed_by_name TEXT NOT NULL,
  placed_by_kcca BOOLEAN NOT NULL DEFAULT false,
  placed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  released_at TIMESTAMPTZ,
  released_by UUID REFERENCES users(id),
  released_by_name TEXT,
  release_note TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_gps_holds_open ON gps_retention_holds (route_id) WHERE released_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_gps_holds_org ON gps_retention_holds (organization_id, placed_at DESC);

CREATE TABLE IF NOT EXISTS gps_retention_runs (
  id BIGSERIAL PRIMARY KEY,
  ran_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  raw_point_days INTEGER NOT NULL,
  cutoff TIMESTAMPTZ NOT NULL,
  deleted_points INTEGER NOT NULL,
  held_points INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vehicle_location_recorded ON vehicle_location_events (recorded_at);
CREATE INDEX IF NOT EXISTS idx_vehicle_location_route ON vehicle_location_events (route_id) WHERE route_id IS NOT NULL;

-- Deletes one batch of positions older than the retention period that are not on hold; the caller repeats it.
CREATE OR REPLACE FUNCTION purge_expired_gps_points(p_cutoff TIMESTAMPTZ, p_batch INTEGER) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n INTEGER;
BEGIN
  DELETE FROM vehicle_location_events WHERE id IN (
    SELECT e.id FROM vehicle_location_events e
     WHERE e.recorded_at < p_cutoff
       AND NOT EXISTS (SELECT 1 FROM gps_retention_holds h WHERE h.route_id = e.route_id AND h.released_at IS NULL)
     LIMIT p_batch);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- 4. Isolation and audit (migration 113) ---------------------------------------------------------------------------
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['gps_consents', 'gps_retention_holds'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS kwms_tenant ON %I', t);
    EXECUTE format('CREATE POLICY kwms_tenant ON %I USING (organization_id IS NULL OR kwms_tenant_sees(organization_id)) WITH CHECK (organization_id IS NULL OR kwms_tenant_sees(organization_id))', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['gps_retention_settings', 'gps_retention_holds', 'gps_privacy_notices'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_kwms_audit ON %I', t);
    EXECUTE format('CREATE TRIGGER trg_kwms_audit AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION kwms_audit_row()', t);
  END LOOP;
END $$;
