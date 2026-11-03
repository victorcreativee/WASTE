import bcrypt from "bcrypt";
import type { PoolClient } from "pg";
import { dbPool } from "../config/database";
import type { DeleteOrganizationBusinessDayInput, ResetOrganizationInput } from "../validators/platform-organization.validator";

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

const businessDatePattern = /^\d{4}-\d{2}-\d{2}$/;

async function businessDayState(client: PoolClient, organizationId: string, operatingDate: string) {
  if (!businessDatePattern.test(operatingDate) || Number.isNaN(Date.parse(`${operatingDate}T00:00:00Z`))) {
    throw Object.assign(new Error("Choose a valid business date"), { statusCode: 400 });
  }
  const result = await client.query(
    `WITH purchase_lots AS (
       SELECT id FROM recycling_material_lots WHERE organization_id=$1::uuid AND origin='purchase' AND collected_on=$2::date
     ), day_batches AS (
       SELECT id,input_lot_id,output_lot_id FROM recycling_sorting_batches WHERE organization_id=$1::uuid AND processed_on=$2::date
     ), day_lots AS (
       SELECT id FROM purchase_lots UNION SELECT output_lot_id FROM day_batches
     ), day_sales AS (
       SELECT id,lot_id FROM recycling_material_sales WHERE organization_id=$1::uuid AND sold_on=$2::date
     ), blockers AS (
       SELECT 'sorting outside the selected date' reason,COUNT(*)::int count FROM recycling_sorting_batches b WHERE b.organization_id=$1::uuid AND b.processed_on<>$2::date AND (b.input_lot_id IN(SELECT id FROM day_lots) OR b.output_lot_id IN(SELECT id FROM day_lots))
       UNION ALL SELECT 'sales outside the selected date',COUNT(*)::int FROM recycling_material_sales s WHERE s.organization_id=$1::uuid AND s.sold_on<>$2::date AND s.lot_id IN(SELECT id FROM day_lots)
       UNION ALL SELECT 'stock adjustments outside the selected date',COUNT(*)::int FROM recycling_stock_adjustments a WHERE a.organization_id=$1::uuid AND a.adjustment_date<>$2::date AND a.lot_id IN(SELECT id FROM day_lots)
       UNION ALL SELECT 'purchase payments outside the selected date',COUNT(*)::int FROM recycling_purchase_payments p WHERE p.organization_id=$1::uuid AND p.paid_on<>$2::date AND p.lot_id IN(SELECT id FROM day_lots)
       UNION ALL SELECT 'sale payments outside the selected date',COUNT(*)::int FROM recycling_sale_payments p WHERE p.organization_id=$1::uuid AND p.paid_on<>$2::date AND p.sale_id IN(SELECT id FROM day_sales)
       UNION ALL SELECT 'later material lots linked to the selected date',COUNT(*)::int FROM recycling_material_lots l WHERE l.organization_id=$1::uuid AND l.collected_on<>$2::date AND l.source_lot_id IN(SELECT id FROM day_lots)
       UNION ALL SELECT 'manager-float entries outside the selected date',COUNT(*)::int FROM recycling_manager_float_transactions f WHERE f.organization_id=$1::uuid AND f.transaction_date<>$2::date AND (f.purchase_lot_id IN(SELECT id FROM day_lots) OR f.sale_id IN(SELECT id FROM day_sales) OR f.sorting_batch_id IN(SELECT id FROM day_batches))
     )
     SELECT jsonb_build_object(
       'purchases',(SELECT COUNT(*) FROM purchase_lots),
       'sales',(SELECT COUNT(*) FROM day_sales),
       'sortingBatches',(SELECT COUNT(*) FROM day_batches),
       'stockAdjustments',(SELECT COUNT(*) FROM recycling_stock_adjustments WHERE organization_id=$1::uuid AND adjustment_date=$2::date),
       'purchasePayments',(SELECT COUNT(*) FROM recycling_purchase_payments WHERE organization_id=$1::uuid AND paid_on=$2::date),
       'salePayments',(SELECT COUNT(*) FROM recycling_sale_payments WHERE organization_id=$1::uuid AND paid_on=$2::date),
       'floatTransactions',(SELECT COUNT(*) FROM recycling_manager_float_transactions WHERE organization_id=$1::uuid AND transaction_date=$2::date),
       'cashMovements',(SELECT COUNT(*) FROM recycling_cash_movements WHERE organization_id=$1::uuid AND movement_date=$2::date),
       'dailyClosures',(SELECT COUNT(*) FROM recycling_daily_closures WHERE organization_id=$1::uuid AND operating_date=$2::date)
     ) counts,
     COALESCE((SELECT jsonb_agg(jsonb_build_object('reason',reason,'count',count)) FROM blockers WHERE count>0),'[]'::jsonb) blockers`,
    [organizationId, operatingDate],
  );
  const counts = result.rows[0]?.counts || {};
  const blockers = result.rows[0]?.blockers || [];
  const linkedFinancialRecords = blockers.filter((item: { reason: string }) => item.reason.includes("payments outside") || item.reason.includes("manager-float entries outside"));
  const hardBlockers = blockers.filter((item: { reason: string }) => !linkedFinancialRecords.includes(item));
  return {
    operatingDate,
    counts,
    totalRecords: Object.values(counts).reduce((sum: number, count) => sum + Number(count), 0),
    blockers,
    linkedFinancialRecords,
    linkedFinancialRecordCount: linkedFinancialRecords.reduce((sum: number, item: { count: number }) => sum + Number(item.count), 0),
    hardBlockers,
    canDelete: blockers.length === 0,
    canDeleteWithLinkedFinancialRecords: hardBlockers.length === 0,
  };
}

export async function organizationBusinessDayPreview(organizationId: string, operatingDate: string) {
  const client = await dbPool.connect();
  try {
    const organization = await organizationContext(client, organizationId);
    const state = await businessDayState(client, organizationId, operatingDate);
    if (await tableExists(client, "factory_intakes")) {
      const linked = Number((await client.query(
        `SELECT COUNT(*)::int count FROM factory_intakes i JOIN recycling_material_sales s ON s.id=i.source_sale_id
         WHERE s.organization_id=$1::uuid AND s.sold_on=$2::date`, [organizationId, operatingDate],
      )).rows[0]?.count || 0);
      if (linked) {
        const blocker = { reason: "factory intake records linked to selected sales", count: linked };
        state.blockers.push(blocker); state.hardBlockers.push(blocker); state.canDelete = false; state.canDeleteWithLinkedFinancialRecords = false;
      }
    }
    return { organization, ...state };
  } finally { client.release(); }
}

export async function deleteOrganizationBusinessDay(actorId: string, organizationId: string, input: DeleteOrganizationBusinessDayInput) {
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`platform-reset:${organizationId}`]);
    await client.query("SELECT set_config('app.allow_audit_reset','true',true)");
    const organization = await organizationContext(client, organizationId, true);
    if (input.confirmationName !== organization.name) throw Object.assign(new Error("The typed company name does not exactly match"), { statusCode: 409 });
    const preview = await businessDayState(client, organizationId, input.operatingDate);
    if (await tableExists(client, "factory_intakes")) {
      const linked = Number((await client.query(
        `SELECT COUNT(*)::int count FROM factory_intakes i JOIN recycling_material_sales s ON s.id=i.source_sale_id
         WHERE s.organization_id=$1::uuid AND s.sold_on=$2::date`, [organizationId, input.operatingDate],
      )).rows[0]?.count || 0);
      if (linked) {
        const blocker = { reason: "factory intake records linked to selected sales", count: linked };
        preview.blockers.push(blocker); preview.hardBlockers.push(blocker); preview.canDeleteWithLinkedFinancialRecords = false;
      }
    }
    const unresolvedBlockers = input.includeLinkedFinancialRecords ? preview.hardBlockers : preview.blockers;
    if (unresolvedBlockers.length) throw Object.assign(new Error(input.includeLinkedFinancialRecords ? "This business day has operational records used by another date or organization. Remove those dependencies first or use a full operational reset." : "This business day has linked financial records. Preview the date and explicitly include those records before deleting."), { statusCode: 409, details: unresolvedBlockers });

    const ids = (await client.query(
      `SELECT
       ARRAY(SELECT id FROM recycling_material_lots WHERE organization_id=$1::uuid AND origin='purchase' AND collected_on=$2::date) purchase_lots,
       ARRAY(SELECT id FROM recycling_material_sales WHERE organization_id=$1::uuid AND sold_on=$2::date) sales,
       ARRAY(SELECT id FROM recycling_sorting_batches WHERE organization_id=$1::uuid AND processed_on=$2::date) batches,
       ARRAY(SELECT output_lot_id FROM recycling_sorting_batches WHERE organization_id=$1::uuid AND processed_on=$2::date) output_lots`,
      [organizationId, input.operatingDate],
    )).rows[0];

    await client.query(`DELETE FROM recycling_transaction_edits WHERE organization_id=$1::uuid AND ((transaction_type='purchase' AND transaction_id=ANY($2::uuid[])) OR (transaction_type='sale' AND transaction_id=ANY($3::uuid[])))`, [organizationId, ids.purchase_lots, ids.sales]);
    await client.query(
      `DELETE FROM recycling_manager_float_transactions WHERE organization_id=$1::uuid AND (transaction_date=$2::date OR ($3::boolean AND (purchase_lot_id=ANY($4::uuid[]) OR sale_id=ANY($5::uuid[]) OR sorting_batch_id=ANY($6::uuid[]))))`,
      [organizationId, input.operatingDate, input.includeLinkedFinancialRecords, ids.purchase_lots, ids.sales, ids.batches],
    );
    await client.query(`UPDATE recycling_material_lots l SET available_kg=LEAST(l.quantity_kg,l.available_kg+s.quantity),updated_at=CURRENT_TIMESTAMP FROM (SELECT lot_id,SUM(quantity_kg) quantity FROM recycling_material_sales WHERE organization_id=$1::uuid AND sold_on=$2::date GROUP BY lot_id)s WHERE l.id=s.lot_id`, [organizationId, input.operatingDate]);
    await client.query(`DELETE FROM recycling_material_sales WHERE organization_id=$1::uuid AND sold_on=$2::date`, [organizationId, input.operatingDate]);
    await client.query(`UPDATE recycling_material_lots l SET available_kg=GREATEST(0,LEAST(l.quantity_kg,l.available_kg+a.quantity)),updated_at=CURRENT_TIMESTAMP FROM (SELECT lot_id,SUM(CASE WHEN adjustment_type IN('loss','correction_out') THEN quantity_kg ELSE -quantity_kg END) quantity FROM recycling_stock_adjustments WHERE organization_id=$1::uuid AND adjustment_date=$2::date GROUP BY lot_id)a WHERE l.id=a.lot_id`, [organizationId, input.operatingDate]);
    await client.query(`DELETE FROM recycling_stock_adjustments WHERE organization_id=$1::uuid AND adjustment_date=$2::date`, [organizationId, input.operatingDate]);
    await client.query(`UPDATE recycling_material_lots l SET available_kg=LEAST(l.quantity_kg,l.available_kg+b.input_kg),updated_at=CURRENT_TIMESTAMP FROM (SELECT input_lot_id,SUM(input_kg) input_kg FROM recycling_sorting_batches WHERE organization_id=$1::uuid AND processed_on=$2::date GROUP BY input_lot_id)b WHERE l.id=b.input_lot_id`, [organizationId, input.operatingDate]);
    await client.query(`DELETE FROM recycling_sorting_batches WHERE organization_id=$1::uuid AND processed_on=$2::date`, [organizationId, input.operatingDate]);
    await client.query(`DELETE FROM recycling_material_lots WHERE organization_id=$1::uuid AND id=ANY($2::uuid[])`, [organizationId, ids.output_lots]);
    await client.query(`DELETE FROM recycling_purchase_payments WHERE organization_id=$1::uuid AND paid_on=$2::date`, [organizationId, input.operatingDate]);
    await client.query(`DELETE FROM recycling_sale_payments WHERE organization_id=$1::uuid AND paid_on=$2::date`, [organizationId, input.operatingDate]);
    await client.query(`DELETE FROM recycling_material_lots WHERE organization_id=$1::uuid AND id=ANY($2::uuid[])`, [organizationId, ids.purchase_lots]);
    await client.query(`DELETE FROM recycling_cash_movements WHERE organization_id=$1::uuid AND movement_date=$2::date`, [organizationId, input.operatingDate]);
    await client.query(`DELETE FROM recycling_daily_closures WHERE organization_id=$1::uuid AND operating_date=$2::date`, [organizationId, input.operatingDate]);
    await client.query(`UPDATE recycling_material_lots l SET purchase_payment_status=CASE WHEN COALESCE(p.paid,0)=0 THEN 'credit' WHEN p.paid>=ROUND(l.quantity_kg*l.unit_purchase_price_ugx+l.worker_wages_ugx+l.food_ugx+l.transport_ugx+l.driver_fee_ugx+l.other_expense_ugx) THEN 'paid' ELSE 'partially_paid' END FROM (SELECT lot_id,SUM(amount_ugx)::bigint paid FROM recycling_purchase_payments WHERE organization_id=$1::uuid GROUP BY lot_id)p WHERE l.organization_id=$1::uuid AND l.id=p.lot_id`, [organizationId]);
    await client.query(`UPDATE recycling_material_sales s SET status=CASE WHEN COALESCE(p.paid,0)=0 THEN 'recorded' WHEN p.paid>=ROUND(s.quantity_kg*s.unit_price_ugx) THEN 'paid' ELSE 'partially_paid' END FROM (SELECT sale_id,SUM(amount_ugx)::bigint paid FROM recycling_sale_payments WHERE organization_id=$1::uuid GROUP BY sale_id)p WHERE s.organization_id=$1::uuid AND s.id=p.sale_id`, [organizationId]);
    await client.query(`UPDATE recycling_material_lots SET purchase_payment_status='credit' WHERE organization_id=$1::uuid AND origin='purchase' AND NOT EXISTS(SELECT 1 FROM recycling_purchase_payments p WHERE p.lot_id=recycling_material_lots.id)`, [organizationId]);
    await client.query(`UPDATE recycling_material_sales SET status='recorded' WHERE organization_id=$1::uuid AND NOT EXISTS(SELECT 1 FROM recycling_sale_payments p WHERE p.sale_id=recycling_material_sales.id)`, [organizationId]);
    await client.query(`UPDATE recycling_material_lots SET status=CASE WHEN available_kg<=0 THEN 'sold' WHEN available_kg<quantity_kg THEN 'partially_sold' ELSE 'available' END WHERE organization_id=$1::uuid AND status<>'rejected'`, [organizationId]);

    await client.query(
      `INSERT INTO organization_data_resets(organization_id,reset_at,reset_by,mode,reason) VALUES($1::uuid,CURRENT_TIMESTAMP,$2::uuid,'data_only',$3)
       ON CONFLICT(organization_id) DO UPDATE SET reset_at=EXCLUDED.reset_at,reset_by=EXCLUDED.reset_by,mode=EXCLUDED.mode,reason=EXCLUDED.reason`,
      [organizationId, actorId, `Business day ${input.operatingDate} deleted: ${input.reason}`],
    );
    await client.query(
      `INSERT INTO platform_administration_events(actor_id,action,details) VALUES($1::uuid,'organization_business_day_deleted',$2::jsonb)`,
      [actorId, JSON.stringify({ organizationId, organizationName: organization.name, operatingDate: input.operatingDate, reason: input.reason, includeLinkedFinancialRecords: input.includeLinkedFinancialRecords, linkedFinancialRecords: input.includeLinkedFinancialRecords ? preview.linkedFinancialRecords : [], deletedRecords: preview.counts, totalRecords: preview.totalRecords + (input.includeLinkedFinancialRecords ? preview.linkedFinancialRecordCount : 0) })],
    );
    await client.query("COMMIT");
    return { organization, operatingDate: input.operatingDate, includeLinkedFinancialRecords: input.includeLinkedFinancialRecords, linkedFinancialRecords: input.includeLinkedFinancialRecords ? preview.linkedFinancialRecords : [], deletedRecords: preview.counts, totalRecords: preview.totalRecords + (input.includeLinkedFinancialRecords ? preview.linkedFinancialRecordCount : 0) };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function resetOrganization(actorId: string, organizationId: string, input: ResetOrganizationInput) {
  const passwordHash = input.mode === "data_and_credentials" ? await bcrypt.hash(input.temporaryPassword!, 12) : null;
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`platform-reset:${organizationId}`]);
    await client.query("SELECT set_config('app.allow_audit_reset','true',true)");
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
    await client.query(
      `INSERT INTO organization_data_resets(organization_id,reset_at,reset_by,mode,reason)
       VALUES($1::uuid,CURRENT_TIMESTAMP,$2::uuid,$3,$4)
       ON CONFLICT(organization_id) DO UPDATE SET reset_at=EXCLUDED.reset_at,reset_by=EXCLUDED.reset_by,mode=EXCLUDED.mode,reason=EXCLUDED.reason`,
      [organizationId, actorId, input.mode, input.reason],
    );

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
      if (await tableExists(client, "user_sessions")) {
        await client.query(
          `UPDATE user_sessions SET revoked_at=CURRENT_TIMESTAMP,revoked_reason='administrator'
           WHERE revoked_at IS NULL AND user_id IN (SELECT id FROM users WHERE organization_id=$1::uuid)`,
          [organizationId],
        );
      }
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
