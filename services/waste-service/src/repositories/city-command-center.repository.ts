import { dbPool } from "../config/database";
import { liveFleet } from "./fleet.repository";
import { cityCollectorReport } from "./report.repository";
import { loadServiceStandards } from "./service-standards.repository";
import {
  ServiceStandards,
  collectorServiceScore,
  issueSlaState,
  issueStandardHours,
  percent,
  scoreBand,
} from "../services/city-command-center.service";

/**
 * Division of an open issue: the zone whose boundary contains the report, otherwise the
 * nearest zone centre within 3 km. Issues without a location remain "unmapped".
 */
const openIssuesCte = `
  open_issues AS (
    SELECT ci.id, ci.category, ci.title, ci.status, ci.address, ci.created_at,
      ci.assigned_organization_id, o.name AS organization_name,
      zone.division_id,
      ST_Y(ci.location::geometry) AS latitude, ST_X(ci.location::geometry) AS longitude,
      EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - ci.created_at)) / 3600 AS age_hours,
      COALESCE(($1::jsonb ->> ci.category)::numeric, 48) AS standard_hours
    FROM citizen_issues ci
    LEFT JOIN organizations o ON o.id = ci.assigned_organization_id
    LEFT JOIN LATERAL (
      SELECT z.division_id
      FROM waste_zones z
      WHERE ci.location IS NOT NULL AND z.division_id IS NOT NULL AND z.is_active
        AND ((z.boundary IS NOT NULL AND ST_Covers(z.boundary, ci.location::geometry))
          OR (z.center_point IS NOT NULL AND ST_DWithin(z.center_point, ci.location, 3000)))
      ORDER BY (z.boundary IS NOT NULL AND ST_Covers(z.boundary, ci.location::geometry)) DESC,
        ST_Distance(z.center_point, ci.location) NULLS LAST
      LIMIT 1
    ) zone ON true
    WHERE ci.status NOT IN ('resolved', 'rejected')
  )`;

async function divisionPerformance(standardsJson: string) {
  const result = await dbPool.query(
    `WITH ${openIssuesCte},
     jobs AS (
       SELECT z.division_id,
         COUNT(*)::int AS jobs,
         COUNT(*) FILTER (WHERE j.status = 'completed')::int AS completed,
         COUNT(*) FILTER (WHERE j.status = 'missed')::int AS missed
       FROM collection_jobs j
       LEFT JOIN waste_zones z ON z.id = j.zone_id
       WHERE j.job_date = CURRENT_DATE AND j.status <> 'cancelled'
       GROUP BY z.division_id
     ),
     trips AS (
       SELECT sr.division_id,
         COUNT(*) FILTER (WHERE r.status IN ('dispatched', 'in_progress'))::int AS active_trips,
         COALESCE(SUM(r.verified_weight_kg), 0)::numeric AS verified_kg
       FROM collection_routes r
       LEFT JOIN service_routes sr ON sr.id = r.service_route_id
       WHERE r.route_date = CURRENT_DATE
       GROUP BY sr.division_id
     ),
     issues AS (
       SELECT division_id, COUNT(*)::int AS open_issues,
         COUNT(*) FILTER (WHERE age_hours > standard_hours)::int AS overdue_issues
       FROM open_issues GROUP BY division_id
     ),
     collectors AS (
       SELECT a.division_id, COUNT(DISTINCT a.organization_id)::int AS authorized_collectors
       FROM organization_division_authorizations a
       WHERE a.status = 'active' AND (a.expires_on IS NULL OR a.expires_on >= CURRENT_DATE)
       GROUP BY a.division_id
     ),
     divisions AS (
       SELECT id, code, name FROM kampala_divisions WHERE is_active
       UNION ALL SELECT NULL, 'unattributed', 'Not linked to a division'
     )
     SELECT d.id, d.code, d.name,
       COALESCE(jobs.jobs, 0) AS jobs, COALESCE(jobs.completed, 0) AS completed, COALESCE(jobs.missed, 0) AS missed,
       COALESCE(trips.active_trips, 0) AS active_trips, COALESCE(trips.verified_kg, 0) AS verified_kg,
       COALESCE(issues.open_issues, 0) AS open_issues, COALESCE(issues.overdue_issues, 0) AS overdue_issues,
       COALESCE(collectors.authorized_collectors, 0) AS authorized_collectors
     FROM divisions d
     LEFT JOIN jobs ON jobs.division_id IS NOT DISTINCT FROM d.id
     LEFT JOIN trips ON trips.division_id IS NOT DISTINCT FROM d.id
     LEFT JOIN issues ON issues.division_id IS NOT DISTINCT FROM d.id
     LEFT JOIN collectors ON collectors.division_id IS NOT DISTINCT FROM d.id
     ORDER BY d.id IS NULL, d.name`,
    [standardsJson]
  );
  return result.rows
    .map((row) => ({
      ...row,
      verified_kg: Number(row.verified_kg),
      completion_pct: percent(row.completed, row.jobs),
    }))
    // Hide the "unattributed" bucket when it has nothing in it.
    .filter((row) => row.id !== null || row.jobs || row.active_trips || row.verified_kg || row.open_issues);
}

async function issueOverview(standards: ServiceStandards) {
  const standardsJson = JSON.stringify(standards);
  const [summary, attention] = await Promise.all([
    dbPool.query(
      `WITH ${openIssuesCte}
       SELECT category, COUNT(*)::int AS open,
         COUNT(*) FILTER (WHERE age_hours > standard_hours)::int AS overdue,
         COUNT(*) FILTER (WHERE age_hours <= standard_hours AND age_hours >= standard_hours * 0.75)::int AS due_soon,
         COUNT(*) FILTER (WHERE assigned_organization_id IS NULL)::int AS unassigned
       FROM open_issues GROUP BY category ORDER BY category`,
      [standardsJson]
    ),
    dbPool.query(
      `WITH ${openIssuesCte}
       SELECT oi.id, oi.category, oi.title, oi.status, oi.address, oi.created_at,
         oi.organization_name, d.name AS division_name, oi.latitude, oi.longitude,
         ROUND(oi.age_hours::numeric, 1) AS age_hours
       FROM open_issues oi
       LEFT JOIN kampala_divisions d ON d.id = oi.division_id
       ORDER BY oi.age_hours / oi.standard_hours DESC
       LIMIT 12`,
      [standardsJson]
    ),
  ]);
  const byCategory = summary.rows.map((row) => ({ ...row, standard_hours: issueStandardHours(row.category, standards) }));
  return {
    standards_hours: standards,
    open: byCategory.reduce((n, row) => n + row.open, 0),
    overdue: byCategory.reduce((n, row) => n + row.overdue, 0),
    due_soon: byCategory.reduce((n, row) => n + row.due_soon, 0),
    unassigned: byCategory.reduce((n, row) => n + row.unassigned, 0),
    by_category: byCategory,
    needs_attention: attention.rows.map((row) => {
      const ageHours = Number(row.age_hours);
      return { ...row, age_hours: ageHours, standard_hours: issueStandardHours(row.category, standards), sla_state: issueSlaState(row.category, ageHours, standards) };
    }),
  };
}

async function collectorScorecard(from: string, to: string, standardsJson: string) {
  const [report, extra] = await Promise.all([
    cityCollectorReport(from, to),
    dbPool.query(
      `SELECT o.id, o.type,
         (SELECT COUNT(*)::int FROM collection_jobs j WHERE j.organization_id = o.id
           AND j.job_date BETWEEN $2::date AND $3::date AND j.status <> 'cancelled') AS scheduled_jobs,
         (SELECT COUNT(*)::int FROM citizen_issues ci
           WHERE ci.assigned_organization_id = o.id AND ci.status NOT IN ('resolved', 'rejected')
             AND EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - ci.created_at)) / 3600 > COALESCE(($1::jsonb ->> ci.category)::numeric, 48)
         ) AS overdue_issues,
         (SELECT COUNT(*)::int FROM citizen_issues ci
           WHERE ci.assigned_organization_id = o.id AND ci.status NOT IN ('resolved', 'rejected')) AS all_open_issues,
         (SELECT COUNT(*)::int FROM collector_compliance_cases c WHERE c.organization_id = o.id AND c.status <> 'closed') AS open_compliance_cases,
         (SELECT COUNT(*)::int FROM collector_compliance_cases c WHERE c.organization_id = o.id AND c.status <> 'closed' AND c.severity = 'critical') AS critical_compliance_cases
       FROM organizations o
       WHERE o.type = 'waste_collection_company'`,
      [standardsJson, from, to]
    ),
  ]);
  const extras = new Map(extra.rows.map((row) => [row.id, row]));
  const collectors = report.collectors
    .filter((row: { id: string }) => extras.has(row.id))
    .map((row: Record<string, any>) => {
      const more = extras.get(row.id)!;
      const input = {
        // Cancelled jobs are not scheduled work, matching the city totals.
        jobs: more.scheduled_jobs,
        completed_jobs: row.completed_jobs,
        missed_jobs: row.missed_jobs,
        completed_trips: row.completed_trips,
        unverified_trips: row.unverified_trips,
        open_issues: more.all_open_issues,
        overdue_issues: more.overdue_issues,
        open_compliance_cases: more.open_compliance_cases,
        critical_compliance_cases: more.critical_compliance_cases,
        compliance_state: row.compliance_state,
      };
      const score = collectorServiceScore(input);
      return {
        id: row.id,
        name: row.name,
        divisions: row.divisions,
        permit_number: row.permit_number,
        permit_valid_until: row.valid_until,
        ...input,
        completion_pct: percent(row.completed_jobs, more.scheduled_jobs),
        verified_kg: Number(row.verified_kg),
        service_score: score,
        score_band: scoreBand(score),
      };
    })
    .sort((a, b) => (b.service_score ?? -1) - (a.service_score ?? -1) || a.name.localeCompare(b.name));
  return { range: { from, to }, collectors };
}

async function cityTotals() {
  const result = await dbPool.query(
    `SELECT
       (SELECT COUNT(*)::int FROM collection_jobs WHERE job_date = CURRENT_DATE AND status <> 'cancelled') AS jobs_today,
       (SELECT COUNT(*)::int FROM collection_jobs WHERE job_date = CURRENT_DATE AND status = 'completed') AS completed_jobs,
       (SELECT COUNT(*)::int FROM collection_jobs WHERE job_date = CURRENT_DATE AND status = 'missed') AS missed_jobs,
       (SELECT COUNT(*)::int FROM collection_routes WHERE route_date = CURRENT_DATE AND status IN ('dispatched', 'in_progress')) AS active_trips,
       (SELECT COALESCE(SUM(net_kg), 0)::numeric FROM weighbridge_transactions WHERE operation_date = CURRENT_DATE AND status = 'completed') AS weighbridge_kg_today,
       (SELECT COUNT(*)::int FROM weighbridge_transactions WHERE operation_date = CURRENT_DATE AND status = 'open') AS trucks_at_weighbridge,
       (SELECT COUNT(*)::int FROM collector_compliance_cases WHERE status <> 'closed') AS open_compliance_cases,
       (SELECT COUNT(*)::int FROM collector_compliance_cases WHERE status <> 'closed' AND due_date < CURRENT_DATE) AS overdue_compliance_cases,
       (SELECT COUNT(DISTINCT organization_id)::int FROM organization_permit_applications
          WHERE status = 'approved' AND valid_until BETWEEN CURRENT_DATE AND CURRENT_DATE + 30) AS permits_expiring_30d,
       (SELECT COUNT(*)::int FROM organizations WHERE type = 'waste_collection_company' AND is_active) AS active_collectors,
       CURRENT_DATE::text AS today,
       (CURRENT_DATE - 6)::text AS week_start`
  );
  const row = result.rows[0];
  return { ...row, weighbridge_kg_today: Number(row.weighbridge_kg_today), completion_pct: percent(row.completed_jobs, row.jobs_today) };
}

export async function getCityCommandCenter() {
  const [totals, standards] = await Promise.all([cityTotals(), loadServiceStandards()]);
  const standardsJson = JSON.stringify(standards);
  const [divisions, fleetRows, issues, scorecard] = await Promise.all([
    divisionPerformance(standardsJson),
    liveFleet(null),
    issueOverview(standards),
    collectorScorecard(totals.week_start, totals.today, standardsJson),
  ]);
  const fleet = fleetRows.map((vehicle: Record<string, any>) => ({
    id: vehicle.id,
    organization_id: vehicle.organization_id,
    organization_name: vehicle.organization_name,
    plate_number: vehicle.plate_number,
    truck_name: vehicle.truck_name,
    status: vehicle.status,
    latitude: vehicle.latitude,
    longitude: vehicle.longitude,
    accuracy_m: vehicle.accuracy_m,
    speed_kph: vehicle.speed_kph,
    heading_degrees: vehicle.heading_degrees,
    recorded_at: vehicle.recorded_at,
    route_name: vehicle.route_name,
    route_status: vehicle.route_status,
    driver_name: vehicle.driver_name,
    signal_status: vehicle.signal_status,
    distance_from_route_m: vehicle.distance_from_route_m,
    is_off_route: vehicle.is_off_route,
    is_stopped_too_long: vehicle.is_stopped_too_long,
    alert_code: vehicle.alert_code,
    review_status: vehicle.review_status,
  }));
  const unresolvedAlert = (v: (typeof fleet)[number]) => v.alert_code && v.review_status !== "resolved";
  const { today, week_start, ...headline } = totals;
  return {
    generated_at: new Date().toISOString(),
    refresh_seconds: 30,
    service_date: today,
    totals: {
      ...headline,
      trucks_reporting: fleet.filter((v) => v.signal_status === "current" || v.signal_status === "delayed").length,
      fleet_alerts: fleet.filter(unresolvedAlert).length,
      open_issues: issues.open,
      overdue_issues: issues.overdue,
    },
    divisions,
    fleet,
    fleet_alerts: fleet.filter(unresolvedAlert),
    issues,
    scorecard,
  };
}
