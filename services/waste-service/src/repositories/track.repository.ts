import type { PoolClient } from "pg";
import { dbPool } from "../config/database";
import { Page, queryPage } from "../utils/pagination";
import type { Period } from "../services/recycling-oversight.rules";
import { DISPOSAL_RULES } from "../services/disposal.rules";
import { Facility, TRACK_RULES, analyzeTrack, trackWindow } from "../services/track.rules";
import { notifyOrganization, notifyRole } from "../services/notify";

const fail = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });
export type Scope = { organizationId: string | null; kind: "kcca" | "company" };
export const EXCEPTION_STATES = ["no_facility_visit", "ticket_mismatch"];

async function inTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function today() {
  return (await dbPool.query("SELECT CURRENT_DATE::text AS d")).rows[0].d as string;
}

// ---------- Facility geofences ----------

export async function facilityGeofences(): Promise<Facility[]> {
  return (await dbPool.query(
    "SELECT code,ST_Y(location::geometry) AS lat,ST_X(location::geometry) AS lng,radius_m FROM disposal_facilities WHERE is_active AND location IS NOT NULL")).rows
    .map(r => ({ code: r.code, lat: Number(r.lat), lng: Number(r.lng), radiusM: Number(r.radius_m) }));
}

export async function facilities() {
  return (await dbPool.query(
    `SELECT code,name,kind,is_active,radius_m,ST_Y(location::geometry) AS latitude,ST_X(location::geometry) AS longitude FROM disposal_facilities ORDER BY is_active DESC,name`)).rows;
}

export async function setFacilityLocation(code: string, input: { latitude: number; longitude: number; radiusM: number }) {
  const row = (await dbPool.query(
    `UPDATE disposal_facilities SET location=ST_SetSRID(ST_MakePoint($3::float8,$2::float8),4326)::geography,radius_m=$4,updated_at=CURRENT_TIMESTAMP
     WHERE code=$1 RETURNING code,name,radius_m,ST_Y(location::geometry) AS latitude,ST_X(location::geometry) AS longitude`,
    [code, input.latitude, input.longitude, input.radiusM])).rows[0];
  if (!row) throw fail(404, "Disposal facility not found");
  return row;
}

// ---------- Checking ----------

/**
 * Checks one completed trip once its disposal leg is over: reads the truck's GPS points in the trip's window, compares them
 * with the facility geofences and the trip's KCCA ticket, and stores the result. Returns why a trip was skipped otherwise.
 */
export async function checkTrip(tripId: string, geofences?: Facility[]) {
  const fences = geofences ?? await facilityGeofences();
  if (!fences.length) return { skipped: "no_facility_locations" as const };
  const trip = (await dbPool.query(
    `SELECT r.id,r.organization_id,r.truck_id,r.started_at,r.completed_at,r.route_geometry IS NOT NULL AS has_line
     FROM collection_routes r WHERE r.id=$1::uuid AND r.status='completed' AND r.service_route_id IS NOT NULL AND r.completed_at IS NOT NULL`, [tripId])).rows[0];
  if (!trip) return { skipped: "not_a_completed_trip" as const };
  // collection_routes stores local timestamps; read them as instants in the database's time zone.
  const times = (await dbPool.query("SELECT ($1::timestamp AT TIME ZONE current_setting('TimeZone')) AS started,($2::timestamp AT TIME ZONE current_setting('TimeZone')) AS completed",
    [trip.started_at, trip.completed_at])).rows[0];
  const window = trackWindow(times.started ? new Date(times.started) : null, new Date(times.completed));
  if (window.to.getTime() > Date.now()) return { skipped: "disposal_leg_open" as const };
  const [points, ticket] = await Promise.all([
    dbPool.query(
      `SELECT ST_Y(e.location::geometry) AS lat,ST_X(e.location::geometry) AS lng,e.recorded_at,
         CASE WHEN r.route_geometry IS NULL THEN NULL ELSE ST_Distance(e.location,r.route_geometry::geography) END AS route_distance_m
       FROM vehicle_location_events e JOIN collection_routes r ON r.id=$4::uuid
       WHERE e.truck_id=$1::uuid AND e.recorded_at BETWEEN $2 AND $3 AND COALESCE(e.accuracy_m,0)<=150 ORDER BY e.recorded_at LIMIT 5000`,
      [trip.truck_id, window.from, window.to, trip.id]),
    dbPool.query("SELECT id,facility_code,arrival_at FROM weighbridge_transactions WHERE trip_id=$1 AND status<>'voided' ORDER BY created_at DESC LIMIT 1", [trip.id]),
  ]);
  const t = ticket.rows[0];
  const result = analyzeTrack({
    points: points.rows.map(p => ({ lat: Number(p.lat), lng: Number(p.lng), at: new Date(p.recorded_at).getTime(), routeDistanceM: p.route_distance_m === null ? null : Number(p.route_distance_m) })),
    facilities: fences, ticket: t ? { id: t.id, facilityCode: t.facility_code, arrivalAt: new Date(t.arrival_at).getTime() } : null,
  });
  const previous = (await dbPool.query("SELECT state FROM trip_track_checks WHERE trip_id=$1", [trip.id])).rows[0]?.state ?? null;
  await dbPool.query(
    `INSERT INTO trip_track_checks(trip_id,organization_id,truck_id,state,gps_points,first_point_at,last_point_at,facility_code,facility_visit_at,ticket_id,ticket_gps_distance_m,stops,off_route_stops,longest_stop_minutes,window_start,window_end,checked_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,CURRENT_TIMESTAMP)
     ON CONFLICT(trip_id) DO UPDATE SET state=EXCLUDED.state,gps_points=EXCLUDED.gps_points,first_point_at=EXCLUDED.first_point_at,last_point_at=EXCLUDED.last_point_at,
       facility_code=EXCLUDED.facility_code,facility_visit_at=EXCLUDED.facility_visit_at,ticket_id=EXCLUDED.ticket_id,ticket_gps_distance_m=EXCLUDED.ticket_gps_distance_m,
       stops=EXCLUDED.stops,off_route_stops=EXCLUDED.off_route_stops,longest_stop_minutes=EXCLUDED.longest_stop_minutes,window_start=EXCLUDED.window_start,window_end=EXCLUDED.window_end,checked_at=CURRENT_TIMESTAMP`,
    [trip.id, trip.organization_id, trip.truck_id, result.state, result.gpsPoints, result.firstPointAt, result.lastPointAt, result.facilityCode, result.facilityVisitAt,
      t?.id ?? null, result.ticketGpsDistanceM, JSON.stringify(result.stops), result.offRouteStops, result.longestStopMinutes, window.from, window.to]);
  return { state: result.state, previous, organization_id: trip.organization_id as string };
}

/**
 * Checks every recent trip whose disposal leg is over (rechecking the last few days, as late GPS data can arrive from
 * offline phones). KCCA is told about each ticket the track contradicts; each company gets one daily digest.
 */
export async function runTrackChecks() {
  const fences = await facilityGeofences();
  if (!fences.length) return { checked: 0, skipped: "no_facility_locations" };
  const trips = (await dbPool.query(
    `SELECT id FROM collection_routes WHERE status='completed' AND service_route_id IS NOT NULL AND route_date>=$1::date
       AND completed_at>LOCALTIMESTAMP-make_interval(days=>$2) AND completed_at<LOCALTIMESTAMP-make_interval(hours=>$3) ORDER BY completed_at LIMIT 2000`,
    [DISPOSAL_RULES.firstDate, TRACK_RULES.recheckDays, TRACK_RULES.disposalLegHours])).rows;
  const counts: Record<string, number> = {};
  for (const trip of trips) {
    const result = await checkTrip(trip.id, fences);
    if ("skipped" in result) continue;
    counts[result.state] = (counts[result.state] ?? 0) + 1;
    if (result.state === "ticket_mismatch" && result.previous !== "ticket_mismatch") await notifyMismatch(trip.id);
  }
  await notifyDigests();
  return { checked: trips.length, ...counts };
}

async function notifyMismatch(tripId: string) {
  const row = (await dbPool.query(
    `SELECT c.organization_id,o.name,r.trip_number,t.plate_number,w.ticket_number,c.ticket_gps_distance_m FROM trip_track_checks c
     JOIN organizations o ON o.id=c.organization_id JOIN collection_routes r ON r.id=c.trip_id LEFT JOIN waste_trucks t ON t.id=c.truck_id
     LEFT JOIN weighbridge_transactions w ON w.id=c.ticket_id WHERE c.trip_id=$1`, [tripId])).rows[0];
  await inTransaction(client => notifyRole(client, "kcca_admin", {
      category: "disposal", severity: "warning", title: `GPS contradicts weighbridge ticket ${row.ticket_number}`,
      body: `${row.name}, ${row.plate_number || "truck"} (${row.trip_number || "trip"}): GPS put the truck ${(row.ticket_gps_distance_m / 1000).toFixed(1)} km from the facility when it was weighed.`,
      link: "/dashboard/track-checks", dedupeKey: `track-mismatch:${tripId}`,
    }, row.organization_id));
}

async function notifyDigests() {
  const day = await today();
  const rows = (await dbPool.query(
    `SELECT organization_id,COUNT(*) FILTER(WHERE state='no_facility_visit')::int AS no_visit,COUNT(*) FILTER(WHERE state='ticket_mismatch')::int AS mismatch
     FROM trip_track_checks WHERE checked_at>CURRENT_TIMESTAMP-interval '1 day' AND state=ANY($1::text[]) GROUP BY 1`, [EXCEPTION_STATES])).rows;
  await inTransaction(async client => {
    for (const row of rows) {
      const parts = [row.no_visit ? `${row.no_visit} trip${row.no_visit === 1 ? "" : "s"} whose GPS track never reached a disposal facility` : "",
        row.mismatch ? `${row.mismatch} weighbridge ticket${row.mismatch === 1 ? "" : "s"} recorded while the truck's GPS was elsewhere` : ""].filter(Boolean);
      await notifyOrganization(client, row.organization_id, ["company_admin"], {
        category: "disposal", severity: "warning", title: "GPS checks found trips to explain",
        body: `${parts.join(" and ")}. KCCA sees these checks; make sure drivers keep location sharing on until the truck is weighed.`,
        link: "/dashboard/disposal", dedupeKey: `track-digest:${row.organization_id}:${day}`,
      });
    }
  });
}

// ---------- Reading ----------

const COLUMNS = `c.trip_id,c.organization_id,o.name AS organization_name,r.trip_number,r.name AS route_name,r.route_date::text AS route_date,t.plate_number,
  c.state,c.gps_points,c.first_point_at,c.last_point_at,c.facility_code,f.name AS facility_name,c.facility_visit_at,c.ticket_id,w.ticket_number,
  w.facility AS ticket_facility,w.facility_code AS ticket_facility_code,w.arrival_at AS ticket_arrival_at,c.ticket_gps_distance_m,c.stops,c.off_route_stops,c.longest_stop_minutes,c.checked_at`;
const FROM = `FROM trip_track_checks c JOIN organizations o ON o.id=c.organization_id JOIN collection_routes r ON r.id=c.trip_id
  LEFT JOIN waste_trucks t ON t.id=c.truck_id LEFT JOIN disposal_facilities f ON f.code=c.facility_code LEFT JOIN weighbridge_transactions w ON w.id=c.ticket_id`;

export async function listChecks(period: Period, filter: { organizationId: string | null; view: string | null }, page?: Page) {
  return queryPage(
    `SELECT ${COLUMNS} ${FROM}
     WHERE r.route_date BETWEEN $1::date AND $2::date AND ($3::uuid IS NULL OR c.organization_id=$3::uuid)
       AND ($4::text IS NULL OR ($4='exceptions' AND c.state=ANY($5::text[])) OR ($4='stops' AND c.off_route_stops>0) OR c.state=$4)
     ORDER BY CASE c.state WHEN 'ticket_mismatch' THEN 0 WHEN 'no_facility_visit' THEN 1 WHEN 'no_gps' THEN 2 ELSE 3 END,r.route_date DESC,c.trip_id`,
    [period.from, period.to, filter.organizationId, filter.view, EXCEPTION_STATES], page);
}

export async function checkDetail(tripId: string, scope: Scope) {
  const check = (await dbPool.query(`SELECT ${COLUMNS},c.window_start,c.window_end,c.truck_id ${FROM} WHERE c.trip_id=$1::uuid AND ($2='kcca' OR c.organization_id=$3::uuid)`,
    [tripId, scope.kind, scope.organizationId])).rows[0];
  if (!check) throw fail(404, "Track check not found");
  const [points, fences, line] = await Promise.all([
    dbPool.query(
      `SELECT lat,lng,recorded_at FROM (SELECT ST_Y(location::geometry) AS lat,ST_X(location::geometry) AS lng,recorded_at,row_number() OVER(ORDER BY recorded_at) AS n,COUNT(*) OVER() AS total
         FROM vehicle_location_events WHERE truck_id=$1 AND recorded_at BETWEEN $2 AND $3 AND COALESCE(accuracy_m,0)<=150) p
       WHERE n=1 OR n=total OR n%GREATEST(1,total/800)=0 ORDER BY recorded_at`, [check.truck_id, check.window_start, check.window_end]),
    dbPool.query("SELECT code,name,radius_m,ST_Y(location::geometry) AS latitude,ST_X(location::geometry) AS longitude FROM disposal_facilities WHERE location IS NOT NULL AND is_active"),
    dbPool.query("SELECT CASE WHEN route_geometry IS NULL THEN NULL ELSE ST_AsGeoJSON(route_geometry)::json END AS line FROM collection_routes WHERE id=$1", [tripId]),
  ]);
  return { ...check, points: points.rows, facilities: fences.rows, route_line: line.rows[0]?.line ?? null, rules: TRACK_RULES };
}

export async function overview(period: Period, organizationId: string | null) {
  const [byOrg, setup, unchecked] = await Promise.all([
    dbPool.query(
      `SELECT c.organization_id AS id,o.name,COUNT(*)::int AS checked,COUNT(*) FILTER(WHERE c.state='consistent')::int AS consistent,
         COUNT(*) FILTER(WHERE c.state='no_gps')::int AS no_gps,COUNT(*) FILTER(WHERE c.state='no_facility_visit')::int AS no_facility_visit,
         COUNT(*) FILTER(WHERE c.state='ticket_mismatch')::int AS ticket_mismatch,COALESCE(SUM(c.off_route_stops),0)::int AS off_route_stops
       FROM trip_track_checks c JOIN organizations o ON o.id=c.organization_id JOIN collection_routes r ON r.id=c.trip_id
       WHERE r.route_date BETWEEN $1::date AND $2::date AND ($3::uuid IS NULL OR c.organization_id=$3::uuid)
       GROUP BY c.organization_id,o.name ORDER BY ticket_mismatch DESC,no_facility_visit DESC,o.name`, [period.from, period.to, organizationId]),
    dbPool.query("SELECT COUNT(*) FILTER(WHERE is_active)::int AS active,COUNT(*) FILTER(WHERE is_active AND location IS NULL)::int AS without_location FROM disposal_facilities"),
    dbPool.query(
      `SELECT COUNT(*)::int AS n FROM collection_routes r WHERE r.status='completed' AND r.service_route_id IS NOT NULL AND r.route_date BETWEEN $1::date AND $2::date
         AND r.route_date>=$3::date AND ($4::uuid IS NULL OR r.organization_id=$4::uuid) AND NOT EXISTS(SELECT 1 FROM trip_track_checks c WHERE c.trip_id=r.id)`,
      [period.from, period.to, DISPOSAL_RULES.firstDate, organizationId]),
  ]);
  const companies = byOrg.rows.map(row => ({ ...row, consistent_rate: row.checked - row.no_gps > 0 ? Math.round((row.consistent / (row.checked - row.no_gps)) * 1000) / 10 : null,
    gps_coverage: row.checked ? Math.round(((row.checked - row.no_gps) / row.checked) * 1000) / 10 : null }));
  const sum = (key: string) => companies.reduce((total, row) => total + Number(row[key as keyof typeof row] ?? 0), 0);
  return {
    period, rules: TRACK_RULES, facilities: setup.rows[0], unchecked_trips: unchecked.rows[0].n,
    totals: { checked: sum("checked"), consistent: sum("consistent"), no_gps: sum("no_gps"), no_facility_visit: sum("no_facility_visit"), ticket_mismatch: sum("ticket_mismatch"), off_route_stops: sum("off_route_stops") },
    companies,
  };
}
