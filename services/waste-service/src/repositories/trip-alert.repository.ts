import { dbPool } from "../config/database";
import { notifyOrganization, notifyUser } from "../services/notify";

/**
 * Phase 4H: trips that need someone's attention now. Each alert names what is wrong, who is responsible and how long it
 * has been that way, so dispatch can act on it instead of reading a dashboard. Times are Kampala time.
 */
export const ALERT_RULES = {
  notStartedMinutes: 90, // dispatched but the driver has not started
  stalledMinutes: 60, // in progress, households still waiting, but nothing recorded for this long
  overrunFactor: 1.5, // running longer than the route's estimate by this much
  overrunFallbackMinutes: 8 * 60, // when the route has no estimate
} as const;

export type TripAlertKind = "carried_over" | "not_started" | "blocked" | "stalled" | "overrun";
export type TripAlert = {
  kind: TripAlertKind;
  severity: "warning" | "critical";
  trip_id: string;
  trip_number: string;
  route_name: string;
  route_date: string;
  status: string;
  organization_id: string;
  plate_number: string | null;
  driver_name: string | null;
  driver_phone: string | null;
  supervisor_user_id: string | null;
  supervisor_name: string | null;
  pending_households: number;
  open_problems: number;
  since: string;
  minutes: number;
};

const SQL = `
WITH open_trips AS (
  SELECT r.id,r.organization_id,r.trip_number,r.name route_name,r.route_date,r.status,r.created_at,r.started_at,
    r.estimated_duration_minutes,r.supervisor_user_id,t.plate_number,d.full_name driver_name,d.phone driver_phone,
    su.full_name supervisor_name,
    (SELECT count(*) FROM collection_route_jobs j JOIN customer_collection_stops s ON s.collection_job_id=j.job_id
      WHERE j.route_id=r.id AND s.status IN('pending','arrived'))::int pending_households,
    (SELECT count(*) FROM collection_route_jobs j JOIN driver_job_problems p ON p.job_id=j.job_id
      WHERE j.route_id=r.id AND p.status<>'resolved')::int open_problems,
    (SELECT min(p.created_at) FROM collection_route_jobs j JOIN driver_job_problems p ON p.job_id=j.job_id
      WHERE j.route_id=r.id AND p.status<>'resolved') first_problem_at,
    GREATEST(r.started_at,
      (SELECT max(GREATEST(s.arrived_at,s.completed_at)) FROM collection_route_jobs j JOIN customer_collection_stops s ON s.collection_job_id=j.job_id WHERE j.route_id=r.id),
      (SELECT max(GREATEST(j.arrived_at,j.completed_at)) FROM collection_route_jobs j WHERE j.route_id=r.id)) last_activity
  FROM collection_routes r
  LEFT JOIN waste_trucks t ON t.id=r.truck_id
  LEFT JOIN drivers d ON d.id=r.driver_id
  LEFT JOIN users su ON su.id=r.supervisor_user_id
  WHERE r.status IN('planned','dispatched','in_progress')
    AND ($1::uuid IS NULL OR r.organization_id=$1::uuid)
    AND ($2::uuid IS NULL OR r.supervisor_user_id=$2::uuid)
), today AS (SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Kampala')::date d)
SELECT a.*, floor(extract(epoch FROM CURRENT_TIMESTAMP-a.since)/60)::int minutes FROM (
  -- A trip from an earlier day that was never finished or cancelled.
  SELECT 'carried_over' kind,'warning' severity,o.*,o.route_date::timestamptz since FROM open_trips o,today WHERE o.route_date<today.d
  UNION ALL
  SELECT 'not_started','warning',o.*,o.created_at FROM open_trips o,today
    WHERE o.route_date=today.d AND o.status IN('planned','dispatched') AND o.created_at<CURRENT_TIMESTAMP-make_interval(mins=>$3::int)
  UNION ALL
  -- The driver reported something that stops the work, and nobody has resolved it.
  SELECT 'blocked','critical',o.*,o.first_problem_at FROM open_trips o,today WHERE o.route_date=today.d AND o.open_problems>0
  UNION ALL
  SELECT 'stalled','warning',o.*,o.last_activity FROM open_trips o,today
    WHERE o.route_date=today.d AND o.status='in_progress' AND o.pending_households>0 AND o.open_problems=0
      AND o.last_activity<CURRENT_TIMESTAMP-make_interval(mins=>$4::int)
  UNION ALL
  SELECT 'overrun','warning',o.*,o.started_at FROM open_trips o,today
    WHERE o.route_date=today.d AND o.status='in_progress' AND o.started_at IS NOT NULL
      AND o.started_at<CURRENT_TIMESTAMP-make_interval(mins=>COALESCE(round(o.estimated_duration_minutes*$5::numeric)::int,$6::int))
) a
ORDER BY (a.severity='critical') DESC, a.since`;

/** Open alerts for one company (and, for a supervisor, only their own trips), or city-wide when organizationId is null. */
export async function tripAlerts(organizationId: string | null, supervisorUserId: string | null = null): Promise<TripAlert[]> {
  const r = ALERT_RULES;
  const rows = (await dbPool.query(SQL, [organizationId, supervisorUserId, r.notStartedMinutes, r.stalledMinutes, r.overrunFactor, r.overrunFallbackMinutes])).rows;
  return rows.map(row => ({
    kind: row.kind, severity: row.severity, trip_id: row.id, trip_number: row.trip_number, route_name: row.route_name,
    route_date: new Date(row.route_date).toISOString().slice(0, 10), status: row.status, organization_id: row.organization_id,
    plate_number: row.plate_number, driver_name: row.driver_name, driver_phone: row.driver_phone,
    supervisor_user_id: row.supervisor_user_id, supervisor_name: row.supervisor_name,
    pending_households: row.pending_households, open_problems: row.open_problems,
    since: new Date(row.since).toISOString(), minutes: row.minutes,
  }));
}

const TITLE: Record<TripAlertKind, (a: TripAlert) => string> = {
  carried_over: a => `${a.trip_number} from ${a.route_date} is still open`,
  not_started: a => `${a.trip_number} has not started`,
  blocked: a => `${a.trip_number} is blocked`,
  stalled: a => `${a.trip_number} has stopped moving`,
  overrun: a => `${a.trip_number} is running long`,
};
const BODY: Record<TripAlertKind, (a: TripAlert) => string> = {
  carried_over: a => `${a.route_name} was never finished or cancelled. Finish it with the driver or cancel it so the households go back to dispatch.`,
  not_started: a => `${a.route_name} was sent ${a.minutes} minutes ago and ${a.driver_name || "the driver"} has not started it. Call ${a.driver_phone || "the driver"}.`,
  blocked: a => `${a.driver_name || "The driver"} reported ${a.open_problems === 1 ? "a problem" : `${a.open_problems} problems`} on ${a.route_name}. Resolve it in Service issues.`,
  stalled: a => `Nothing recorded on ${a.route_name} for ${a.minutes} minutes and ${a.pending_households} households are still waiting. Call ${a.driver_phone || "the driver"}.`,
  overrun: a => `${a.route_name} has been running for ${Math.round(a.minutes / 60 * 10) / 10} hours, longer than planned.`,
};

/**
 * Tells the trip's supervisor (or the company administrators when the trip has none) about each new alert, once per
 * trip and kind. Runs from the scheduler; an advisory lock keeps several service instances from sending twice.
 */
export async function notifyTripAlerts() {
  const client = await dbPool.connect();
  let sent = 0;
  try {
    const locked = (await client.query("SELECT pg_try_advisory_lock(hashtext('wms:trip-alerts')) ok")).rows[0]?.ok;
    if (!locked) return 0;
    try {
      for (const alert of await tripAlerts(null)) {
        const message = {
          category: "operations" as const, severity: alert.severity, title: TITLE[alert.kind](alert), body: BODY[alert.kind](alert),
          link: alert.kind === "blocked" ? "/dashboard/citizen-issues" : `/dashboard/driver-mobile?route=${alert.trip_id}`,
          dedupeKey: `trip-alert:${alert.trip_id}:${alert.kind}`,
        };
        await client.query("BEGIN");
        if (alert.supervisor_user_id) await notifyUser(client, alert.supervisor_user_id, alert.organization_id, message);
        else await notifyOrganization(client, alert.organization_id, ["company_admin"], message);
        await client.query("COMMIT");
        sent++;
      }
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtext('wms:trip-alerts'))");
    }
    return sent;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}
