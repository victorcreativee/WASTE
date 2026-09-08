import { dbPool } from "../config/database";

export async function getCommandCenterSummary(organizationId: string | null) {
  const metricsResult = await dbPool.query(
    `SELECT
      (SELECT COUNT(*)::int FROM collection_jobs WHERE job_date = CURRENT_DATE
        AND ($1::uuid IS NULL OR organization_id = $1::uuid)) AS jobs_today,
      (SELECT COUNT(*)::int FROM collection_jobs WHERE job_date = CURRENT_DATE AND status = 'completed'
        AND ($1::uuid IS NULL OR organization_id = $1::uuid)) AS completed_jobs,
      (SELECT COUNT(*)::int FROM collection_jobs WHERE job_date = CURRENT_DATE AND status = 'missed'
        AND ($1::uuid IS NULL OR organization_id = $1::uuid)) AS missed_jobs,
      (SELECT COUNT(*)::int FROM collection_routes WHERE route_date = CURRENT_DATE AND status IN ('dispatched','in_progress')
        AND ($1::uuid IS NULL OR organization_id = $1::uuid)) AS active_routes,
      (SELECT COUNT(*)::int FROM waste_trucks WHERE status = 'available'
        AND ($1::uuid IS NULL OR organization_id = $1::uuid)) AS available_trucks,
      (SELECT COUNT(*)::int FROM drivers WHERE status IN ('available','assigned')
        AND ($1::uuid IS NULL OR organization_id = $1::uuid)) AS active_drivers,
      (SELECT COUNT(*)::int FROM waste_zones WHERE is_active = true
        AND ($1::uuid IS NULL OR organization_id = $1::uuid)) AS zones_covered,
      (SELECT COUNT(*)::int FROM citizen_issues WHERE status NOT IN ('resolved','rejected')
        AND ($1::uuid IS NULL OR assigned_organization_id = $1::uuid)) AS pending_citizen_issues,
      (SELECT COUNT(*)::int FROM customer_service_locations
        WHERE ($1::uuid IS NULL OR organization_id = $1::uuid)) AS total_customers,
      (SELECT COUNT(*)::int FROM driver_job_problems WHERE status <> 'resolved'
        AND ($1::uuid IS NULL OR organization_id = $1::uuid)) AS open_driver_problems,
      (SELECT CASE WHEN $1::uuid IS NULL THEN COUNT(*)::int ELSE 0 END
        FROM waste_zones WHERE is_active = true AND organization_id IS NULL) AS unassigned_zones`,
    [organizationId]
  );
  const metrics = metricsResult.rows[0];
  const jobsToday = metrics.jobs_today || 0;

  const issuesResult = await dbPool.query(
    `SELECT ci.id, ci.category, ci.title, ci.status, ci.address,
       o.name AS assigned_organization_name, ci.created_at
     FROM citizen_issues ci
     LEFT JOIN organizations o ON o.id = ci.assigned_organization_id
     WHERE ci.status NOT IN ('resolved','rejected')
       AND ($1::uuid IS NULL OR ci.assigned_organization_id = $1::uuid)
     ORDER BY ci.created_at DESC
     LIMIT 6`,
    [organizationId]
  );

  const routesResult = await dbPool.query(
    `SELECT cr.id, cr.name, cr.status, cr.route_date, d.full_name AS driver_name,
       COUNT(crj.id)::int AS stop_count,
       COUNT(crj.id) FILTER (WHERE crj.status = 'completed')::int AS completed_stop_count
     FROM collection_routes cr
     LEFT JOIN drivers d ON d.id = cr.driver_id
     LEFT JOIN collection_route_jobs crj ON crj.route_id = cr.id
     WHERE cr.status IN ('planned','dispatched','in_progress')
       AND ($1::uuid IS NULL OR cr.organization_id = $1::uuid)
     GROUP BY cr.id, d.full_name ORDER BY cr.route_date, cr.created_at LIMIT 6`,
    [organizationId]
  );

  return {
    ...metrics,
    service_completion_percentage:
      jobsToday === 0 ? 0 : Math.round((metrics.completed_jobs / jobsToday) * 100),
    recent_unresolved_issues: issuesResult.rows,
    active_route_progress: routesResult.rows,
  };
}
