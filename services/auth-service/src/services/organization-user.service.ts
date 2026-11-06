import { randomBytes, randomUUID } from "node:crypto";
import { normalizeUgandanPhone } from "../utils/sms";
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
import { issueEmailVerification } from "./email-verification.service";

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
    const allowedRoles=actor.organizationType==='recycling_company'?["recycling_collector","recycling_sales","recycling_field_manager","company_owner","company_investor"]:actor.organizationType==='processing_plant'?["supervisor"]:["supervisor","driver"];
    if(!allowedRoles.includes(input.role))protectedStaff(actor.organizationType==='recycling_company'?"Choose a recycling field manager, collection worker or industrial sales worker role":actor.organizationType==='processing_plant'?"Factories add supervisors; drivers belong to collection companies":"Choose a supervisor or driver role");
    const result = await createOrganizationStaffRecord(client, {
      organizationId,
      fullName: input.fullName,
      email: input.email,
      phone: input.phone,
      passwordHash,
      role: input.role,
      licenseNumber: input.licenseNumber,
    });
    if(input.role==="company_owner")await client.query(
      `WITH membership AS (
        INSERT INTO organization_memberships(organization_id,user_id,status)
        VALUES($1::uuid,$2::uuid,'active')
        ON CONFLICT(organization_id,user_id) DO UPDATE SET status='active',updated_at=CURRENT_TIMESTAMP
        RETURNING id
       ),owner_role AS (
        INSERT INTO organization_roles(organization_id,name,legacy_role_name)
        VALUES($1::uuid,'Company owner','company_owner')
        ON CONFLICT(organization_id,legacy_role_name) DO UPDATE SET name=EXCLUDED.name
        RETURNING id
       ),grants AS (
        INSERT INTO organization_role_permissions(organization_id,role_id,permission_code)
        SELECT $1::uuid,owner_role.id,permission.code FROM owner_role
        JOIN organization_permission_catalog permission ON permission.code IN (
         'reports.organization.read','finance.read','inventory.read','procurement.read','payables.read',
         'billing.read','customers.read','contracts.read','fleet.read','staff.read','attendance.read','recycling.read')
        ON CONFLICT(role_id,permission_code) DO NOTHING
       )
       INSERT INTO organization_membership_roles(organization_id,membership_id,role_id)
       SELECT $1::uuid,membership.id,owner_role.id FROM membership,owner_role ON CONFLICT DO NOTHING`,
      [organizationId,result.user.id],
    );
    if(input.role==="company_investor")await client.query(
      `WITH membership AS (
        INSERT INTO organization_memberships(organization_id,user_id,status)
        VALUES($1::uuid,$2::uuid,'active')
        ON CONFLICT(organization_id,user_id) DO UPDATE SET status='active',updated_at=CURRENT_TIMESTAMP
        RETURNING id
       ),investor_role AS (
        INSERT INTO organization_roles(organization_id,name,legacy_role_name)
        VALUES($1::uuid,'Investor / guest','company_investor')
        ON CONFLICT(organization_id,legacy_role_name) DO UPDATE SET name=EXCLUDED.name
        RETURNING id
       )
       INSERT INTO organization_membership_roles(organization_id,membership_id,role_id)
       SELECT $1::uuid,membership.id,investor_role.id FROM membership,investor_role ON CONFLICT DO NOTHING`,
      [organizationId,result.user.id],
    );
    if(input.role==="recycling_field_manager")await client.query(
      `INSERT INTO organization_role_permissions(organization_id,role_id,permission_code)
       SELECT $1::uuid,role.id,permission.code
       FROM organization_roles role
       JOIN organizations organization ON organization.id=role.organization_id
       CROSS JOIN (VALUES
        ('staff.read'),('attendance.read'),('attendance.manage'),('reports.organization.read'),
        ('finance.read'),('finance.expense.create'),
        ('recycling.read'),('recycling.purchase.create'),('recycling.local_sale.create'),
        ('recycling.industrial_sale.manage'),('recycling.inventory.manage'),
        ('recycling.field_float.manage'),('recycling.purchase_payment.manage'),
        ('recycling.transaction.edit'),
        ('recycling.daily_close.manage')
       ) permission(code)
       WHERE role.organization_id=$1::uuid AND organization.type='recycling_company'
         AND role.legacy_role_name='recycling_field_manager'
       ON CONFLICT(role_id,permission_code) DO NOTHING`,
      [organizationId],
    );
    await client.query("COMMIT");
    const verification=await issueEmailVerification(result.user.id);
    return {...result,verificationRequired:true,verificationEmailSent:verification.sent};
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
    // A household without email gets a reserved placeholder address and an unusable random password: it signs in
    // with the private link or SMS code instead.
    const phone = input.phone ? normalizeUgandanPhone(input.phone) ?? input.phone : undefined;
    const result = await createOrganizationCustomerRecord(client, {
      organizationId, ...input, phone,
      email: input.email ?? `household-${randomUUID()}@households.kampalawms.invalid`,
      passwordHash: await bcrypt.hash(input.password ?? randomBytes(32).toString("hex"), 12),
      emailVerificationRequired: Boolean(input.email),
    });
    await client.query("COMMIT");
    if(!input.email)return {...result,verificationRequired:false,verificationEmailSent:false};
    const verification=await issueEmailVerification(result.user.id);
    return {...result,verificationRequired:true,verificationEmailSent:verification.sent};
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
