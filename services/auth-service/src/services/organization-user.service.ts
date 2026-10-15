import bcrypt from "bcrypt";
import { dbPool } from "../config/database";
import { authorizeStaffWrite, protectedStaff } from "../repositories/staff-authorization";
import {
  createOrganizationStaffRecord,
  findOrganizationUsers,
  updateOrganizationUserStatus,
  replaceSupervisorDrivers,
  createOrganizationCustomerRecord,
} from "../repositories/organization-user.repository";
import { CreateOrganizationCustomerInput, CreateOrganizationUserInput } from "../validators/auth.validator";

export async function listOrganizationUsers(organizationId: string) {
  return findOrganizationUsers(organizationId);
}

export async function createOrganizationUser(organizationId: string, input: CreateOrganizationUserInput, actorId: string) {
  const passwordHash = await bcrypt.hash(input.password, 12);
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const actor=await authorizeStaffWrite(client,organizationId,actorId);
    if(!actor.isAdministrator)protectedStaff("Only the company administrator can create staff accounts");
    const allowedRoles=actor.organizationType==='recycling_company'?["recycling_collector","recycling_sales","recycling_field_manager"]:["supervisor","driver"];
    if(!allowedRoles.includes(input.role))protectedStaff(actor.organizationType==='recycling_company'?"Choose a recycling field manager, collection worker or industrial sales worker role":"Choose a supervisor or driver role");
    const result = await createOrganizationStaffRecord(client, {
      organizationId,
      fullName: input.fullName,
      email: input.email,
      phone: input.phone,
      passwordHash,
      role: input.role,
      licenseNumber: input.licenseNumber,
    });
    if(input.role==="recycling_field_manager")await client.query(
      `INSERT INTO organization_role_permissions(organization_id,role_id,permission_code)
       SELECT $1::uuid,role.id,'recycling.field_float.manage'
       FROM organization_roles role
       JOIN organizations organization ON organization.id=role.organization_id
       WHERE role.organization_id=$1::uuid AND organization.type='recycling_company'
         AND role.legacy_role_name='recycling_field_manager'
       ON CONFLICT(role_id,permission_code) DO NOTHING`,
      [organizationId],
    );
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    if ((error as { code?: string }).code === "23505") {
      const conflict = new Error("This email address is already registered") as Error & { statusCode?: number };
      conflict.statusCode = 409;
      throw conflict;
    }
    throw error;
  } finally { client.release(); }
}

export async function createOrganizationCustomer(organizationId: string, input: CreateOrganizationCustomerInput, actorId: string) {
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('wms.actor_id',$1,true)",[actorId]);
    const result = await createOrganizationCustomerRecord(client, {
      organizationId, ...input, passwordHash: await bcrypt.hash(input.password, 12),
    });
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    if ((error as { code?: string }).code === "23505") {
      const conflict = new Error("This email address is already registered") as Error & { statusCode?: number };
      conflict.statusCode = 409;
      throw conflict;
    }
    throw error;
  } finally { client.release(); }
}

export async function changeOrganizationUserStatus(userId: string, organizationId: string, status: string, actorId: string) {
  return updateOrganizationUserStatus(userId, organizationId, status, actorId);
}

export async function assignDriversToSupervisor(supervisorUserId: string, driverIds: string[], organizationId: string, actorId: string) {
  return replaceSupervisorDrivers(supervisorUserId, driverIds, organizationId, actorId);
}
