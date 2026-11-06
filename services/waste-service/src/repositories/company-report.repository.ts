import { dbPool } from '../config/database';
import { buildCompanyReport, type CompanyReportRecords } from '../services/company-report';
type Client = { query: (sql: string, params: unknown[]) => Promise<{ rows: any[] }> };
/** Every record a company report reads. Expenses are limited to the period; the rest are needed in full to trace costs. */
export async function companyReportRecords(client: Client, organizationId: string, from: string, to: string): Promise<CompanyReportRecords> {
 const rows=async(sql:string)=>(await client.query(sql,[organizationId])).rows;
 const organization=(await rows('SELECT id,name,type FROM organizations WHERE id=$1::uuid'))[0];
 if(!organization)throw Object.assign(new Error('Organization not found'),{statusCode:404});
 return {
  organization,
  lots:await rows(`SELECT id,material_type,source_name,origin,quantity_kg,available_kg,unit_purchase_price_ugx,worker_wages_ugx,food_ugx,transport_ugx,driver_fee_ugx,other_expense_ugx,purchase_group_reference,collected_on::text FROM recycling_material_lots WHERE organization_id=$1::uuid ORDER BY collected_on,id`),
  sales:await rows(`SELECT id,lot_id,buyer_name,quantity_kg,delivered_kg,unit_price_ugx,worker_wages_ugx,food_ugx,transport_ugx,other_expense_ugx,sold_on::text FROM recycling_material_sales WHERE organization_id=$1::uuid ORDER BY sold_on,id`),
  saleLots:await rows('SELECT sale_id,lot_id,delivered_kg FROM recycling_sale_lots WHERE organization_id=$1::uuid'),
  sorting:await rows('SELECT input_lot_id,output_lot_id,input_kg,output_kg,rejected_kg,processing_cost_ugx,processed_on::text FROM recycling_sorting_batches WHERE organization_id=$1::uuid'),
  adjustments:await rows('SELECT lot_id,adjustment_type,quantity_kg,adjustment_date::text FROM recycling_stock_adjustments WHERE organization_id=$1::uuid'),
  expenses:(await client.query('SELECT id,expense_number,category,description,vendor,amount_ugx,status,expense_date::text FROM organization_expenses WHERE organization_id=$1::uuid AND expense_date BETWEEN $2::date AND $3::date ORDER BY expense_date,id',[organizationId,from,to])).rows,
  purchasePayments:await rows('SELECT lot_id,amount_ugx,paid_on::text FROM recycling_purchase_payments WHERE organization_id=$1::uuid'),
  salePayments:await rows('SELECT sale_id,amount_ugx,paid_on::text FROM recycling_sale_payments WHERE organization_id=$1::uuid'),
  float:await rows('SELECT transaction_type,transaction_date::text,amount_ugx,purchase_lot_id,sale_id,sorting_batch_id FROM recycling_manager_float_transactions WHERE organization_id=$1::uuid'),
 };
}
/** One read-only snapshot prevents purchases, payments and stock being read at different moments. */
export async function companyReport(organizationId: string, from: string, to: string) {
 const client=await dbPool.connect();
 try {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const report=buildCompanyReport(await companyReportRecords(client,organizationId,from,to),from,to);
  await client.query('COMMIT');return report;
 } catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
