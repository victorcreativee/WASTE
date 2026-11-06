import { dbPool } from "../config/database";
import { buildDailyWorkbook, DailyActivity, dayTotals, withStockAfter } from "../services/recycling-daily";

/** Everything recorded between two dates, read from one snapshot, newest first. */
export async function recyclingDailyActivity(org: string, from: string, to: string): Promise<DailyActivity> {
  const c = await dbPool.connect();
  try {
    await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const organization = (await c.query(`SELECT name FROM organizations WHERE id=$1::uuid AND type='recycling_company'`, [org])).rows[0];
    if (!organization) throw Object.assign(new Error("Daily records belong to recycling companies"), { statusCode: 403 });
    const period = [org, from, to];
    const purchases = (await c.query(`SELECT id,collected_on::text date,material_type material,source_name supplier,purchase_group_reference reference,quantity_kg::float8 quantity_kg,unit_purchase_price_ugx::float8 price_ugx,ROUND(quantity_kg*unit_purchase_price_ugx)::float8 material_cost_ugx,(worker_wages_ugx+food_ugx+transport_ugx+driver_fee_ugx+other_expense_ugx)::float8 other_costs_ugx,(ROUND(quantity_kg*unit_purchase_price_ugx)+worker_wages_ugx+food_ugx+transport_ugx+driver_fee_ugx+other_expense_ugx)::float8 total_ugx,INITCAP(purchase_payment_status) payment
      FROM recycling_material_lots WHERE organization_id=$1::uuid AND origin='purchase' AND collected_on BETWEEN $2::date AND $3::date ORDER BY collected_on DESC,created_at DESC,id`, period)).rows;
    const sales = (await c.query(`SELECT s.id,s.sold_on::text date,COALESCE((SELECT string_agg(DISTINCT l.material_type,', ') FROM recycling_sale_lots p JOIN recycling_material_lots l ON l.id=p.lot_id WHERE p.sale_id=s.id),(SELECT material_type FROM recycling_material_lots WHERE id=s.lot_id)) material,s.buyer_name buyer,s.invoice_number invoice,COALESCE(s.delivered_kg,s.quantity_kg)::float8 delivered_kg,s.quantity_kg::float8 paid_kg,s.unit_price_ugx::float8 price_ugx,ROUND(s.quantity_kg*s.unit_price_ugx)::float8 revenue_ugx,paid.amount::float8 received_ugx,GREATEST(ROUND(s.quantity_kg*s.unit_price_ugx)-paid.amount,0)::float8 balance_ugx
      FROM recycling_material_sales s CROSS JOIN LATERAL (SELECT COALESCE(SUM(amount_ugx),0) amount FROM recycling_sale_payments WHERE sale_id=s.id) paid WHERE s.organization_id=$1::uuid AND s.sold_on BETWEEN $2::date AND $3::date ORDER BY s.sold_on DESC,s.created_at DESC,s.id`, period)).rows;
    const float = (await c.query(`SELECT * FROM (SELECT f.id,f.transaction_date,f.transaction_date::text date,f.transaction_type "type",f.amount_ugx::float8 amount_ugx,SUM(CASE f.transaction_type WHEN 'given' THEN f.amount_ugx ELSE -f.amount_ugx END) OVER (ORDER BY f.transaction_date,f.created_at,f.id)::float8 balance_ugx,f.reference,CASE WHEN f.purchase_lot_id IS NOT NULL THEN 'Purchase' WHEN f.sale_id IS NOT NULL THEN 'Sale' WHEN f.sorting_batch_id IS NOT NULL THEN 'Sorting' WHEN f.expense_batch_reference IS NOT NULL THEN 'Expenses' ELSE '' END linked_to,f.notes,u.full_name recorded_by,f.created_at
      FROM recycling_manager_float_transactions f LEFT JOIN users u ON u.id=f.recorded_by WHERE f.organization_id=$1::uuid) x WHERE transaction_date BETWEEN $2::date AND $3::date ORDER BY transaction_date DESC,created_at DESC,id`, period)).rows;
    const sorting = (await c.query(`SELECT b.entry_id id,MIN(b.processed_on)::text date,MIN(l.material_type) input_material,MIN(b.output_material_type) output_material,SUM(b.input_kg)::float8 input_kg,SUM(b.output_kg)::float8 output_kg,SUM(b.rejected_kg)::float8 rejected_kg,SUM(b.processing_cost_ugx)::float8 cost_ugx,MAX(b.created_at)::text recorded_at
      FROM recycling_sorting_batches b JOIN recycling_material_lots l ON l.id=b.input_lot_id WHERE b.organization_id=$1::uuid AND b.processed_on BETWEEN $2::date AND $3::date GROUP BY b.entry_id ORDER BY MIN(b.processed_on) DESC,MAX(b.created_at) DESC`, period)).rows;
    const events = (await c.query(`SELECT created_at::text "at",material_type material,quantity_kg::float8 kg FROM recycling_material_lots WHERE organization_id=$1::uuid
      UNION ALL SELECT b.created_at::text,l.material_type,-b.input_kg::float8 FROM recycling_sorting_batches b JOIN recycling_material_lots l ON l.id=b.input_lot_id WHERE b.organization_id=$1::uuid
      UNION ALL SELECT s.created_at::text,l.material_type,-p.delivered_kg::float8 FROM recycling_sale_lots p JOIN recycling_material_sales s ON s.id=p.sale_id JOIN recycling_material_lots l ON l.id=p.lot_id WHERE s.organization_id=$1::uuid
      UNION ALL SELECT s.created_at::text,l.material_type,-COALESCE(s.delivered_kg,s.quantity_kg)::float8 FROM recycling_material_sales s JOIN recycling_material_lots l ON l.id=s.lot_id WHERE s.organization_id=$1::uuid AND NOT EXISTS(SELECT 1 FROM recycling_sale_lots p WHERE p.sale_id=s.id)
      UNION ALL SELECT a.created_at::text,l.material_type,(CASE WHEN a.adjustment_type='correction_in' THEN a.quantity_kg ELSE -a.quantity_kg END)::float8 FROM recycling_stock_adjustments a JOIN recycling_material_lots l ON l.id=a.lot_id WHERE a.organization_id=$1::uuid`, [org])).rows;
    await c.query("COMMIT");
    return { organization: organization.name, from, to, days: dayTotals(purchases, sales, float, sorting), purchases, sales, float, sorting: withStockAfter(sorting, events) };
  } catch (error) { await c.query("ROLLBACK"); throw error; } finally { c.release(); }
}

export const recyclingDailyWorkbook = async (org: string, from: string, to: string) => buildDailyWorkbook(await recyclingDailyActivity(org, from, to));
