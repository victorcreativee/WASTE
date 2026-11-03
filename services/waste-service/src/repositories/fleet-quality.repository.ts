import { dbPool } from "../config/database";

// GPS data completeness (migration 120) and driver scorecards. The GPS figures describe the data per trip, vehicle and
// operator; driver scorecards use collection and disposal records only, because the location notice drivers agreed to
// (114) does not name rating drivers as a purpose of their location data.

export const GAP_MINUTES = 5;
const TODAY = "(now() AT TIME ZONE 'Africa/Kampala')::date";

export async function gpsQuality(organizationId: string | null, from: string, to: string) {
  const where = "q.started_at>=($1::date::timestamp AT TIME ZONE 'Africa/Kampala') AND q.started_at<(($2::date+1)::timestamp AT TIME ZONE 'Africa/Kampala') AND ($3::uuid IS NULL OR q.organization_id=$3::uuid)";
  const sums = `count(*)::int trips,count(*) FILTER (WHERE q.sharing='shared')::int shared,count(*) FILTER (WHERE q.sharing='not_shared')::int not_shared,
    count(*) FILTER (WHERE q.sharing='no_points')::int no_points,
    count(*) FILTER (WHERE q.sharing<>'not_shared' AND q.gaps=0)::int without_gaps,
    round(avg(q.coverage_pct) FILTER (WHERE q.sharing<>'not_shared'),1) avg_coverage_pct,
    coalesce(max(q.longest_gap_minutes),0) longest_gap_minutes,coalesce(sum(q.gaps),0)::int gaps`;
  const params = [from, to, organizationId];
  const [totals, groups, trips] = await Promise.all([
    dbPool.query(`SELECT ${sums} FROM trip_gps_quality q WHERE ${where}`, params),
    organizationId
      ? dbPool.query(`SELECT t.id,coalesce(t.plate_number,'No vehicle') name,${sums} FROM trip_gps_quality q LEFT JOIN waste_trucks t ON t.id=q.truck_id
          WHERE ${where} GROUP BY t.id,t.plate_number ORDER BY 2`, params)
      : dbPool.query(`SELECT o.id,o.name,${sums} FROM trip_gps_quality q JOIN organizations o ON o.id=q.organization_id
          WHERE ${where} GROUP BY o.id,o.name ORDER BY o.name`, params),
    dbPool.query(`SELECT q.trip_id,r.trip_number,r.name route_name,o.name organization,t.plate_number,
        (q.started_at AT TIME ZONE 'Africa/Kampala')::text AS started_local,q.trip_minutes,q.sharing,q.points,q.gaps,q.gap_minutes,q.longest_gap_minutes,q.coverage_pct
      FROM trip_gps_quality q JOIN collection_routes r ON r.id=q.trip_id JOIN organizations o ON o.id=q.organization_id LEFT JOIN waste_trucks t ON t.id=q.truck_id
      WHERE ${where} AND (q.gaps>0 OR q.sharing='no_points') ORDER BY q.gap_minutes DESC,q.started_at DESC LIMIT 100`, params),
  ]);
  return { thresholdMinutes: GAP_MINUTES, totals: totals.rows[0], groups: groups.rows, trips: trips.rows };
}

/** Per driver: trips, collections done and missed, trips verified at a KCCA weighbridge, receipts. No GPS figures. */
export async function driverScorecards(organizationId: string, from: string, to: string) {
  return (await dbPool.query(`WITH trips AS (
      SELECT r.driver_id,count(*) FILTER (WHERE r.status='completed')::int completed,count(*) FILTER (WHERE r.status='cancelled')::int cancelled,
        count(*) FILTER (WHERE r.status='completed' AND EXISTS(SELECT 1 FROM weighbridge_transactions w WHERE w.trip_id=r.id AND w.status='completed'))::int verified,
        max(r.route_date)::text last_trip
      FROM collection_routes r WHERE r.organization_id=$3::uuid AND r.route_date BETWEEN $1::date AND $2::date AND r.driver_id IS NOT NULL GROUP BY r.driver_id),
    stops AS (
      SELECT j.driver_id,count(*) FILTER (WHERE s.scheduled_date<=${TODAY} AND s.status<>'cancelled')::int due,
        count(*) FILTER (WHERE s.status='completed')::int completed,
        count(*) FILTER (WHERE s.status='skipped' OR (s.status IN('pending','arrived') AND s.scheduled_date<${TODAY}))::int missed,
        mode() WITHIN GROUP (ORDER BY s.exception_reason) FILTER (WHERE s.exception_reason IS NOT NULL) top_reason
      FROM customer_collection_stops s JOIN collection_jobs j ON j.id=s.collection_job_id
      WHERE s.organization_id=$3::uuid AND s.scheduled_date BETWEEN $1::date AND $2::date AND j.driver_id IS NOT NULL GROUP BY j.driver_id),
    receipts AS (
      SELECT j.driver_id,count(*)::int receipts FROM collection_receipts c JOIN collection_jobs j ON j.id=c.collection_job_id
      WHERE c.organization_id=$3::uuid AND (c.issued_at AT TIME ZONE 'Africa/Kampala')::date BETWEEN $1::date AND $2::date GROUP BY j.driver_id)
    SELECT d.id,d.full_name,d.phone,d.status,
      coalesce(t.completed,0) trips_completed,coalesce(t.cancelled,0) trips_cancelled,coalesce(t.verified,0) trips_verified,t.last_trip,
      coalesce(s.due,0) stops_due,coalesce(s.completed,0) stops_completed,coalesce(s.missed,0) stops_missed,s.top_reason,coalesce(rc.receipts,0) receipts
    FROM drivers d LEFT JOIN trips t ON t.driver_id=d.id LEFT JOIN stops s ON s.driver_id=d.id LEFT JOIN receipts rc ON rc.driver_id=d.id
    WHERE d.organization_id=$3::uuid AND (t.driver_id IS NOT NULL OR s.driver_id IS NOT NULL OR d.status<>'inactive')
    ORDER BY coalesce(t.completed,0) DESC,d.full_name`, [from, to, organizationId])).rows;
}

export async function refreshGpsQuality() {
  return Number((await dbPool.query("SELECT refresh_trip_gps_quality() AS n")).rows[0].n);
}
