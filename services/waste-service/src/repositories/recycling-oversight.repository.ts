import { dbPool } from "../config/database";
import { OVERSIGHT_THRESHOLDS, Period, recoveryRate, recyclerFlags, standingOf } from "../services/recycling-oversight.rules";
import { factoriesOverview } from "./factory.repository";

// Read-only, city-wide view of recycling for KCCA. Volumes only: no prices, customers, suppliers or cash.
// Collected = purchased lots (sorting outputs are re-labelled stock, not new material); rejected lots are excluded.

const num = (value: unknown) => Number(value ?? 0);

/** Material category from the company's own catalogue; unknown names fall into "other". */
const CATEGORY = `COALESCE((SELECT c.category FROM recycling_material_catalog c
  WHERE c.organization_id=l.organization_id AND lower(c.name)=lower(l.material_type) LIMIT 1),'other')`;

export async function today() {
  return (await dbPool.query("SELECT CURRENT_DATE::text AS today")).rows[0].today as string;
}

async function recyclerRows(period: Period, organizationId: string | null) {
  const { rows } = await dbPool.query(
    `WITH orgs AS (
       SELECT o.id,o.name,o.is_active,o.created_at FROM organizations o
       WHERE o.type='recycling_company' AND ($3::uuid IS NULL OR o.id=$3::uuid)
     ), activity AS (
       SELECT organization_id,collected_on AS day FROM recycling_material_lots WHERE origin='purchase' AND status<>'rejected'
       UNION SELECT organization_id,processed_on FROM recycling_sorting_batches
       UNION SELECT organization_id,sold_on FROM recycling_material_sales
     )
     SELECT o.id,o.name,o.is_active,
       COALESCE((SELECT SUM(quantity_kg) FROM recycling_material_lots WHERE organization_id=o.id AND origin='purchase' AND status<>'rejected' AND collected_on BETWEEN $1 AND $2),0) AS collected_kg,
       COALESCE((SELECT SUM(quantity_kg) FROM recycling_material_sales WHERE organization_id=o.id AND sold_on BETWEEN $1 AND $2),0) AS sold_kg,
       COALESCE((SELECT SUM(input_kg) FROM recycling_sorting_batches WHERE organization_id=o.id AND processed_on BETWEEN $1 AND $2),0) AS sorting_input_kg,
       COALESCE((SELECT SUM(output_kg) FROM recycling_sorting_batches WHERE organization_id=o.id AND processed_on BETWEEN $1 AND $2),0) AS sorted_kg,
       COALESCE((SELECT SUM(rejected_kg) FROM recycling_sorting_batches WHERE organization_id=o.id AND processed_on BETWEEN $1 AND $2),0) AS residue_kg,
       COALESCE((SELECT SUM(available_kg) FROM recycling_material_lots WHERE organization_id=o.id AND status IN('available','partially_sold')),0) AS stock_kg,
       COALESCE((SELECT SUM(available_kg) FROM recycling_material_lots WHERE organization_id=o.id AND status IN('available','partially_sold')
         AND collected_on<CURRENT_DATE-$4::int),0) AS aged_stock_kg,
       (SELECT MAX(day)::text FROM activity a WHERE a.organization_id=o.id AND a.day<=$2) AS last_activity,
       (SELECT COUNT(DISTINCT day)::int FROM activity a WHERE a.organization_id=o.id AND a.day BETWEEN $1 AND $2) AS active_days,
       (SELECT COUNT(*)::int FROM recycling_daily_closures dc WHERE dc.organization_id=o.id AND dc.status='closed' AND dc.operating_date BETWEEN $1 AND $2
          AND dc.operating_date IN (SELECT day FROM activity a WHERE a.organization_id=o.id)) AS closed_days,
       permit.permit_number,permit.status AS permit_status,permit.valid_until AS permit_valid_until
     FROM orgs o
     LEFT JOIN LATERAL (
       SELECT p.permit_number,p.status,p.valid_until::text AS valid_until FROM organization_permit_applications p
       WHERE p.organization_id=o.id AND p.permit_number IS NOT NULL
       ORDER BY (p.status IN('approved','suspended')) DESC,p.valid_until DESC NULLS LAST,p.created_at DESC LIMIT 1
     ) permit ON true
     ORDER BY o.name`,
    [period.from, period.to, organizationId, OVERSIGHT_THRESHOLDS.agedStockDays]);
  return rows;
}

function withStanding(row: any, dateToday: string) {
  const metrics = {
    collected_kg: num(row.collected_kg), sold_kg: num(row.sold_kg), sorting_input_kg: num(row.sorting_input_kg),
    sorted_kg: num(row.sorted_kg), residue_kg: num(row.residue_kg), stock_kg: num(row.stock_kg), aged_stock_kg: num(row.aged_stock_kg),
    last_activity: row.last_activity, active_days: row.active_days, closed_days: row.closed_days,
    permit: row.permit_number ? { status: row.permit_status, valid_until: row.permit_valid_until } : null,
  };
  const flags = recyclerFlags(metrics, dateToday);
  return {
    id: row.id, name: row.name, is_active: row.is_active, ...metrics,
    permit_number: row.permit_number ?? null,
    flags, standing: standingOf(flags),
  };
}

async function categoryBreakdown(period: Period, organizationId: string | null) {
  const { rows } = await dbPool.query(
    `WITH collected AS (
       SELECT ${CATEGORY} AS category,SUM(l.quantity_kg) AS kg FROM recycling_material_lots l
       JOIN organizations o ON o.id=l.organization_id AND o.type='recycling_company'
       WHERE l.origin='purchase' AND l.status<>'rejected' AND l.collected_on BETWEEN $1 AND $2 AND ($3::uuid IS NULL OR l.organization_id=$3::uuid)
       GROUP BY 1
     ), sold AS (
       SELECT ${CATEGORY} AS category,SUM(s.quantity_kg) AS kg FROM recycling_material_sales s
       JOIN recycling_material_lots l ON l.id=s.lot_id
       JOIN organizations o ON o.id=s.organization_id AND o.type='recycling_company'
       WHERE s.sold_on BETWEEN $1 AND $2 AND ($3::uuid IS NULL OR s.organization_id=$3::uuid)
       GROUP BY 1
     )
     SELECT COALESCE(c.category,s.category) AS category,COALESCE(c.kg,0) AS collected_kg,COALESCE(s.kg,0) AS sold_kg
     FROM collected c FULL JOIN sold s ON s.category=c.category
     ORDER BY COALESCE(c.kg,0)+COALESCE(s.kg,0) DESC`,
    [period.from, period.to, organizationId]);
  return rows.map(row => ({ category: row.category, collected_kg: num(row.collected_kg), sold_kg: num(row.sold_kg) }));
}

/** Six calendar months ending with the month of the period end. */
async function monthlyTrend(period: Period, organizationId: string | null) {
  const { rows } = await dbPool.query(
    `WITH months AS (
       SELECT generate_series(date_trunc('month',$1::date)-interval '5 months',date_trunc('month',$1::date),interval '1 month')::date AS month
     )
     SELECT to_char(m.month,'YYYY-MM') AS month,
       COALESCE((SELECT SUM(l.quantity_kg) FROM recycling_material_lots l JOIN organizations o ON o.id=l.organization_id AND o.type='recycling_company'
         WHERE l.origin='purchase' AND l.status<>'rejected' AND l.collected_on>=m.month AND l.collected_on<m.month+interval '1 month'
           AND l.collected_on<=$1 AND ($2::uuid IS NULL OR l.organization_id=$2::uuid)),0) AS collected_kg,
       COALESCE((SELECT SUM(s.quantity_kg) FROM recycling_material_sales s JOIN organizations o ON o.id=s.organization_id AND o.type='recycling_company'
         WHERE s.sold_on>=m.month AND s.sold_on<m.month+interval '1 month' AND s.sold_on<=$1 AND ($2::uuid IS NULL OR s.organization_id=$2::uuid)),0) AS sold_kg
     FROM months m ORDER BY m.month`,
    [period.to, organizationId]);
  return rows.map(row => ({ month: row.month, collected_kg: num(row.collected_kg), sold_kg: num(row.sold_kg) }));
}

/** Where recovered material goes, by the buyer industry recorded on each sale. */
async function destinationIndustries(period: Period, organizationId: string | null) {
  const { rows } = await dbPool.query(
    `SELECT initcap(lower(trim(s.industry))) AS industry,SUM(s.quantity_kg) AS kg,COUNT(DISTINCT s.organization_id)::int AS recyclers
     FROM recycling_material_sales s JOIN organizations o ON o.id=s.organization_id AND o.type='recycling_company'
     WHERE s.sold_on BETWEEN $1 AND $2 AND ($3::uuid IS NULL OR s.organization_id=$3::uuid)
     GROUP BY 1 ORDER BY 2 DESC LIMIT 12`,
    [period.from, period.to, organizationId]);
  return rows.map(row => ({ industry: row.industry, kg: num(row.kg), recyclers: row.recyclers }));
}

export async function cityOverview(period: Period) {
  const dateToday = await today();
  const [recyclers, categories, monthly, industries, disposal, factories] = await Promise.all([
    recyclerRows(period, null),
    categoryBreakdown(period, null),
    monthlyTrend(period, null),
    destinationIndustries(period, null),
    dbPool.query("SELECT COALESCE(SUM(net_kg),0) AS kg FROM weighbridge_transactions WHERE status='completed' AND operation_date BETWEEN $1 AND $2", [period.from, period.to]),
    factoriesOverview(period.from, period.to),
  ]);
  const rows = recyclers.map(row => withStanding(row, dateToday)).filter(row => row.is_active || row.collected_kg || row.sold_kg);
  const sum = (key: "collected_kg" | "sold_kg" | "sorted_kg" | "residue_kg" | "stock_kg") => rows.reduce((total, row) => total + row[key], 0);
  const disposedKg = num(disposal.rows[0].kg);
  return {
    period,
    today: dateToday,
    totals: {
      collected_kg: sum("collected_kg"),
      sold_kg: sum("sold_kg"),
      sorted_kg: sum("sorted_kg"),
      residue_kg: sum("residue_kg"),
      stock_kg: sum("stock_kg"),
      disposed_kg: disposedKg,
      recovery_rate: recoveryRate(sum("collected_kg"), disposedKg),
      recyclers: rows.length,
      active_recyclers: rows.filter(row => row.active_days > 0).length,
      needing_action: rows.filter(row => row.standing === "action").length,
      on_watch: rows.filter(row => row.standing === "watch").length,
    },
    categories,
    monthly,
    industries,
    recyclers: rows.sort((a, b) => ({ action: 0, watch: 1, good: 2 }[a.standing] - { action: 0, watch: 1, good: 2 }[b.standing]) || b.collected_kg - a.collected_kg),
    factories,
    thresholds: OVERSIGHT_THRESHOLDS,
  };
}

export async function recyclerDetail(organizationId: string, period: Period) {
  const dateToday = await today();
  const [rows, categories, monthly, industries, closures, agedLots] = await Promise.all([
    recyclerRows(period, organizationId),
    categoryBreakdown(period, organizationId),
    monthlyTrend(period, organizationId),
    destinationIndustries(period, organizationId),
    dbPool.query(
      `SELECT operating_date::text AS operating_date,status,closed_at,reopen_reason FROM recycling_daily_closures
       WHERE organization_id=$1::uuid ORDER BY operating_date DESC LIMIT 14`, [organizationId]),
    dbPool.query(
      `SELECT material_type,SUM(available_kg) AS kg,MIN(collected_on)::text AS oldest FROM recycling_material_lots
       WHERE organization_id=$1::uuid AND status IN('available','partially_sold') AND collected_on<CURRENT_DATE-$2::int
       GROUP BY material_type ORDER BY 2 DESC LIMIT 10`, [organizationId, OVERSIGHT_THRESHOLDS.agedStockDays]),
  ]);
  if (!rows[0]) return null;
  return {
    period,
    recycler: withStanding(rows[0], dateToday),
    categories,
    monthly,
    industries,
    closures: closures.rows,
    aged_stock: agedLots.rows.map(row => ({ material_type: row.material_type, kg: num(row.kg), oldest: row.oldest })),
  };
}
