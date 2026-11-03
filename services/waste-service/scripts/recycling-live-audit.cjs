#!/usr/bin/env node
/*
 * Read-only production health audit for one recycling company.
 *
 *   DATABASE_URL=... npm run audit:recycling-live -- --organization <uuid>
 *
 * The audit uses a repeatable-read, read-only transaction, prints aggregate
 * operational totals only, and exits non-zero when an integrity problem needs
 * attention. It never changes company records.
 */
const { Pool } = require("pg");

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const organizationId = argument("--organization") || process.env.RECYCLING_ORGANIZATION_ID;
const databaseUrl = process.env.DATABASE_URL;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

if (!databaseUrl) {
  console.error("ERROR: DATABASE_URL is required.");
  process.exit(2);
}
if (!organizationId || !uuid.test(organizationId)) {
  console.error("ERROR: Provide one recycling company UUID with --organization or RECYCLING_ORGANIZATION_ID.");
  process.exit(2);
}

function money(value) {
  return `UGX ${Number(value || 0).toLocaleString("en-US")}`;
}

async function main() {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  let failed = false;
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const organization = (await client.query(
      `SELECT id,name,type,is_active FROM organizations WHERE id=$1::uuid`,
      [organizationId],
    )).rows[0];
    if (!organization || organization.type !== "recycling_company") {
      throw new Error("The selected organization is not an existing recycling company.");
    }

    const finance = (await client.query(
      `SELECT
         EXISTS(SELECT 1 FROM organization_finance_settings WHERE organization_id=$1::uuid) configured,
         organization_cash_position($1::uuid)::bigint cash_position,
         COALESCE((SELECT SUM(CASE transaction_type WHEN 'given' THEN amount_ugx ELSE -amount_ugx END)
                   FROM recycling_manager_float_transactions WHERE organization_id=$1::uuid),0)::bigint float_balance`,
      [organizationId],
    )).rows[0];
    finance.office_cash = Number(finance.cash_position) - Number(finance.float_balance);

    const stock = (await client.query(
      `SELECT COUNT(*)::int purchase_lots,
              COALESCE(SUM(quantity_kg),0)::numeric purchased_kg,
              COALESCE(SUM(available_kg),0)::numeric available_kg,
              COUNT(*) FILTER (WHERE available_kg < 0 OR available_kg > quantity_kg)::int invalid_lots
       FROM recycling_material_lots
       WHERE organization_id=$1::uuid AND origin='purchase'`,
      [organizationId],
    )).rows[0];

    const trade = (await client.query(
      `SELECT
         (SELECT COUNT(*) FROM recycling_material_sales WHERE organization_id=$1::uuid)::int sales,
         COALESCE((SELECT SUM(quantity_kg) FROM recycling_material_sales WHERE organization_id=$1::uuid),0)::numeric sold_kg,
         COALESCE((SELECT SUM(ROUND(quantity_kg*unit_purchase_price_ugx)+worker_wages_ugx+food_ugx+transport_ugx+driver_fee_ugx+other_expense_ugx)
                   FROM recycling_material_lots WHERE organization_id=$1::uuid AND origin='purchase'),0)::bigint purchase_value,
         COALESCE((SELECT SUM(amount_ugx) FROM recycling_purchase_payments WHERE organization_id=$1::uuid),0)::bigint purchase_paid,
         COALESCE((SELECT SUM(ROUND(quantity_kg*unit_price_ugx)) FROM recycling_material_sales WHERE organization_id=$1::uuid),0)::bigint sale_value,
         COALESCE((SELECT SUM(amount_ugx) FROM recycling_sale_payments WHERE organization_id=$1::uuid),0)::bigint sale_received`,
      [organizationId],
    )).rows[0];

    const integrity = (await client.query(
      `SELECT
         (SELECT COUNT(*) FROM recycling_material_lots l JOIN users u ON u.id=l.created_by
          WHERE l.organization_id=$1::uuid AND u.organization_id IS DISTINCT FROM l.organization_id)::int lot_actor_mismatches,
         (SELECT COUNT(*) FROM recycling_manager_float_transactions f JOIN users u ON u.id=f.recorded_by
          WHERE f.organization_id=$1::uuid AND u.organization_id IS DISTINCT FROM f.organization_id)::int float_actor_mismatches,
         (SELECT COUNT(*) FROM recycling_purchase_payments p JOIN recycling_material_lots l ON l.id=p.lot_id
          WHERE p.organization_id=$1::uuid AND l.organization_id IS DISTINCT FROM p.organization_id)::int purchase_tenant_mismatches,
         (SELECT COUNT(*) FROM recycling_sale_payments p JOIN recycling_material_sales s ON s.id=p.sale_id
          WHERE p.organization_id=$1::uuid AND s.organization_id IS DISTINCT FROM p.organization_id)::int sale_tenant_mismatches,
         (SELECT COUNT(*) FROM desktop_sync_requests
          WHERE organization_id=$1::uuid AND state='processing' AND created_at < CURRENT_TIMESTAMP-INTERVAL '15 minutes')::int stuck_sync_requests`,
      [organizationId],
    )).rows[0];

    const activity = (await client.query(
      `SELECT
         COALESCE((SELECT MAX(collected_on)::text FROM recycling_material_lots WHERE organization_id=$1::uuid AND origin='purchase'),'never') latest_purchase,
         COALESCE((SELECT MAX(sold_on)::text FROM recycling_material_sales WHERE organization_id=$1::uuid),'never') latest_sale,
         COALESCE((SELECT MAX(operating_date)::text FROM recycling_daily_closures WHERE organization_id=$1::uuid AND status='closed'),'never') latest_closed_day,
         (SELECT COUNT(*) FROM desktop_sync_requests WHERE organization_id=$1::uuid AND state='completed' AND created_at>=CURRENT_DATE-INTERVAL '7 days')::int synced_last_7_days`,
      [organizationId],
    )).rows[0];

    await client.query("COMMIT");

    console.log(`\nRecycling live audit — ${organization.name}`);
    console.log(`Organization active: ${organization.is_active ? "yes" : "NO"}`);
    console.log(`Finance configured: ${finance.configured ? "yes" : "NO"}`);
    console.log(`Cash position: ${money(finance.cash_position)}`);
    console.log(`Manager float balance: ${money(finance.float_balance)}`);
    console.log(`Office cash after float: ${money(finance.office_cash)}`);
    console.log(`Purchase lots: ${stock.purchase_lots}; purchased ${stock.purchased_kg} kg; available ${stock.available_kg} kg`);
    console.log(`Purchase value / paid: ${money(trade.purchase_value)} / ${money(trade.purchase_paid)}`);
    console.log(`Sales: ${trade.sales}; sold ${trade.sold_kg} kg`);
    console.log(`Sales value / received: ${money(trade.sale_value)} / ${money(trade.sale_received)}`);
    console.log(`Latest purchase / sale / closed day: ${activity.latest_purchase} / ${activity.latest_sale} / ${activity.latest_closed_day}`);
    console.log(`Completed device sync requests in 7 days: ${activity.synced_last_7_days}`);

    const checks = [
      [organization.is_active, "organization is inactive"],
      [finance.configured, "opening finance balance has not been configured"],
      [Number(finance.cash_position) >= 0, "cash position is negative"],
      [Number(finance.float_balance) >= 0, "manager float balance is negative"],
      [finance.office_cash >= 0, "office cash after manager float is negative"],
      [Number(stock.invalid_lots) === 0, `${stock.invalid_lots} stock lot(s) have an impossible available quantity`],
      [Number(integrity.lot_actor_mismatches) === 0, `${integrity.lot_actor_mismatches} purchase actor tenant mismatch(es)`],
      [Number(integrity.float_actor_mismatches) === 0, `${integrity.float_actor_mismatches} float actor tenant mismatch(es)`],
      [Number(integrity.purchase_tenant_mismatches) === 0, `${integrity.purchase_tenant_mismatches} purchase payment tenant mismatch(es)`],
      [Number(integrity.sale_tenant_mismatches) === 0, `${integrity.sale_tenant_mismatches} sale payment tenant mismatch(es)`],
      [Number(integrity.stuck_sync_requests) === 0, `${integrity.stuck_sync_requests} server sync request(s) have been processing for over 15 minutes`],
    ];
    const problems = checks.filter(([ok]) => !ok).map(([, message]) => message);
    if (problems.length) {
      failed = true;
      console.error("\nATTENTION REQUIRED:");
      problems.forEach((message) => console.error(`- ${message}`));
    } else {
      console.log("\nPASS: no financial, stock, tenant, or server-sync integrity problem was detected.");
    }
    console.log("Note: unsent operations still held only on an offline device cannot be seen by this server-side audit.");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch (_) { /* transaction may already be closed */ }
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 2;
});
