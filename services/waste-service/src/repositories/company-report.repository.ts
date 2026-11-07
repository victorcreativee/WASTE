import { dbPool } from '../config/database';
import { buildCompanyReport, type CompanyReportRecords } from '../services/company-report';
import { buildCompanyWorkbook } from '../services/company-workbook';
type Client = { query: (sql: string, params: unknown[]) => Promise<{ rows: any[] }> };
/** Every record a company report reads. Expenses are limited to the period; the rest are needed in full to trace costs. */
export async function companyReportRecords(client: Client, organizationId: string, from: string, to: string): Promise<CompanyReportRecords> {
 const rows=async(sql:string)=>(await client.query(sql,[organizationId])).rows;
 const organization=(await rows('SELECT id,name,type FROM organizations WHERE id=$1::uuid'))[0];
 if(!organization)throw Object.assign(new Error('Organization not found'),{statusCode:404});
 return {
  organization,
  lots:await rows(`SELECT id,material_type,source_name,origin,quantity_kg,available_kg,unit_purchase_price_ugx,worker_wages_ugx,food_ugx,transport_ugx,driver_fee_ugx,other_expense_ugx,purchase_group_reference,source_lot_id,collected_on::text FROM recycling_material_lots WHERE organization_id=$1::uuid ORDER BY collected_on,id`),
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
/** The Excel workbook of a company report, read from the same kind of snapshot. */
export async function companyWorkbook(organizationId: string, from: string, to: string) {
 const client=await dbPool.connect();
 try {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const records=await companyReportRecords(client,organizationId,from,to);
  const loans=(await client.query(`SELECT l.lender_name,l.received_on::text,l.due_on::text,l.reference,l.amount_ugx::float8 amount_ugx,COALESCE((SELECT SUM(m.amount_ugx) FROM recycling_cash_movements m WHERE m.loan_id=l.id AND m.category='loan_repayment' AND m.movement_date<=$2::date),0)::float8 repaid_ugx FROM recycling_loans l WHERE l.organization_id=$1::uuid AND l.received_on<=$2::date ORDER BY l.received_on,l.id`,[organizationId,to])).rows;
  const cash=(await client.query(`SELECT movement_date::text,direction,category,amount_ugx::float8 amount_ugx,reference,counterparty,notes FROM recycling_cash_movements WHERE organization_id=$1::uuid AND movement_date BETWEEN $2::date AND $3::date ORDER BY movement_date,created_at,id`,[organizationId,from,to])).rows;
  await client.query('COMMIT');
  return {name:String(records.organization.name),file:await buildCompanyWorkbook(buildCompanyReport(records,from,to),records,loans,cash)};
 } catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
