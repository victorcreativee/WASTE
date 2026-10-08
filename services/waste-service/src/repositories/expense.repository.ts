import { dbPool } from '../config/database';
export async function findExpenses(organizationId:string|null){
 const rows=await dbPool.query(`SELECT e.*,u.full_name AS created_by_name,a.full_name AS approved_by_name FROM organization_expenses e LEFT JOIN users u ON u.id=e.created_by LEFT JOIN users a ON a.id=e.approved_by WHERE ($1::uuid IS NULL OR e.organization_id=$1::uuid) ORDER BY e.expense_date DESC,e.created_at DESC`,[organizationId]);
 const recycling=await dbPool.query(`
  SELECT * FROM (
   SELECT l.id,('REC-PUR-'||UPPER(LEFT(l.id::text,8))) expense_number,'materials' category,
    ('Material purchase: '||l.material_type) description,l.source_name vendor,
    CASE WHEN l.purchase_payment_status='paid' THEN (l.quantity_kg*l.unit_purchase_price_ugx+l.worker_wages_ugx+l.food_ugx+l.transport_ugx+l.driver_fee_ugx+l.other_expense_ugx) ELSE GREATEST((l.quantity_kg*l.unit_purchase_price_ugx+l.worker_wages_ugx+l.food_ugx+l.transport_ugx+l.driver_fee_ugx+l.other_expense_ugx)-COALESCE(p.paid_ugx,0),0) END::bigint amount_ugx,
    COALESCE(l.purchase_paid_on,l.collected_on) expense_date,CASE WHEN l.purchase_payment_status='paid' THEN 'paid' ELSE 'approved' END status,
    l.purchase_payment_reference reference,'recycling_purchase' source_type,true read_only,l.created_at
   FROM recycling_material_lots l LEFT JOIN LATERAL(SELECT SUM(amount_ugx)::bigint paid_ugx FROM recycling_purchase_payments WHERE lot_id=l.id AND organization_id=l.organization_id)p ON true WHERE l.origin='purchase' AND ($1::uuid IS NULL OR l.organization_id=$1::uuid)
   UNION ALL
   SELECT b.id,('REC-SORT-'||UPPER(LEFT(b.id::text,8))),'processing',('Sorting and grading: '||b.output_material_type),NULL,
    b.processing_cost_ugx,b.processed_on,'paid',NULL,'recycling_sorting',true,b.created_at
   FROM recycling_sorting_batches b WHERE b.processing_cost_ugx>0 AND ($1::uuid IS NULL OR b.organization_id=$1::uuid)
   UNION ALL
   SELECT s.id,('REC-SALE-'||UPPER(LEFT(s.id::text,8))),'sales_cost',('Sale costs: '||l.material_type),s.buyer_name,
    (s.worker_wages_ugx+s.food_ugx+s.transport_ugx+s.other_expense_ugx)::bigint,s.sold_on,'paid',s.invoice_number,'recycling_sale_cost',true,s.created_at
   FROM recycling_material_sales s JOIN recycling_material_lots l ON l.id=s.lot_id
   WHERE (s.worker_wages_ugx+s.food_ugx+s.transport_ugx+s.other_expense_ugx)>0 AND ($1::uuid IS NULL OR s.organization_id=$1::uuid)
   UNION ALL
   SELECT f.id,('REC-FLOAT-'||UPPER(LEFT(f.id::text,8))),'other',COALESCE(f.notes,'Manager float expense'),NULL,
    f.amount_ugx,f.transaction_date,'paid',NULL,'recycling_float',true,f.created_at
   FROM recycling_manager_float_transactions f WHERE f.transaction_type='spent' AND f.purchase_lot_id IS NULL AND ($1::uuid IS NULL OR f.organization_id=$1::uuid)
  ) x ORDER BY expense_date DESC,created_at DESC`,[organizationId]);
 const expenses=[...rows.rows.map(x=>({...x,read_only:false,source_type:x.source_type||'manual'})),...recycling.rows].sort((a,b)=>new Date(b.expense_date).getTime()-new Date(a.expense_date).getTime());
 const recyclingPayments=await dbPool.query(`SELECT COALESCE(SUM(GREATEST(p.paid-l.manager_float_used_ugx,0)),0)::bigint amount FROM recycling_material_lots l JOIN(SELECT lot_id,SUM(amount_ugx) paid FROM recycling_purchase_payments WHERE ($1::uuid IS NULL OR organization_id=$1::uuid) AND paid_on>=date_trunc('month',CURRENT_DATE)::date GROUP BY lot_id)p ON p.lot_id=l.id`,[organizationId]);
 const paidThisMonth=expenses.filter(x=>x.source_type!=='recycling_purchase'&&x.status==='paid'&&new Date(x.expense_date)>=new Date(new Date().getFullYear(),new Date().getMonth(),1)).reduce((n,x)=>n+Number(x.amount_ugx),0)+Number(recyclingPayments.rows[0].amount);
 const awaitingPayment=expenses.filter(x=>x.status==='approved').reduce((n,x)=>n+Number(x.amount_ugx),0);
 const awaitingApproval=expenses.filter(x=>x.status==='draft').length;
 return {summary:{paid_this_month:String(paidThisMonth),awaiting_payment:String(awaitingPayment),awaiting_approval:awaitingApproval},expenses};
}
export async function createExpense(organizationId:string,userId:string,data:any){const number=`EXP-${Date.now()}`;const r=await dbPool.query(`INSERT INTO organization_expenses(organization_id,expense_number,category,description,vendor,amount_ugx,expense_date,reference,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[organizationId,number,data.category,data.description,data.vendor??null,data.amountUgx,data.expenseDate,data.reference??null,userId]);return r.rows[0];}
export async function updateExpenseStatus(id:string,organizationId:string,userId:string,status:string){const client=await dbPool.connect();try{await client.query('BEGIN');await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`,[`finance:${organizationId}`]);const r=await client.query(`UPDATE organization_expenses SET status=$4,approved_by=CASE WHEN $4='approved' THEN $3::uuid ELSE approved_by END,approved_at=CASE WHEN $4='approved' THEN CURRENT_TIMESTAMP ELSE approved_at END,paid_at=CASE WHEN $4='paid' THEN CURRENT_TIMESTAMP ELSE paid_at END,updated_at=CURRENT_TIMESTAMP WHERE id=$1::uuid AND organization_id=$2::uuid AND (($4='approved' AND status='draft' AND amount_ugx<=organization_available_to_commit($2::uuid)) OR ($4='paid' AND status='approved' AND amount_ugx<=organization_cash_position($2::uuid)) OR ($4='void' AND status<>'paid')) RETURNING *`,[id,organizationId,userId,status]);await client.query('COMMIT');return r.rows[0]??null;}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}
export async function findFinancialPosition(organizationId:string){const r=await dbPool.query(`WITH settings AS (SELECT COALESCE((SELECT opening_balance_ugx FROM organization_finance_settings WHERE organization_id=$1::uuid),0)::bigint opening_balance_ugx,COALESCE((SELECT as_of_date FROM organization_finance_settings WHERE organization_id=$1::uuid),DATE '1970-01-01')::date as_of_date,EXISTS(SELECT 1 FROM organization_finance_settings WHERE organization_id=$1::uuid) AS opening_balance_configured), totals AS (SELECT s.*,
 COALESCE((SELECT SUM(amount_ugx) FROM customer_payments WHERE organization_id=$1::uuid AND status='successful' AND COALESCE(confirmed_at,created_at)::date>=s.as_of_date),0)::bigint service_receipts_ugx,
 COALESCE((SELECT SUM(amount_ugx) FROM recycling_sale_payments WHERE organization_id=$1::uuid AND paid_on>=s.as_of_date),0)::bigint recycling_receipts_ugx,
 COALESCE((SELECT SUM(amount_ugx) FROM organization_expenses WHERE organization_id=$1::uuid AND status='paid' AND COALESCE(paid_at::date,expense_date)>=s.as_of_date),0)::bigint standard_operating_payments_ugx,
 COALESCE((SELECT SUM(GREATEST(p.paid-l.manager_float_used_ugx,0)) FROM recycling_material_lots l JOIN(SELECT lot_id,SUM(amount_ugx) paid FROM recycling_purchase_payments WHERE organization_id=$1::uuid AND paid_on>=s.as_of_date GROUP BY lot_id)p ON p.lot_id=l.id),0)::bigint recycling_purchase_payments_ugx,
 COALESCE((SELECT SUM(amount_ugx) FROM recycling_manager_float_transactions WHERE organization_id=$1::uuid AND transaction_type='spent' AND transaction_date>=s.as_of_date),0)::bigint recycling_float_spent_ugx,
 COALESCE((SELECT SUM(processing_cost_ugx) FROM recycling_sorting_batches WHERE organization_id=$1::uuid AND processed_on>=s.as_of_date),0)::bigint recycling_processing_payments_ugx,
 COALESCE((SELECT SUM(worker_wages_ugx+food_ugx+transport_ugx+other_expense_ugx) FROM recycling_material_sales WHERE organization_id=$1::uuid AND sold_on>=s.as_of_date),0)::bigint recycling_sale_cost_payments_ugx,
 COALESCE((SELECT SUM(amount_ugx) FROM supplier_payments WHERE organization_id=$1::uuid AND paid_on>=s.as_of_date),0)::bigint supplier_payments_ugx,
 COALESCE((SELECT SUM(balance_ugx) FROM customer_invoices WHERE organization_id=$1::uuid AND status<>'cancelled'),0)::bigint service_receivables_ugx,
 COALESCE((SELECT SUM(sale.quantity_kg*sale.unit_price_ugx-COALESCE(p.paid,0)) FROM recycling_material_sales sale LEFT JOIN(SELECT sale_id,SUM(amount_ugx) paid FROM recycling_sale_payments GROUP BY sale_id)p ON p.sale_id=sale.id WHERE sale.organization_id=$1::uuid AND sale.status<>'paid'),0)::bigint recycling_receivables_ugx,
 COALESCE((SELECT SUM(sale.quantity_kg*sale.unit_price_ugx-COALESCE(p.paid,0)) FROM recycling_material_sales sale LEFT JOIN(SELECT sale_id,SUM(amount_ugx) paid FROM recycling_sale_payments GROUP BY sale_id)p ON p.sale_id=sale.id WHERE sale.organization_id=$1::uuid AND sale.status<>'paid' AND sale.due_on<CURRENT_DATE),0)::bigint recycling_overdue_receivables_ugx,
 COALESCE((SELECT SUM(balance_ugx) FROM supplier_bills WHERE organization_id=$1::uuid AND status<>'void'),0)::bigint supplier_bill_payables_ugx,
 COALESCE((SELECT SUM(l.quantity_kg*l.unit_purchase_price_ugx+l.worker_wages_ugx+l.food_ugx+l.transport_ugx+l.driver_fee_ugx+l.other_expense_ugx-COALESCE(p.paid,0)) FROM recycling_material_lots l LEFT JOIN(SELECT lot_id,SUM(amount_ugx) paid FROM recycling_purchase_payments GROUP BY lot_id)p ON p.lot_id=l.id WHERE l.organization_id=$1::uuid AND l.origin='purchase' AND l.purchase_payment_status<>'paid'),0)::bigint recycling_payables_ugx,
 COALESCE((SELECT SUM(l.quantity_kg*l.unit_purchase_price_ugx+l.worker_wages_ugx+l.food_ugx+l.transport_ugx+l.driver_fee_ugx+l.other_expense_ugx-COALESCE(p.paid,0)) FROM recycling_material_lots l LEFT JOIN(SELECT lot_id,SUM(amount_ugx) paid FROM recycling_purchase_payments GROUP BY lot_id)p ON p.lot_id=l.id WHERE l.organization_id=$1::uuid AND l.origin='purchase' AND l.purchase_payment_status<>'paid' AND l.purchase_due_on<CURRENT_DATE),0)::bigint recycling_overdue_payables_ugx FROM settings s), combined AS (SELECT *,
 (service_receipts_ugx+recycling_receipts_ugx)::bigint customer_receipts_ugx,
 (standard_operating_payments_ugx+recycling_purchase_payments_ugx+recycling_float_spent_ugx+recycling_processing_payments_ugx+recycling_sale_cost_payments_ugx)::bigint operating_payments_ugx,
 (service_receivables_ugx+recycling_receivables_ugx)::bigint receivables_ugx,
 (supplier_bill_payables_ugx+recycling_payables_ugx)::bigint payables_ugx FROM totals)
 SELECT *, (opening_balance_configured AND (
 EXISTS(SELECT 1 FROM customer_payments WHERE organization_id=$1::uuid AND status='successful')
 OR EXISTS(SELECT 1 FROM organization_expenses WHERE organization_id=$1::uuid AND status='paid')
 OR EXISTS(SELECT 1 FROM supplier_payments WHERE organization_id=$1::uuid)
 OR EXISTS(SELECT 1 FROM recycling_sale_payments WHERE organization_id=$1::uuid)
 OR EXISTS(SELECT 1 FROM recycling_purchase_payments WHERE organization_id=$1::uuid)
 OR EXISTS(SELECT 1 FROM recycling_sorting_batches WHERE organization_id=$1::uuid AND processing_cost_ugx>0)
 OR EXISTS(SELECT 1 FROM recycling_manager_float_transactions WHERE organization_id=$1::uuid AND transaction_type='spent'))) AS opening_balance_locked,
 COALESCE((SELECT jsonb_agg(h ORDER BY h.changed_at DESC) FROM
   (SELECT opening_balance_ugx,as_of_date,previous_balance_ugx,previous_as_of_date,action,changed_at FROM organization_finance_setting_history WHERE organization_id=$1::uuid ORDER BY changed_at DESC LIMIT 20) h),'[]'::jsonb) AS opening_balance_history,
 organization_cash_position($1::uuid)::bigint cash_position_ugx,organization_committed_funds($1::uuid)::bigint committed_funds_ugx,organization_available_to_commit($1::uuid)::bigint available_to_commit_ugx FROM combined`,[organizationId]);return r.rows[0];}
export async function setOpeningBalance(organizationId:string,userId:string,input:{openingBalanceUgx:number;asOfDate:string}){
 const client=await dbPool.connect();
 const conflict=(message:string)=>Object.assign(new Error(message),{statusCode:409});
 try{
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`finance:${organizationId}`]);
  const dates=await client.query(`SELECT CURRENT_DATE::text today,
    MIN(d)::text first_cash_date FROM (
      SELECT COALESCE(confirmed_at,created_at)::date d FROM customer_payments WHERE organization_id=$1::uuid AND status='successful'
      UNION ALL SELECT COALESCE(paid_at::date,expense_date) FROM organization_expenses WHERE organization_id=$1::uuid AND status='paid'
      UNION ALL SELECT paid_on FROM supplier_payments WHERE organization_id=$1::uuid
      UNION ALL SELECT paid_on FROM recycling_sale_payments WHERE organization_id=$1::uuid
      UNION ALL SELECT paid_on FROM recycling_purchase_payments WHERE organization_id=$1::uuid
      UNION ALL SELECT processed_on FROM recycling_sorting_batches WHERE organization_id=$1::uuid AND processing_cost_ugx>0
      UNION ALL SELECT transaction_date FROM recycling_manager_float_transactions WHERE organization_id=$1::uuid AND transaction_type='spent'
    ) cash_dates`,[organizationId]);
  const existing=await client.query('SELECT *,as_of_date::text opening_date FROM organization_finance_settings WHERE organization_id=$1::uuid FOR UPDATE',[organizationId]);
  const previous=existing.rows[0],{today,first_cash_date}=dates.rows[0];
  if(input.asOfDate<'1970-01-01'||input.asOfDate>today) throw conflict('Choose an opening date from 1 January 1970 through today.');
  if(!Number.isSafeInteger(input.openingBalanceUgx)||input.openingBalanceUgx<0) throw conflict('Enter a valid non-negative opening balance.');
  // An unchanged save is harmless and must not add duplicate history.
  if(previous&&previous.opening_date===input.asOfDate&&BigInt(previous.opening_balance_ugx)===BigInt(input.openingBalanceUgx)){
    await client.query('COMMIT');return previous;
  }
  if(previous&&first_cash_date) throw conflict('Opening balance is locked because receipts or payments have been recorded. Use a reviewed accounting adjustment, not a replacement opening balance.');
  if(first_cash_date&&input.asOfDate>first_cash_date) throw conflict('The opening date cannot exclude existing receipts or payments. Choose a date on or before '+first_cash_date+'.');
  const result=await client.query(`INSERT INTO organization_finance_settings(organization_id,opening_balance_ugx,as_of_date,updated_by)
    VALUES($1,$2,$3,$4) ON CONFLICT(organization_id) DO UPDATE SET opening_balance_ugx=EXCLUDED.opening_balance_ugx,
    as_of_date=EXCLUDED.as_of_date,updated_by=EXCLUDED.updated_by,updated_at=CURRENT_TIMESTAMP RETURNING *`,
    [organizationId,input.openingBalanceUgx,input.asOfDate,userId]);
  const funding=await client.query('SELECT organization_available_to_commit($1::uuid)::bigint available',[organizationId]);
  if(BigInt(funding.rows[0].available)<0n) throw conflict('This opening balance would leave existing payments or commitments unfunded. Review the amount before saving.');
  await client.query(`INSERT INTO organization_finance_setting_history
    (organization_id,previous_balance_ugx,previous_as_of_date,opening_balance_ugx,as_of_date,changed_by,action)
    VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [organizationId,previous?.opening_balance_ugx??null,previous?.opening_date??null,input.openingBalanceUgx,input.asOfDate,userId,previous?'updated':'created']);
  await client.query('COMMIT');return result.rows[0];
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
