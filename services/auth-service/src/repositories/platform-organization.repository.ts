import bcrypt from "bcrypt";
import type { PoolClient } from "pg";
import { dbPool } from "../config/database";
import type { ResetOrganizationInput } from "../validators/platform-organization.validator";

const operationalTables = [
  "desktop_sync_requests",
  "recycling_transaction_edits",
  "recycling_payment_followups",
  "recycling_sale_payments",
  "recycling_purchase_payments",
  "recycling_sorting_batches",
  "recycling_stock_adjustments",
  "recycling_manager_float_transactions",
  "recycling_cash_movements",
  "recycling_material_sales",
  "recycling_material_lots",
  "recycling_trade_partners",
  "recycling_daily_closures",
  "supplier_payments",
  "supplier_bills",
  "purchase_orders",
  "purchase_requests",
  "inventory_movements",
  "inventory_items",
  "suppliers",
  "organization_expenses",
  "payroll_lines",
  "payroll_periods",
  "staff_attendance",
  "organization_finance_setting_history",
] as const;

async function tableExists(client: PoolClient, table: string) {
  return Boolean((await client.query("SELECT to_regclass($1) IS NOT NULL AS present", [`public.${table}`])).rows[0]?.present);
}

async function countRows(client: PoolClient, table: string, organizationId: string) {
  if (!(await tableExists(client, table))) return 0;
  const result = await client.query(`SELECT COUNT(*)::int AS count FROM ${table} WHERE organization_id=$1::uuid`, [organizationId]);
  return Number(result.rows[0]?.count || 0);
}

async function organizationContext(client: PoolClient, organizationId: string, lock = false) {
  const result = await client.query(
    `SELECT id,name,type,is_active FROM organizations WHERE id=$1::uuid${lock ? " FOR UPDATE" : ""}`,
    [organizationId],
  );
  const organization = result.rows[0];
  if (!organization || organization.type !== "recycling_company") {
    throw Object.assign(new Error("Choose a registered recycling company"), { statusCode: 404 });
  }
  return organization;
}

async function administrators(client: PoolClient, organizationId: string) {
  const result = await client.query(
    `SELECT DISTINCT u.id,u.full_name,u.email,u.status
     FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id
     WHERE u.organization_id=$1::uuid AND r.name='company_admin'
     ORDER BY u.full_name,u.id`,
    [organizationId],
  );
  return result.rows;
}

export async function organizationResetPreview(organizationId: string) {
  const client = await dbPool.connect();
  try {
    const organization = await organizationContext(client, organizationId);
    const counts: Record<string, number> = {};
    for (const table of operationalTables) counts[table] = await countRows(client, table, organizationId);
    const users = await client.query("SELECT COUNT(*)::int AS count FROM users WHERE organization_id=$1::uuid", [organizationId]);
    return { organization, counts, totalOperationalRecords: Object.values(counts).reduce((sum, count) => sum + count, 0), userCount: Number(users.rows[0]?.count || 0), administrators: await administrators(client, organizationId) };
  } finally { client.release(); }
}

export async function resetOrganization(actorId: string, organizationId: string, input: ResetOrganizationInput) {
  const passwordHash = input.mode === "data_and_credentials" ? await bcrypt.hash(input.temporaryPassword!, 12) : null;
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`platform-reset:${organizationId}`]);
    const organization = await organizationContext(client, organizationId, true);
    if (input.confirmationName !== organization.name) throw Object.assign(new Error("The typed company name does not exactly match"), { statusCode: 409 });

    const before: Record<string, number> = {};
    for (const table of operationalTables) {
      if (!(await tableExists(client, table))) continue;
      const deleted = await client.query(`DELETE FROM ${table} WHERE organization_id=$1::uuid`, [organizationId]);
      before[table] = deleted.rowCount || 0;
    }
    if (await tableExists(client, "organization_finance_settings")) {
      await client.query(
        `INSERT INTO organization_finance_settings(organization_id,opening_balance_ugx,as_of_date,updated_by)
         VALUES($1::uuid,0,CURRENT_DATE,NULL)
         ON CONFLICT(organization_id) DO UPDATE SET opening_balance_ugx=0,as_of_date=CURRENT_DATE,updated_by=NULL,updated_at=CURRENT_TIMESTAMP`,
        [organizationId],
      );
    }

    let credentialsReset = 0;
    if (input.mode === "data_and_credentials") {
      const admins = await administrators(client, organizationId);
      if (!admins.some((user) => user.id === input.administratorUserId)) throw Object.assign(new Error("Choose an existing company administrator"), { statusCode: 409 });
      const disabled = await client.query(
        `UPDATE users SET status='suspended',password_hash=concat('revoked:',id::text,':',extract(epoch from clock_timestamp())::text),updated_at=CURRENT_TIMESTAMP
         WHERE organization_id=$1::uuid`,
        [organizationId],
      );
      credentialsReset = disabled.rowCount || 0;
      await client.query("UPDATE organization_memberships SET status='suspended',updated_at=CURRENT_TIMESTAMP WHERE organization_id=$1::uuid", [organizationId]);
      await client.query("UPDATE users SET status='active',password_hash=$2,updated_at=CURRENT_TIMESTAMP WHERE id=$1::uuid AND organization_id=$3::uuid", [input.administratorUserId, passwordHash, organizationId]);
      await client.query(
        `INSERT INTO organization_memberships(organization_id,user_id,status)
         VALUES($1::uuid,$2::uuid,'active')
         ON CONFLICT(organization_id,user_id) DO UPDATE SET status='active',updated_at=CURRENT_TIMESTAMP`,
        [organizationId, input.administratorUserId],
      );
      await client.query(
        `INSERT INTO organization_membership_roles(organization_id,membership_id,role_id)
         SELECT $1::uuid,membership.id,role.id
         FROM organization_memberships membership
         JOIN organization_roles role ON role.organization_id=membership.organization_id AND role.legacy_role_name='company_admin'
         WHERE membership.organization_id=$1::uuid AND membership.user_id=$2::uuid
         ON CONFLICT DO NOTHING`,
        [organizationId, input.administratorUserId],
      );
    }

    const totalOperationalRecords = Object.values(before).reduce((sum, count) => sum + count, 0);
    await client.query(
      `INSERT INTO platform_administration_events(actor_id,action,details)
       VALUES($1::uuid,'organization_reset',$2::jsonb)`,
      [actorId, JSON.stringify({ organizationId, organizationName: organization.name, mode: input.mode, reason: input.reason, deletedRecords: before, totalOperationalRecords, credentialsReset, retainedAdministratorUserId: input.administratorUserId || null })],
    );
    await client.query("COMMIT");
    return { organization, mode: input.mode, deletedRecords: before, totalOperationalRecords, credentialsReset, retainedAdministratorUserId: input.administratorUserId || null };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
