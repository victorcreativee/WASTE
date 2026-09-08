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
    if(!actor.isAdministrator&&input.role!=="driver")protectedStaff("Only company administrators can create supervisor accounts");
    const result = await createOrganizationStaffRecord(client, {
      organizationId,
      fullName: input.fullName,
      email: input.email,
      phone: input.phone,
      passwordHash,
      role: input.role,
      licenseNumber: input.licenseNumber,
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
