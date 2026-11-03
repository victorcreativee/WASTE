import{dbPool}from'../config/database';
export async function organizationReport(org:string|null,from:string,to:string){const p=[org,from,to];const operations=await dbPool.query(`WITH jobs AS (SELECT COUNT(*)::int jobs,COUNT(*) FILTER(WHERE status='completed')::int completed,COUNT(*) FILTER(WHERE status='missed')::int missed,COALESCE(SUM(collected_weight_kg) FILTER(WHERE status='completed'),0)::numeric field_collected_kg,COUNT(DISTINCT driver_id)::int drivers_used,COUNT(DISTINCT truck_id)::int trucks_used FROM collection_jobs WHERE ($1::uuid IS NULL OR organization_id=$1::uuid) AND job_date BETWEEN $2::date AND $3::date),weights AS (SELECT COALESCE(SUM(verified_weight_kg),0)::numeric collected_kg,COUNT(*) FILTER(WHERE status='completed' AND weight_verified_at IS NULL)::int unverified_trips FROM collection_routes WHERE ($1::uuid IS NULL OR organization_id=$1::uuid) AND route_date BETWEEN $2::date AND $3::date) SELECT jobs.*,weights.collected_kg,weights.unverified_trips FROM jobs CROSS JOIN weights`,p);const daily=await dbPool.query(`WITH dates AS (SELECT job_date,COUNT(*)::int jobs,COUNT(*) FILTER(WHERE status='completed')::int completed,COUNT(*) FILTER(WHERE status='missed')::int missed FROM collection_jobs WHERE ($1::uuid IS NULL OR organization_id=$1::uuid) AND job_date BETWEEN $2::date AND $3::date GROUP BY job_date),weights AS (SELECT route_date,COALESCE(SUM(verified_weight_kg),0)::numeric collected_kg,COUNT(*) FILTER(WHERE status='completed' AND weight_verified_at IS NULL)::int unverified_trips FROM collection_routes WHERE ($1::uuid IS NULL OR organization_id=$1::uuid) AND route_date BETWEEN $2::date AND $3::date GROUP BY route_date) SELECT dates.job_date::text date,dates.jobs,dates.completed,dates.missed,COALESCE(weights.collected_kg,0)::numeric collected_kg,COALESCE(weights.unverified_trips,0)::int unverified_trips FROM dates LEFT JOIN weights ON weights.route_date=dates.job_date ORDER BY dates.job_date`,p);const service=await dbPool.query(`SELECT COUNT(*)::int issues,COUNT(*) FILTER(WHERE status='resolved')::int resolved,COUNT(*) FILTER(WHERE status IN ('submitted','assigned','in_progress'))::int open FROM citizen_issues WHERE ($1::uuid IS NULL OR assigned_organization_id=$1::uuid) AND created_at::date BETWEEN $2::date AND $3::date`,p);const fleet=await dbPool.query(`SELECT COALESCE((SELECT SUM(cost_ugx) FROM truck_fuel_records WHERE ($1::uuid IS NULL OR organization_id=$1::uuid) AND fuel_date BETWEEN $2::date AND $3::date),0)::bigint fuel_cost,COALESCE((SELECT SUM(cost_ugx) FROM truck_maintenance_records WHERE ($1::uuid IS NULL OR organization_id=$1::uuid) AND scheduled_date BETWEEN $2::date AND $3::date),0)::bigint maintenance_cost`,p);const finance=await dbPool.query(`SELECT (COALESCE((SELECT SUM(amount_ugx) FROM customer_invoices WHERE ($1::uuid IS NULL OR organization_id=$1::uuid) AND issued_on BETWEEN $2::date AND $3::date),0)+COALESCE((SELECT SUM(quantity_kg*unit_price_ugx) FROM recycling_material_sales WHERE ($1::uuid IS NULL OR organization_id=$1::uuid) AND sold_on BETWEEN $2::date AND $3::date),0))::bigint invoiced,(COALESCE((SELECT SUM(amount_ugx) FROM customer_payments WHERE status='successful' AND ($1::uuid IS NULL OR organization_id=$1::uuid) AND COALESCE(confirmed_at,created_at)::date BETWEEN $2::date AND $3::date),0)+COALESCE((SELECT SUM(amount_ugx) FROM recycling_sale_payments WHERE ($1::uuid IS NULL OR organization_id=$1::uuid) AND paid_on BETWEEN $2::date AND $3::date),0))::bigint received,(COALESCE((SELECT SUM(amount_ugx) FROM organization_expenses WHERE status='paid' AND ($1::uuid IS NULL OR organization_id=$1::uuid) AND COALESCE(paid_at::date,expense_date) BETWEEN $2::date AND $3::date),0)+COALESCE((SELECT SUM(GREATEST(p.paid-l.manager_float_used_ugx,0)) FROM recycling_material_lots l JOIN(SELECT lot_id,SUM(amount_ugx) paid FROM recycling_purchase_payments WHERE ($1::uuid IS NULL OR organization_id=$1::uuid) AND paid_on BETWEEN $2::date AND $3::date GROUP BY lot_id)p ON p.lot_id=l.id),0)+COALESCE((SELECT SUM(processing_cost_ugx) FROM recycling_sorting_batches WHERE ($1::uuid IS NULL OR organization_id=$1::uuid) AND processed_on BETWEEN $2::date AND $3::date),0)+COALESCE((SELECT SUM(worker_wages_ugx+food_ugx+transport_ugx+other_expense_ugx) FROM recycling_material_sales WHERE ($1::uuid IS NULL OR organization_id=$1::uuid) AND sold_on BETWEEN $2::date AND $3::date),0)+COALESCE((SELECT SUM(amount_ugx) FROM recycling_manager_float_transactions WHERE transaction_type='spent' AND purchase_lot_id IS NULL AND sorting_batch_id IS NULL AND sale_id IS NULL AND expense_batch_reference IS NULL AND ($1::uuid IS NULL OR organization_id=$1::uuid) AND transaction_date BETWEEN $2::date AND $3::date),0))::bigint operating_expenses,COALESCE((SELECT SUM(amount_ugx) FROM supplier_payments WHERE ($1::uuid IS NULL OR organization_id=$1::uuid) AND paid_on BETWEEN $2::date AND $3::date),0)::bigint supplier_payments`,p);const workforce=await dbPool.query(`SELECT COUNT(*)::int records,COUNT(*) FILTER(WHERE status='present')::int present,COUNT(*) FILTER(WHERE status='late')::int late,COUNT(*) FILTER(WHERE status='absent')::int absent FROM staff_attendance WHERE ($1::uuid IS NULL OR organization_id=$1::uuid) AND work_date BETWEEN $2::date AND $3::date`,p);
 const organization=await dbPool.query(`SELECT type FROM organizations WHERE id=$1::uuid`,[org]);
 const recycling=await dbPool.query(`SELECT
  COALESCE((SELECT COUNT(*) FROM recycling_material_lots WHERE organization_id=$1::uuid AND origin='purchase' AND collected_on BETWEEN $2::date AND $3::date),0)::int purchases,
  COALESCE((SELECT SUM(quantity_kg) FROM recycling_material_lots WHERE organization_id=$1::uuid AND origin='purchase' AND collected_on BETWEEN $2::date AND $3::date),0)::numeric purchased_kg,
  COALESCE((SELECT SUM(quantity_kg*unit_purchase_price_ugx+worker_wages_ugx+food_ugx+transport_ugx+driver_fee_ugx+other_expense_ugx) FROM recycling_material_lots WHERE organization_id=$1::uuid AND origin='purchase' AND collected_on BETWEEN $2::date AND $3::date),0)::bigint purchase_cost_ugx,
  COALESCE((SELECT COUNT(*) FROM recycling_sorting_batches WHERE organization_id=$1::uuid AND processed_on BETWEEN $2::date AND $3::date),0)::int sorting_batches,
  COALESCE((SELECT SUM(output_kg) FROM recycling_sorting_batches WHERE organization_id=$1::uuid AND processed_on BETWEEN $2::date AND $3::date),0)::numeric sorted_output_kg,
  COALESCE((SELECT SUM(rejected_kg) FROM recycling_sorting_batches WHERE organization_id=$1::uuid AND processed_on BETWEEN $2::date AND $3::date),0)::numeric rejected_kg,
  COALESCE((SELECT COUNT(*) FROM recycling_material_sales WHERE organization_id=$1::uuid AND sold_on BETWEEN $2::date AND $3::date),0)::int sales,
  COALESCE((SELECT SUM(quantity_kg) FROM recycling_material_sales WHERE organization_id=$1::uuid AND sold_on BETWEEN $2::date AND $3::date),0)::numeric sold_kg,
  COALESCE((SELECT SUM(quantity_kg*unit_price_ugx) FROM recycling_material_sales WHERE organization_id=$1::uuid AND sold_on BETWEEN $2::date AND $3::date),0)::bigint sales_value_ugx,
  COALESCE((SELECT SUM(amount_ugx) FROM recycling_manager_float_transactions WHERE organization_id=$1::uuid AND transaction_type='given' AND transaction_date BETWEEN $2::date AND $3::date),0)::bigint float_given_ugx,
  COALESCE((SELECT SUM(amount_ugx) FROM recycling_manager_float_transactions WHERE organization_id=$1::uuid AND transaction_type='spent' AND transaction_date BETWEEN $2::date AND $3::date),0)::bigint float_spent_ugx`,p);
 const recyclingDaily=await dbPool.query(`WITH movement AS (
  SELECT collected_on work_date,COUNT(*)::int purchases,SUM(quantity_kg)::numeric purchased_kg,0::int sales,0::numeric sold_kg,0::bigint sales_value_ugx FROM recycling_material_lots WHERE organization_id=$1::uuid AND origin='purchase' AND collected_on BETWEEN $2::date AND $3::date GROUP BY collected_on
  UNION ALL SELECT sold_on,0,0,COUNT(*)::int,SUM(quantity_kg)::numeric,SUM(quantity_kg*unit_price_ugx)::bigint FROM recycling_material_sales WHERE organization_id=$1::uuid AND sold_on BETWEEN $2::date AND $3::date GROUP BY sold_on
 ) SELECT work_date::text date,SUM(purchases)::int purchases,SUM(purchased_kg)::numeric purchased_kg,SUM(sales)::int sales,SUM(sold_kg)::numeric sold_kg,SUM(sales_value_ugx)::bigint sales_value_ugx FROM movement GROUP BY work_date ORDER BY work_date`,p);
 const supplierDeliveries=await dbPool.query(`SELECT
  COALESCE(partner.id::text,'unregistered:'||lower(l.source_name)) supplier_key,
  partner.id supplier_partner_id,COALESCE(partner.name,l.source_name) supplier_name,
  partner.contact_person,partner.phone,partner.email,partner.address,
  l.id,l.purchase_group_reference,l.collected_on::text,l.material_type,l.quality,
  l.quantity_kg,l.unit_purchase_price_ugx,
  ROUND(l.quantity_kg*l.unit_purchase_price_ugx)::bigint material_cost_ugx,
  (l.worker_wages_ugx+l.food_ugx+l.transport_ugx+l.driver_fee_ugx+l.other_expense_ugx)::bigint purchase_expenses_ugx,
  (ROUND(l.quantity_kg*l.unit_purchase_price_ugx)+l.worker_wages_ugx+l.food_ugx+l.transport_ugx+l.driver_fee_ugx+l.other_expense_ugx)::bigint total_cost_ugx,
  COALESCE(payment.paid_ugx,0)::bigint paid_ugx,
  GREATEST((ROUND(l.quantity_kg*l.unit_purchase_price_ugx)+l.worker_wages_ugx+l.food_ugx+l.transport_ugx+l.driver_fee_ugx+l.other_expense_ugx)-COALESCE(payment.paid_ugx,0),0)::bigint balance_ugx,
  l.purchase_payment_status,l.purchase_due_on::text,l.purchase_payment_reference,l.notes,
  creator.full_name recorded_by_name,delivery.full_name delivered_by_name
 FROM recycling_material_lots l
 LEFT JOIN recycling_trade_partners partner ON partner.id=l.supplier_partner_id AND partner.organization_id=l.organization_id
 LEFT JOIN users creator ON creator.id=l.created_by
 LEFT JOIN users delivery ON delivery.id=l.delivered_by_user_id
 LEFT JOIN LATERAL(SELECT SUM(amount_ugx)::bigint paid_ugx FROM recycling_purchase_payments WHERE organization_id=l.organization_id AND lot_id=l.id)payment ON true
 WHERE l.organization_id=$1::uuid AND l.origin='purchase' AND l.collected_on BETWEEN $2::date AND $3::date
 ORDER BY COALESCE(partner.name,l.source_name),l.collected_on DESC,l.created_at DESC`,p);
 const dailyExpenses=await dbPool.query(`WITH expenses AS (
  SELECT e.id,e.expense_number,e.category::text,e.description,e.vendor,e.amount_ugx,e.expense_date,e.status::text,e.reference,e.created_at,u.full_name created_by_name,a.full_name approved_by_name
  FROM organization_expenses e LEFT JOIN users u ON u.id=e.created_by LEFT JOIN users a ON a.id=e.approved_by
  WHERE e.organization_id=$1::uuid AND e.expense_date BETWEEN $2::date AND $3::date
  UNION ALL
  SELECT f.id,('REC-FLOAT-'||UPPER(LEFT(f.id::text,8))),'field_float',COALESCE(f.notes,'Manager float expense'),NULL::text,f.amount_ugx,f.transaction_date,'paid',f.reference,f.created_at,u.full_name,u.full_name
  FROM recycling_manager_float_transactions f LEFT JOIN users u ON u.id=f.recorded_by AND u.organization_id=f.organization_id
  WHERE f.organization_id=$1::uuid AND f.transaction_type='spent' AND f.purchase_lot_id IS NULL AND f.sorting_batch_id IS NULL AND f.sale_id IS NULL AND f.expense_batch_reference IS NULL AND f.transaction_date BETWEEN $2::date AND $3::date
 ) SELECT id,expense_number,category,description,vendor,amount_ugx,expense_date::text,status,reference,created_at,created_by_name,approved_by_name
  FROM expenses ORDER BY expense_date DESC,created_at DESC`,p);
 const dailyExpenseSummary=await dbPool.query(`WITH expenses AS (
  SELECT category::text,amount_ugx,status::text FROM organization_expenses WHERE organization_id=$1::uuid AND expense_date BETWEEN $2::date AND $3::date
  UNION ALL
  SELECT 'field_float',amount_ugx,'paid' FROM recycling_manager_float_transactions
  WHERE organization_id=$1::uuid AND transaction_type='spent' AND purchase_lot_id IS NULL AND sorting_batch_id IS NULL AND sale_id IS NULL AND expense_batch_reference IS NULL AND transaction_date BETWEEN $2::date AND $3::date
 ) SELECT category,COUNT(*)::int entries,
  COALESCE(SUM(amount_ugx),0)::bigint recorded_ugx,
  COALESCE(SUM(amount_ugx) FILTER(WHERE status='paid'),0)::bigint paid_ugx,
  COALESCE(SUM(amount_ugx) FILTER(WHERE status='approved'),0)::bigint approved_ugx,
  COALESCE(SUM(amount_ugx) FILTER(WHERE status='draft'),0)::bigint draft_ugx
  FROM expenses
  GROUP BY category ORDER BY recorded_ugx DESC,category`,p);
 const managerFloatTransactions=await dbPool.query(`SELECT movement.id,movement.transaction_date::text,
  movement.transaction_type,movement.amount_ugx::bigint,movement.reference,movement.notes,movement.created_at,
  recorder.full_name recorded_by_name,
  CASE WHEN movement.expense_batch_reference IS NOT NULL THEN 'daily_expense'
       WHEN movement.purchase_lot_id IS NOT NULL THEN 'purchase'
       WHEN movement.sorting_batch_id IS NOT NULL THEN 'processing'
       WHEN movement.sale_id IS NOT NULL THEN 'sale' ELSE 'general' END linked_operation,
  SUM(CASE WHEN movement.transaction_type='given' THEN movement.amount_ugx ELSE -movement.amount_ugx END)
    OVER(ORDER BY movement.transaction_date,movement.created_at,movement.id)::bigint period_running_balance_ugx
 FROM recycling_manager_float_transactions movement
 LEFT JOIN users recorder ON recorder.id=movement.recorded_by AND recorder.organization_id=movement.organization_id
 WHERE movement.organization_id=$1::uuid AND movement.transaction_date BETWEEN $2::date AND $3::date
 ORDER BY movement.transaction_date DESC,movement.created_at DESC,movement.id DESC`,p);
 const materialPerformance=await dbPool.query(`WITH purchased AS (
   SELECT material_type,COUNT(*)::int purchase_lines,
    COUNT(DISTINCT COALESCE(purchase_group_reference,id::text))::int deliveries,
    COUNT(DISTINCT lower(source_name))::int suppliers,
    COALESCE(SUM(quantity_kg),0)::numeric purchased_kg,
    COALESCE(SUM(ROUND(quantity_kg*unit_purchase_price_ugx)),0)::bigint material_cost_ugx,
    COALESCE(SUM(worker_wages_ugx+food_ugx+transport_ugx+driver_fee_ugx+other_expense_ugx),0)::bigint purchase_expenses_ugx
   FROM recycling_material_lots WHERE organization_id=$1::uuid AND origin='purchase' AND collected_on BETWEEN $2::date AND $3::date GROUP BY material_type
  ),sold AS (
   SELECT l.material_type,COUNT(*)::int sales,COALESCE(SUM(s.quantity_kg),0)::numeric sold_kg,
    COALESCE(SUM(ROUND(s.quantity_kg*s.unit_price_ugx)),0)::bigint sales_value_ugx
   FROM recycling_material_sales s JOIN recycling_material_lots l ON l.id=s.lot_id AND l.organization_id=s.organization_id
   WHERE s.organization_id=$1::uuid AND s.sold_on BETWEEN $2::date AND $3::date GROUP BY l.material_type
  ),stock AS (
   SELECT material_type,COALESCE(SUM(available_kg),0)::numeric available_kg
   FROM recycling_material_lots WHERE organization_id=$1::uuid AND available_kg>0 GROUP BY material_type
  ),materials AS (SELECT material_type FROM purchased UNION SELECT material_type FROM sold UNION SELECT material_type FROM stock)
  SELECT m.material_type,COALESCE(p.purchase_lines,0)::int purchase_lines,COALESCE(p.deliveries,0)::int deliveries,
   COALESCE(p.suppliers,0)::int suppliers,COALESCE(p.purchased_kg,0)::numeric purchased_kg,
   COALESCE(p.material_cost_ugx,0)::bigint material_cost_ugx,COALESCE(p.purchase_expenses_ugx,0)::bigint purchase_expenses_ugx,
   (COALESCE(p.material_cost_ugx,0)+COALESCE(p.purchase_expenses_ugx,0))::bigint total_purchase_cost_ugx,
   COALESCE(s.sales,0)::int sales,COALESCE(s.sold_kg,0)::numeric sold_kg,COALESCE(s.sales_value_ugx,0)::bigint sales_value_ugx,
   COALESCE(st.available_kg,0)::numeric available_kg
  FROM materials m LEFT JOIN purchased p USING(material_type) LEFT JOIN sold s USING(material_type) LEFT JOIN stock st USING(material_type)
  ORDER BY COALESCE(p.purchased_kg,0) DESC,m.material_type`,p);
 const buyerSales=await dbPool.query(`SELECT
  COALESCE(partner.id::text,'unregistered:'||lower(s.buyer_name)) buyer_key,
  partner.id buyer_partner_id,COALESCE(partner.name,s.buyer_name) buyer_name,
  partner.contact_person,partner.phone,partner.email,partner.address,
  s.id,s.sold_on::text,s.invoice_number,s.industry,l.material_type,s.quantity_kg,s.unit_price_ugx,
  ROUND(s.quantity_kg*s.unit_price_ugx)::bigint sales_value_ugx,
  (s.worker_wages_ugx+s.food_ugx+s.transport_ugx+s.other_expense_ugx)::bigint selling_expenses_ugx,
  COALESCE(payment.paid_ugx,0)::bigint paid_ugx,
  GREATEST(ROUND(s.quantity_kg*s.unit_price_ugx)-COALESCE(payment.paid_ugx,0),0)::bigint balance_ugx,
  s.status,s.due_on::text,s.payment_reference,s.notes,recorder.full_name recorded_by_name
 FROM recycling_material_sales s
 JOIN recycling_material_lots l ON l.id=s.lot_id AND l.organization_id=s.organization_id
 LEFT JOIN recycling_trade_partners partner ON partner.id=s.buyer_partner_id AND partner.organization_id=s.organization_id
 LEFT JOIN users recorder ON recorder.id=s.recorded_by
 LEFT JOIN LATERAL(SELECT SUM(amount_ugx)::bigint paid_ugx FROM recycling_sale_payments WHERE organization_id=s.organization_id AND sale_id=s.id)payment ON true
 WHERE s.organization_id=$1::uuid AND s.sold_on BETWEEN $2::date AND $3::date
 ORDER BY COALESCE(partner.name,s.buyer_name),s.sold_on DESC,s.created_at DESC`,p);
 return{range:{from,to},organizationType:organization.rows[0]?.type||null,operations:operations.rows[0],daily:daily.rows,service:service.rows[0],fleet:fleet.rows[0],finance:finance.rows[0],workforce:workforce.rows[0],recycling:recycling.rows[0],recyclingDaily:recyclingDaily.rows,supplierDeliveries:supplierDeliveries.rows,buyerSales:buyerSales.rows,dailyExpenses:dailyExpenses.rows,dailyExpenseSummary:dailyExpenseSummary.rows,managerFloatTransactions:managerFloatTransactions.rows,materialPerformance:materialPerformance.rows};}

export async function cityCollectorReport(from:string,to:string){
 const result=await dbPool.query(`SELECT o.id,o.name,o.is_active,
  permit.permit_number,permit.valid_until::text,
  COALESCE(divisions.names,'') divisions,
  COALESCE(routes.trips,0)::int trips,COALESCE(routes.completed_trips,0)::int completed_trips,
  COALESCE(routes.unverified_trips,0)::int unverified_trips,COALESCE(weights.verified_kg,0)::numeric verified_kg,
  COALESCE(jobs.jobs,0)::int jobs,COALESCE(jobs.completed_jobs,0)::int completed_jobs,COALESCE(jobs.missed_jobs,0)::int missed_jobs,
  COALESCE(issues.open_issues,0)::int open_issues
 FROM organizations o
 LEFT JOIN LATERAL (SELECT permit_number,valid_until FROM organization_permit_applications p WHERE p.organization_id=o.id AND p.status='approved' ORDER BY p.valid_until DESC NULLS LAST LIMIT 1) permit ON true
 LEFT JOIN LATERAL (SELECT string_agg(d.name,', ' ORDER BY d.name) names FROM organization_division_authorizations a JOIN kampala_divisions d ON d.id=a.division_id WHERE a.organization_id=o.id AND a.status='active' AND (a.expires_on IS NULL OR a.expires_on>=CURRENT_DATE)) divisions ON true
 LEFT JOIN LATERAL (SELECT COUNT(*) trips,COUNT(*) FILTER(WHERE status='completed') completed_trips,COUNT(*) FILTER(WHERE status='completed' AND weight_verified_at IS NULL) unverified_trips FROM collection_routes r WHERE r.organization_id=o.id AND r.route_date BETWEEN $1::date AND $2::date) routes ON true
 LEFT JOIN LATERAL (SELECT COALESCE(SUM(w.net_kg),0) verified_kg FROM weighbridge_transactions w WHERE w.organization_id=o.id AND w.status='completed' AND w.operation_date BETWEEN $1::date AND $2::date) weights ON true
 LEFT JOIN LATERAL (SELECT COUNT(*) jobs,COUNT(*) FILTER(WHERE status='completed') completed_jobs,COUNT(*) FILTER(WHERE status='missed') missed_jobs FROM collection_jobs j WHERE j.organization_id=o.id AND j.job_date BETWEEN $1::date AND $2::date) jobs ON true
 LEFT JOIN LATERAL (SELECT COUNT(*) FILTER(WHERE status IN ('submitted','triaged','assigned','in_progress')) open_issues FROM citizen_issues i WHERE i.assigned_organization_id=o.id AND i.created_at::date BETWEEN $1::date AND $2::date) issues ON true
 WHERE o.type IN ('waste_collection_company','recycling_company')
 ORDER BY o.name`,[from,to]);
 const today=new Date(),renewalWarning=new Date(today.getTime()+60*86400000).toISOString().slice(0,10),todayValue=today.toISOString().slice(0,10);
 const collectors=result.rows.map(row=>({...row,completion_rate:row.jobs?Math.round(row.completed_jobs/row.jobs*100):0,compliance_state:!row.is_active?'suspended':!row.permit_number?'permit_missing':row.valid_until&&row.valid_until<todayValue?'permit_expired':row.valid_until&&row.valid_until<=renewalWarning?'renewal_due':row.unverified_trips>0?'weight_pending':row.missed_jobs>0||row.open_issues>0?'attention':'compliant'}));
 return{range:{from,to},summary:{collectors:collectors.length,active:collectors.filter(row=>row.is_active).length,trips:collectors.reduce((n,row)=>n+row.trips,0),verified_kg:collectors.reduce((n,row)=>n+Number(row.verified_kg),0),unverified_trips:collectors.reduce((n,row)=>n+row.unverified_trips,0),open_issues:collectors.reduce((n,row)=>n+row.open_issues,0)},collectors};
}
