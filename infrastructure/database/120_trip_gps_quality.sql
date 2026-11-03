-- KWMS module 2: GPS data completeness. The pilot target is "no data gaps > 5 minutes" on tracked trips. Each trip's
-- positions are summarised once it ends (points, gaps longer than 5 minutes, longest gap, share of the trip covered),
-- and the summary is kept after the positions themselves are deleted under the retention schedule (114).
-- Trips whose driver had not agreed to location sharing are marked as such, never counted as gaps. The summary
-- describes the data, not the driver: it is not used to score drivers (the location notice does not name that purpose).
-- Additive and idempotent. Requires 113, 114.

CREATE TABLE IF NOT EXISTS trip_gps_quality(
 trip_id UUID PRIMARY KEY REFERENCES collection_routes(id) ON DELETE CASCADE,
 organization_id UUID NOT NULL REFERENCES organizations(id),
 truck_id UUID REFERENCES waste_trucks(id) ON DELETE SET NULL,
 started_at TIMESTAMPTZ NOT NULL,
 ended_at TIMESTAMPTZ NOT NULL,
 trip_minutes NUMERIC(8,1) NOT NULL,
 sharing TEXT NOT NULL CHECK(sharing IN('shared','not_shared','no_points')),
 points INT NOT NULL DEFAULT 0,
 threshold_minutes INT NOT NULL,
 gaps INT NOT NULL DEFAULT 0,
 gap_minutes NUMERIC(8,1) NOT NULL DEFAULT 0,
 longest_gap_minutes NUMERIC(8,1) NOT NULL DEFAULT 0,
 coverage_pct NUMERIC(5,1),
 computed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_trip_gps_quality_org ON trip_gps_quality(organization_id,started_at DESC);

-- When a trip ended, as a point in time.
CREATE OR REPLACE FUNCTION trip_ended_at(p_completed TIMESTAMP,p_cancelled TIMESTAMPTZ) RETURNS TIMESTAMPTZ LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(p_completed AT TIME ZONE 'UTC',p_cancelled)
$$;

-- Summarises one ended trip: the window runs from its start to its completion (or cancellation). A gap is any stretch
-- longer than the threshold without a position, including before the first and after the last.
CREATE OR REPLACE FUNCTION compute_trip_gps_quality(p_trip UUID,p_threshold_minutes INT DEFAULT 5) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE t RECORD; driver_user UUID; agreed BOOLEAN; n INT; g RECORD; minutes NUMERIC; state TEXT;
BEGIN
  -- started_at and completed_at are stored without a time zone, written as UTC; cancelled_at has a time zone.
  SELECT r.id,r.organization_id,r.truck_id,r.driver_id,r.started_at AT TIME ZONE 'UTC' AS started_at,trip_ended_at(r.completed_at,r.cancelled_at) AS ended_at
    INTO t FROM collection_routes r WHERE r.id=p_trip AND r.started_at IS NOT NULL AND trip_ended_at(r.completed_at,r.cancelled_at)>r.started_at AT TIME ZONE 'UTC';
  IF NOT FOUND THEN RETURN NULL; END IF;
  minutes:=extract(epoch FROM t.ended_at-t.started_at)/60;
  SELECT count(*) INTO n FROM vehicle_location_events e WHERE e.route_id=t.id AND e.recorded_at BETWEEN t.started_at AND t.ended_at;
  -- Had the driver agreed to sharing when the trip started?
  SELECT d.user_id INTO driver_user FROM drivers d WHERE d.id=t.driver_id;
  SELECT c.decision='granted' INTO agreed FROM gps_consents c WHERE c.user_id=driver_user AND c.decided_at<=t.started_at ORDER BY c.decided_at DESC LIMIT 1;
  state:=CASE WHEN n>0 THEN 'shared' WHEN coalesce(agreed,false) THEN 'no_points' ELSE 'not_shared' END;
  WITH pts AS (SELECT t.started_at AS at UNION ALL SELECT e.recorded_at FROM vehicle_location_events e
                 WHERE e.route_id=t.id AND e.recorded_at BETWEEN t.started_at AND t.ended_at UNION ALL SELECT t.ended_at),
       steps AS (SELECT extract(epoch FROM at-lag(at) OVER (ORDER BY at))/60 AS gap FROM pts)
  SELECT count(*) FILTER (WHERE gap>p_threshold_minutes)::int gaps,coalesce(sum(gap) FILTER (WHERE gap>p_threshold_minutes),0) gap_minutes,coalesce(max(gap),0) longest
    INTO g FROM steps;
  INSERT INTO trip_gps_quality(trip_id,organization_id,truck_id,started_at,ended_at,trip_minutes,sharing,points,threshold_minutes,gaps,gap_minutes,longest_gap_minutes,coverage_pct,computed_at)
  VALUES(t.id,t.organization_id,t.truck_id,t.started_at,t.ended_at,round(minutes,1),state,n,p_threshold_minutes,
    CASE WHEN state='not_shared' THEN 0 ELSE g.gaps END,
    CASE WHEN state='not_shared' THEN 0 ELSE round(g.gap_minutes,1) END,
    CASE WHEN state='not_shared' THEN 0 ELSE round(g.longest,1) END,
    CASE WHEN state='not_shared' THEN NULL ELSE round(greatest(0,100*(1-g.gap_minutes/nullif(minutes,0))),1) END,CURRENT_TIMESTAMP)
  ON CONFLICT(trip_id) DO UPDATE SET truck_id=EXCLUDED.truck_id,started_at=EXCLUDED.started_at,ended_at=EXCLUDED.ended_at,trip_minutes=EXCLUDED.trip_minutes,
    sharing=EXCLUDED.sharing,points=EXCLUDED.points,threshold_minutes=EXCLUDED.threshold_minutes,gaps=EXCLUDED.gaps,gap_minutes=EXCLUDED.gap_minutes,
    longest_gap_minutes=EXCLUDED.longest_gap_minutes,coverage_pct=EXCLUDED.coverage_pct,computed_at=EXCLUDED.computed_at;
  RETURN state;
END $$;

-- Summaries are refreshed until positions can no longer change: a trip is summarised (again) while it ended in the
-- last two days, and once if it has never been. Older trips keep their summary when their positions are deleted.
CREATE OR REPLACE FUNCTION refresh_trip_gps_quality(p_limit INT DEFAULT 500) RETURNS INT LANGUAGE plpgsql AS $$
DECLARE r RECORD; done INT:=0;
BEGIN
  FOR r IN SELECT c.id FROM collection_routes c LEFT JOIN trip_gps_quality q ON q.trip_id=c.id
    WHERE c.started_at IS NOT NULL AND trip_ended_at(c.completed_at,c.cancelled_at) IS NOT NULL
      AND (q.trip_id IS NULL OR trip_ended_at(c.completed_at,c.cancelled_at)>now()-interval '2 days')
      AND (q.trip_id IS NULL OR q.computed_at<now()-interval '50 minutes')
    ORDER BY trip_ended_at(c.completed_at,c.cancelled_at) DESC LIMIT p_limit LOOP
    PERFORM compute_trip_gps_quality(r.id); done:=done+1;
  END LOOP;
  RETURN done;
END $$;

ALTER TABLE trip_gps_quality ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_gps_quality FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kwms_tenant ON trip_gps_quality;
CREATE POLICY kwms_tenant ON trip_gps_quality USING (kwms_tenant_sees(organization_id)) WITH CHECK (kwms_tenant_sees(organization_id));

-- Trips that ended before this migration, while their positions still exist.
SELECT count(compute_trip_gps_quality(c.id)) FROM collection_routes c
WHERE c.started_at IS NOT NULL AND trip_ended_at(c.completed_at,c.cancelled_at)>c.started_at AT TIME ZONE 'UTC';
