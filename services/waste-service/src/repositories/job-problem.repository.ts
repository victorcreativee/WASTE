import { dbPool } from "../config/database";

export async function createDriverJobProblem(
  jobId: string,
  userId: string,
  category: string,
  description: string
) {
  const result = await dbPool.query(
    `INSERT INTO driver_job_problems (job_id, driver_id, organization_id, category, description)
     SELECT cj.id, d.id, cj.organization_id, $3, $4
     FROM collection_jobs cj
     JOIN drivers d ON d.id = cj.driver_id
     WHERE cj.id = $1::uuid AND d.user_id = $2::uuid
       AND cj.status IN ('assigned', 'in_progress')
     RETURNING *`,
    [jobId, userId, category, description]
  );
  return result.rows[0] ?? null;
}

export async function findDriverJobProblems(
  organizationId: string | null,
  userId: string | null
) {
  const result = await dbPool.query(
    `SELECT p.*, cj.job_date, cj.status AS job_status, wz.name AS zone_name,
            d.full_name AS driver_name, wt.plate_number
     FROM driver_job_problems p
     JOIN collection_jobs cj ON cj.id = p.job_id
     JOIN drivers d ON d.id = p.driver_id
     LEFT JOIN waste_zones wz ON wz.id = cj.zone_id
     LEFT JOIN waste_trucks wt ON wt.id = cj.truck_id
     WHERE ($1::uuid IS NULL OR p.organization_id = $1::uuid)
       AND ($2::uuid IS NULL OR d.user_id = $2::uuid)
     ORDER BY CASE p.status WHEN 'open' THEN 0 WHEN 'acknowledged' THEN 1 ELSE 2 END,
              p.created_at DESC`,
    [organizationId, userId]
  );
  return result.rows;
}

export async function updateDriverJobProblem(
  problemId: string,
  organizationId: string | null,
  status: string,
  resolutionNotes?: string
) {
  const result = await dbPool.query(
    `UPDATE driver_job_problems
     SET status = $3,
         resolution_notes = COALESCE($4, resolution_notes),
         resolved_at = CASE WHEN $3 = 'resolved' THEN CURRENT_TIMESTAMP ELSE resolved_at END,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1::uuid AND ($2::uuid IS NULL OR organization_id = $2::uuid)
     RETURNING *`,
    [problemId, organizationId, status, resolutionNotes ?? null]
  );
  return result.rows[0] ?? null;
}
