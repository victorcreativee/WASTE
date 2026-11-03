-- KWMS module 2: GPS trackers fitted to trucks, alongside the driver's phone. A company registers a tracker against one
-- of its trucks and gets a device key once; the tracker (or a gateway in front of it) sends positions with that key.
-- A position is kept only when it falls inside one of the truck's trips (from the start until the load is weighed,
-- at most six hours after completion), and it is filed under that trip and its driver. The driver's consent of 114
-- still applies: a tracker cannot record a driver who has not agreed to the location notice, including a driver with no
-- app account, who has had no way to agree. A trip with no driver assigned is recorded. Positions outside a trip
-- are dropped and only counted, so a truck parked overnight is not tracked.
-- Trackers buffer positions when they lose signal; buffered positions up to 24 hours old are accepted, which fills
-- the gaps counted in 120.
-- Additive and idempotent. Requires 113, 114, 120.

CREATE TABLE IF NOT EXISTS vehicle_trackers(
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 organization_id UUID NOT NULL REFERENCES organizations(id),
 truck_id UUID NOT NULL REFERENCES waste_trucks(id),
 label TEXT NOT NULL CHECK(length(label) BETWEEN 2 AND 80),
 serial_number TEXT CHECK(serial_number IS NULL OR length(serial_number) BETWEEN 3 AND 40),
 key_prefix TEXT NOT NULL UNIQUE CHECK(key_prefix ~ '^[a-z0-9]{8}$'),
 secret_hash TEXT NOT NULL CHECK(secret_hash ~ '^[0-9a-f]{64}$'),
 created_by UUID REFERENCES users(id),
 created_by_name TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 last_seen_at TIMESTAMPTZ,
 last_ip TEXT,
 last_result TEXT,
 retired_at TIMESTAMPTZ,
 retired_by UUID REFERENCES users(id),
 retired_by_name TEXT,
 retired_reason TEXT,
 CHECK(retired_at IS NULL OR (retired_by IS NOT NULL AND length(retired_reason)>=5))
);
-- One working tracker per truck.
CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicle_trackers_truck ON vehicle_trackers(truck_id) WHERE retired_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_vehicle_trackers_org ON vehicle_trackers(organization_id,created_at DESC);

-- What happened to the positions each tracker sent, per Kampala day.
CREATE TABLE IF NOT EXISTS vehicle_tracker_daily(
 tracker_id UUID NOT NULL REFERENCES vehicle_trackers(id) ON DELETE CASCADE,
 organization_id UUID NOT NULL REFERENCES organizations(id),
 day DATE NOT NULL,
 stored INT NOT NULL DEFAULT 0,
 no_trip INT NOT NULL DEFAULT 0,
 no_consent INT NOT NULL DEFAULT 0,
 duplicate INT NOT NULL DEFAULT 0,
 rejected INT NOT NULL DEFAULT 0,
 PRIMARY KEY(tracker_id,day)
);

-- The tracker must belong to the truck's company.
CREATE OR REPLACE FUNCTION check_vehicle_tracker() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM waste_trucks t WHERE t.id=NEW.truck_id AND t.organization_id=NEW.organization_id) THEN
    RAISE EXCEPTION 'The truck does not belong to this company' USING ERRCODE='KW400';
  END IF;
  IF TG_OP='UPDATE' AND (NEW.truck_id<>OLD.truck_id OR NEW.key_prefix<>OLD.key_prefix OR NEW.secret_hash<>OLD.secret_hash) THEN
    RAISE EXCEPTION 'A tracker cannot be moved or rekeyed; retire it and register a new one' USING ERRCODE='KW409';
  END IF;
  IF TG_OP='UPDATE' AND OLD.retired_at IS NOT NULL AND NEW.retired_at IS NULL THEN
    RAISE EXCEPTION 'A retired tracker cannot be brought back' USING ERRCODE='KW409';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_check_vehicle_tracker ON vehicle_trackers;
CREATE TRIGGER trg_check_vehicle_tracker BEFORE INSERT OR UPDATE ON vehicle_trackers FOR EACH ROW EXECUTE FUNCTION check_vehicle_tracker();

-- Files one position from a tracker. The key is checked here, so the app never reads key hashes. Returns what was done:
--   stored, duplicate (within 10 seconds of a position already kept for the truck), no_trip, no_consent,
--   rejected (outside Greater Kampala, in the future or older than 24 hours), unknown_key.
CREATE OR REPLACE FUNCTION kwms_record_tracker_position(p_prefix TEXT,p_secret_hash TEXT,p_ip TEXT,p_recorded_at TIMESTAMPTZ,
  p_latitude NUMERIC,p_longitude NUMERIC,p_accuracy_m NUMERIC,p_speed_kph NUMERIC,p_heading NUMERIC)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE k RECORD; trip RECORD; result TEXT; today DATE:=(now() AT TIME ZONE 'Africa/Kampala')::date;
BEGIN
  SELECT v.id,v.organization_id,v.truck_id INTO k FROM vehicle_trackers v JOIN organizations o ON o.id=v.organization_id
    WHERE v.key_prefix=p_prefix AND v.secret_hash=p_secret_hash AND v.retired_at IS NULL AND o.is_active;
  IF NOT FOUND THEN RETURN 'unknown_key'; END IF;

  IF p_recorded_at>now()+interval '2 minutes' OR p_recorded_at<now()-interval '24 hours'
     OR p_latitude NOT BETWEEN -0.10 AND 0.75 OR p_longitude NOT BETWEEN 32.20 AND 33.00 THEN
    result:='rejected';
  ELSE
    -- The truck's trip at that moment: from its start until the load is weighed, at most six hours after completion.
    SELECT r.id,r.driver_id INTO trip FROM collection_routes r
      LEFT JOIN LATERAL(SELECT min(w.arrival_at) weighed FROM weighbridge_transactions w WHERE w.trip_id=r.id AND w.status='completed') w ON true
      WHERE r.truck_id=k.truck_id AND r.organization_id=k.organization_id AND r.started_at IS NOT NULL
        AND r.status IN('in_progress','completed','cancelled')
        AND p_recorded_at>=r.started_at AT TIME ZONE 'UTC'
        AND (r.status='in_progress'
             OR (r.status='completed' AND r.completed_at IS NOT NULL
                 AND p_recorded_at<=least(r.completed_at AT TIME ZONE 'UTC'+interval '6 hours',coalesce(w.weighed,'infinity')))
             OR (r.status='cancelled' AND p_recorded_at<=r.cancelled_at))
      ORDER BY r.started_at DESC LIMIT 1;
    IF NOT FOUND THEN
      result:='no_trip';
    -- A driver without an app account has had no way to agree to the location notice, so is not recorded either.
    ELSIF trip.driver_id IS NOT NULL AND NOT coalesce((SELECT gps_consent_given(d.user_id) FROM drivers d WHERE d.id=trip.driver_id AND d.user_id IS NOT NULL),false) THEN
      result:='no_consent';
    ELSIF EXISTS(SELECT 1 FROM vehicle_location_events e WHERE e.truck_id=k.truck_id
                   AND e.recorded_at BETWEEN p_recorded_at-interval '10 seconds' AND p_recorded_at+interval '10 seconds') THEN
      result:='duplicate';
    ELSE
      BEGIN
        INSERT INTO vehicle_location_events(organization_id,truck_id,driver_id,route_id,location,accuracy_m,speed_kph,heading_degrees,source,recorded_at)
        VALUES(k.organization_id,k.truck_id,trip.driver_id,trip.id,ST_SetSRID(ST_MakePoint(p_longitude,p_latitude),4326)::geography,
          p_accuracy_m,p_speed_kph,p_heading,'vehicle_tracker',p_recorded_at);
        result:='stored';
      EXCEPTION WHEN SQLSTATE 'KW403' THEN
        result:='no_consent';
      END;
      IF result='stored' AND p_recorded_at>now()-interval '5 minutes' THEN
        UPDATE waste_trucks SET current_location=ST_SetSRID(ST_MakePoint(p_longitude,p_latitude),4326)::geography,updated_at=CURRENT_TIMESTAMP
          WHERE id=k.truck_id;
      END IF;
    END IF;
  END IF;

  UPDATE vehicle_trackers SET last_seen_at=CURRENT_TIMESTAMP,last_ip=left(p_ip,64),last_result=result WHERE id=k.id;
  INSERT INTO vehicle_tracker_daily(tracker_id,organization_id,day,stored,no_trip,no_consent,duplicate,rejected)
  VALUES(k.id,k.organization_id,today,(result='stored')::int,(result='no_trip')::int,(result='no_consent')::int,(result='duplicate')::int,(result='rejected')::int)
  ON CONFLICT(tracker_id,day) DO UPDATE SET stored=vehicle_tracker_daily.stored+EXCLUDED.stored,no_trip=vehicle_tracker_daily.no_trip+EXCLUDED.no_trip,
    no_consent=vehicle_tracker_daily.no_consent+EXCLUDED.no_consent,duplicate=vehicle_tracker_daily.duplicate+EXCLUDED.duplicate,
    rejected=vehicle_tracker_daily.rejected+EXCLUDED.rejected;
  RETURN result;
END $$;

DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['vehicle_trackers','vehicle_tracker_daily'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS kwms_tenant ON %I', t);
    EXECUTE format('CREATE POLICY kwms_tenant ON %I USING (kwms_tenant_sees(organization_id)) WITH CHECK (kwms_tenant_sees(organization_id))', t);
  END LOOP;
END $$;
-- The key hash never leaves the database through the app role.
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='kwms_app') THEN
    REVOKE SELECT ON vehicle_trackers FROM kwms_app;
    GRANT SELECT(id,organization_id,truck_id,label,serial_number,key_prefix,created_by,created_by_name,created_at,last_seen_at,last_ip,
      last_result,retired_at,retired_by,retired_by_name,retired_reason) ON vehicle_trackers TO kwms_app;
    REVOKE DELETE ON vehicle_trackers FROM kwms_app;
  END IF;
END $$;
DROP TRIGGER IF EXISTS trg_kwms_audit ON vehicle_trackers;
CREATE TRIGGER trg_kwms_audit AFTER INSERT OR UPDATE OF label,serial_number,retired_at ON vehicle_trackers
  FOR EACH ROW EXECUTE FUNCTION kwms_audit_row();
