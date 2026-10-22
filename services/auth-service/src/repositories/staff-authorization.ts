import type { PoolClient } from 'pg';

/** Call inside the write transaction, before touching staff records. */
export async function authorizeStaffWrite(client:PoolClient,organizationId:string,actorId:string) {
 await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`access:${organizationId}`]);
 const organization=await client.query("SELECT type FROM organizations WHERE id=$1::uuid AND type IN ('waste_collection_company','recycling_company','processing_plant')",[organizationId]);
 if(!organization.rowCount)throw Object.assign(new Error('Staff management is not available for this organization type'),{statusCode:403});
 await client.query("SELECT set_config('wms.actor_id',$1,true)",[actorId]);
 const allowed=await client.query("SELECT 1 FROM organization_effective_permissions($1::uuid,$2::uuid) WHERE code='staff.manage'",[actorId,organizationId]);
 if(!allowed.rowCount)throw Object.assign(new Error('Your organization role no longer permits staff management'),{statusCode:403});
 const roles=await client.query('SELECT r.name FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=$1::uuid',[actorId]);
 return {isAdministrator:roles.rows.some(r=>r.name==='company_admin'),organizationType:organization.rows[0].type as string};
}
export function protectedStaff(message:string):never {
 throw Object.assign(new Error(message),{statusCode:409});
}
