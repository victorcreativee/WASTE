import { dbPool } from "../config/database";
import { CreateCitizenIssueInput, UpdateCitizenIssueStatusInput } from "../validators/citizen-issue.validator";

export type CitizenIssueScope = {
  userId: string;
  organizationId: string | null;
  isCitizen: boolean;
  isCompany: boolean;
};

const issueSelect = `
  SELECT ci.id, ci.reporter_user_id, u.full_name AS reporter_name,
    ci.assigned_organization_id, o.name AS assigned_organization_name,
    ci.category, ci.title, ci.description, ci.status, ci.address,
    ST_Y(ci.location::geometry) AS latitude,
    ST_X(ci.location::geometry) AS longitude,
    ci.resolution_notes, ci.resolved_at, ci.created_at, ci.updated_at
  FROM citizen_issues ci
  JOIN users u ON u.id = ci.reporter_user_id
  LEFT JOIN organizations o ON o.id = ci.assigned_organization_id`;

export async function findCitizenIssues(scope: CitizenIssueScope) {
  const result = await dbPool.query(
    `${issueSelect}
     WHERE ($2::boolean = false OR ci.reporter_user_id = $1::uuid)
       AND ($3::boolean = false OR ci.assigned_organization_id = $4::uuid)
     ORDER BY ci.created_at DESC`,
    [scope.userId, scope.isCitizen, scope.isCompany, scope.organizationId]
  );
  return result.rows;
}

export async function createCitizenIssue(userId: string, input: CreateCitizenIssueInput) {
  const hasLocation = input.latitude !== undefined && input.longitude !== undefined;
  const result = await dbPool.query(
    `INSERT INTO citizen_issues (
       reporter_user_id, category, title, description, address, location
     ) VALUES ($1::uuid, $2, $3, $4, $5,
       ${hasLocation ? "ST_SetSRID(ST_MakePoint($7, $6), 4326)::geography" : "NULL"}
     ) RETURNING id`,
    hasLocation
      ? [userId, input.category, input.title, input.description, input.address ?? null, input.latitude, input.longitude]
      : [userId, input.category, input.title, input.description, input.address ?? null]
  );
  return findCitizenIssueById(result.rows[0].id, { userId, organizationId: null, isCitizen: true, isCompany: false });
}

export async function findCitizenIssueById(id: string, scope: CitizenIssueScope) {
  const result = await dbPool.query(
    `${issueSelect}
     WHERE ci.id = $1::uuid
       AND ($3::boolean = false OR ci.reporter_user_id = $2::uuid)
       AND ($4::boolean = false OR ci.assigned_organization_id = $5::uuid)`,
    [id, scope.userId, scope.isCitizen, scope.isCompany, scope.organizationId]
  );
  return result.rows[0] ?? null;
}

export async function assignCitizenIssue(id: string, organizationId: string) {
  const result = await dbPool.query(
    `UPDATE citizen_issues ci
     SET assigned_organization_id = $2::uuid, status = 'assigned', updated_at = CURRENT_TIMESTAMP
     WHERE ci.id = $1::uuid
       AND EXISTS (
         SELECT 1 FROM organizations o WHERE o.id = $2::uuid
           AND o.type = 'waste_collection_company' AND o.is_active = true
       )
     RETURNING id`,
    [id, organizationId]
  );
  return result.rows[0] ?? null;
}

export async function updateCitizenIssueStatus(
  id: string,
  input: UpdateCitizenIssueStatusInput,
  organizationId: string | null
) {
  const result = await dbPool.query(
    `UPDATE citizen_issues
     SET status = $2::text,
       resolution_notes = COALESCE($3, resolution_notes),
       resolved_at = CASE WHEN $2::text = 'resolved' THEN COALESCE(resolved_at, CURRENT_TIMESTAMP) ELSE resolved_at END,
       updated_at = CURRENT_TIMESTAMP
     WHERE id = $1::uuid
       AND ($4::uuid IS NULL OR assigned_organization_id = $4::uuid)
     RETURNING id`,
    [id, input.status, input.resolutionNotes ?? null, organizationId]
  );
  return result.rows[0] ?? null;
}
