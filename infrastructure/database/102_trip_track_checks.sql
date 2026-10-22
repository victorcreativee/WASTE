-- Module 11: GPS track checks — each completed collection trip's GPS track compared with the disposal facilities and with
-- its KCCA weighbridge ticket. Facilities get a location and a geofence radius (set by KCCA); results are stored per trip
-- by the waste service's checker. Additive and idempotent. Requires 092–101.

ALTER TABLE disposal_facilities
  ADD COLUMN IF NOT EXISTS location GEOGRAPHY(POINT,4326),
  ADD COLUMN IF NOT EXISTS radius_m INTEGER NOT NULL DEFAULT 300;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='disposal_facility_radius') THEN
    ALTER TABLE disposal_facilities ADD CONSTRAINT disposal_facility_radius CHECK(radius_m BETWEEN 50 AND 3000);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS trip_track_checks(
 trip_id UUID PRIMARY KEY REFERENCES collection_routes(id) ON DELETE CASCADE,
 organization_id UUID NOT NULL REFERENCES organizations(id),
 truck_id UUID REFERENCES waste_trucks(id) ON DELETE SET NULL,
 state TEXT NOT NULL CHECK(state IN('consistent','no_gps','no_facility_visit','ticket_mismatch')),
 gps_points INTEGER NOT NULL CHECK(gps_points>=0),
 first_point_at TIMESTAMPTZ,
 last_point_at TIMESTAMPTZ,
 facility_code VARCHAR(20) REFERENCES disposal_facilities(code),
 facility_visit_at TIMESTAMPTZ,
 ticket_id UUID REFERENCES weighbridge_transactions(id) ON DELETE SET NULL,
 ticket_gps_distance_m INTEGER,
 stops JSONB NOT NULL DEFAULT '[]',
 off_route_stops INTEGER NOT NULL DEFAULT 0,
 longest_stop_minutes INTEGER NOT NULL DEFAULT 0,
 window_start TIMESTAMPTZ NOT NULL,
 window_end TIMESTAMPTZ NOT NULL,
 checked_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_trip_track_checks_org ON trip_track_checks(organization_id,state,checked_at DESC);

-- Track queries read one truck's points over a few hours.
CREATE INDEX IF NOT EXISTS idx_vehicle_location_truck_time ON vehicle_location_events(truck_id,recorded_at);
