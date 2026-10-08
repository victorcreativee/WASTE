import { dbPool } from "../config/database";

/** Require active membership in the current organization for legacy tenant roles. */
export async function requireActiveOrganization(
  organizationId: string | null,
  roles: Array<{ name: string }>,
  userId: string
) {
  if (!roles.some(role => ["company_admin", "supervisor", "driver", "iot_operator", "recycling_collector", "recycling_sales"].includes(role.name))) return;
  const result = organizationId
    ? await dbPool.query("SELECT o.id FROM organizations o JOIN organization_memberships m ON m.organization_id=o.id WHERE o.id=$1::uuid AND o.is_active=true AND m.user_id=$2::uuid AND m.status='active'", [organizationId,userId])
    : null;
  if (!result?.rows.length) {
    throw Object.assign(new Error("Your organization or membership is unavailable. Contact your administrator."), { statusCode: 403 });
  }
}
