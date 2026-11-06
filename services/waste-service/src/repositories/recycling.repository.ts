import {randomUUID} from 'node:crypto';
import {purchaseAllocationReference} from '../utils/purchase-allocation-reference';
import {dbPool} from '../config/database';
import {dateOnly} from '../utils/date-only';
import {assertRecyclingBusinessDayOpen,assertRecyclingBusinessDaysOpen} from '../services/recycling-business-day';
export const financeError=(message:string)=>Object.assign(new Error(message),{statusCode:409});
type Queryable={query:(sql:string,params?:unknown[])=>Promise<{rows:any[]}>};
/** Cash the business holds, split into what the office holds and the float the manager holds. */
export async function financeState(q:Queryable,org:string){
 const row=(await q.query(`SELECT EXISTS(SELECT 1 FROM organization_finance_settings WHERE organization_id=$1::uuid) configured,organization_cash_position($1::uuid)::bigint cash,COALESCE((SELECT SUM(CASE WHEN transaction_type='given' THEN amount_ugx ELSE -amount_ugx END) FROM recycling_manager_float_transactions WHERE organization_id=$1::uuid),0)::bigint float_balance`,[org])).rows[0];
 const cash=Number(row.cash),floatBalance=Number(row.float_balance);
 return{configured:Boolean(row.configured),cash,floatBalance,officeCash:cash-floatBalance};
}
/** Office cash, once the opening balance that cash is counted from has been set. */
export async function configuredOfficeCash(q:Queryable,org:string){
 const state=await financeState(q,org);
 if(!state.configured)throw financeError('Set the verified opening balance before recording cash movements.');
 return state.officeCash;
}
/**
 * Money that came into and went out of the business between two days, by kind and by day. Moving float between the
 * office and the manager is reported separately: it changes who holds the money, not how much the business has.
 * Float spending tied to a purchase, sale or sorting batch is counted through that record, never twice.
 */
export async function cashFlow(org:string,from:string,to:string){
 const rows=(await dbPool.query(`WITH movements(movement_day,direction,kind,amount) AS (
   SELECT paid_on,'in','buyer_payments',amount_ugx FROM recycling_sale_payments WHERE organization_id=$1::uuid AND paid_on BETWEEN $2::date AND $3::date
   UNION ALL SELECT COALESCE(confirmed_at,created_at)::date,'in','customer_payments',amount_ugx FROM customer_payments WHERE organization_id=$1::uuid AND status='successful' AND COALESCE(confirmed_at,created_at)::date BETWEEN $2::date AND $3::date
   UNION ALL SELECT movement_date,direction,'office_'||category,amount_ugx FROM recycling_cash_movements WHERE organization_id=$1::uuid AND movement_date BETWEEN $2::date AND $3::date
   UNION ALL SELECT paid_on,'out','supplier_payments',amount_ugx FROM recycling_purchase_payments WHERE organization_id=$1::uuid AND paid_on BETWEEN $2::date AND $3::date
   UNION ALL SELECT paid_on,'out','supplier_bills',amount_ugx FROM supplier_payments WHERE organization_id=$1::uuid AND paid_on BETWEEN $2::date AND $3::date
   UNION ALL SELECT sold_on,'out','sale_costs',worker_wages_ugx+food_ugx+transport_ugx+other_expense_ugx FROM recycling_material_sales WHERE organization_id=$1::uuid AND sold_on BETWEEN $2::date AND $3::date AND worker_wages_ugx+food_ugx+transport_ugx+other_expense_ugx>0
   UNION ALL SELECT processed_on,'out','sorting_costs',processing_cost_ugx FROM recycling_sorting_batches WHERE organization_id=$1::uuid AND processed_on BETWEEN $2::date AND $3::date AND processing_cost_ugx>0
   UNION ALL SELECT transaction_date,'out','float_expenses',amount_ugx FROM recycling_manager_float_transactions WHERE organization_id=$1::uuid AND transaction_type='spent' AND purchase_lot_id IS NULL AND sorting_batch_id IS NULL AND sale_id IS NULL AND expense_batch_reference IS NULL AND transaction_date BETWEEN $2::date AND $3::date
   UNION ALL SELECT COALESCE(paid_at::date,expense_date),'out','office_expenses',amount_ugx FROM organization_expenses WHERE organization_id=$1::uuid AND status='paid' AND COALESCE(paid_at::date,expense_date) BETWEEN $2::date AND $3::date
   UNION ALL SELECT transaction_date,'transfer','float_'||transaction_type,amount_ugx FROM recycling_manager_float_transactions WHERE organization_id=$1::uuid AND transaction_type IN('given','returned') AND transaction_date BETWEEN $2::date AND $3::date
  ) SELECT movement_day::text AS movement_day,direction,kind,SUM(amount)::bigint AS amount,COUNT(*)::int AS entries FROM movements GROUP BY movement_day,direction,kind ORDER BY movement_day`,[org,from,to])).rows as {movement_day:string;direction:string;kind:string;amount:string;entries:number}[];
 const kinds:Record<string,{direction:string;kind:string;amount:number;entries:number}>={};
 const days:Record<string,{day:string;in:number;out:number}>={};
 for(const row of rows){
  const amount=Number(row.amount),key=`${row.direction}:${row.kind}`;
  kinds[key]??={direction:row.direction,kind:row.kind,amount:0,entries:0};kinds[key].amount+=amount;kinds[key].entries+=row.entries;
  if(row.direction==='transfer')continue;
  days[row.movement_day]??={day:row.movement_day,in:0,out:0};days[row.movement_day][row.direction as 'in'|'out']+=amount;
 }
 const lines=Object.values(kinds).sort((a,b)=>b.amount-a.amount);
 const total=(direction:string)=>lines.filter(x=>x.direction===direction).reduce((n,x)=>n+x.amount,0);
 const moneyIn=total('in'),moneyOut=total('out');
 return{from,to,moneyIn,moneyOut,net:moneyIn-moneyOut,lines,days:Object.values(days).sort((a,b)=>a.day.localeCompare(b.day)),
  ...(await financeState(dbPool,org).then(state=>({cashNow:state.cash,floatNow:state.floatBalance,officeCashNow:state.officeCash})))};
}
/** Recycling permission codes this member holds, so clients only offer actions the server will accept. */
export async function recyclingPermissions(user:string,org:string){return(await dbPool.query(`SELECT code FROM organization_effective_permissions($1::uuid,$2::uuid) WHERE code LIKE 'recycling.%' ORDER BY code`,[user,org])).rows.map((row:{code:string})=>row.code)}
export async function findRecycling(org:string){
 const [context,lots,sales,float,sorting,partners,stockAdjustments,salePayments,purchasePayments,materials,dailyClosures,transactionEdits,cashMovements,deliveryStaff,saleLots,loans]=await Promise.all([
  dbPool.query(`SELECT o.id,o.name,o.type,(now() AT TIME ZONE 'Africa/Kampala')::date::text operating_date,
   COALESCE(f.opening_balance_ugx,0)::bigint opening_balance_ugx,(f.organization_id IS NOT NULL) opening_balance_configured,
   organization_cash_position(o.id)::bigint cash_position_ugx,
   organization_committed_funds(o.id)::bigint committed_funds_ugx,
   organization_available_to_commit(o.id)::bigint available_to_commit_ugx,
   COALESCE((SELECT SUM(CASE WHEN transaction_type='given' THEN amount_ugx ELSE -amount_ugx END) FROM recycling_manager_float_transactions WHERE organization_id=o.id),0)::bigint float_balance_ugx,
   COALESCE((SELECT SUM(quantity_kg) FILTER(WHERE adjustment_type='correction_in') FROM recycling_stock_adjustments WHERE organization_id=o.id),0) stock_added_kg,
   COALESCE((SELECT SUM(quantity_kg) FILTER(WHERE adjustment_type<>'correction_in') FROM recycling_stock_adjustments WHERE organization_id=o.id),0) stock_removed_kg,
   COALESCE((SELECT SUM(quantity_kg) FILTER(WHERE adjustment_type='loss') FROM recycling_stock_adjustments WHERE organization_id=o.id),0) loss_kg
   FROM organizations o LEFT JOIN organization_finance_settings f ON f.organization_id=o.id WHERE o.id=$1::uuid`,[org]),
  dbPool.query(`SELECT l.*,creator.full_name recorded_by_name,delivery.full_name delivered_by_name,ROUND(l.quantity_kg*l.unit_purchase_price_ugx)::bigint material_cost_ugx,(ROUND(l.quantity_kg*l.unit_purchase_price_ugx)+l.worker_wages_ugx+l.food_ugx+l.transport_ugx+l.driver_fee_ugx+l.other_expense_ugx)::bigint total_cost_ugx,COALESCE(p.paid_ugx,0)::bigint paid_ugx,GREATEST((ROUND(l.quantity_kg*l.unit_purchase_price_ugx)+l.worker_wages_ugx+l.food_ugx+l.transport_ugx+l.driver_fee_ugx+l.other_expense_ugx)-COALESCE(p.paid_ugx,0),0)::bigint balance_ugx,CASE WHEN l.purchase_payment_status IN('credit','partially_paid') AND l.purchase_due_on<(now() AT TIME ZONE 'Africa/Kampala')::date THEN 'overdue' WHEN l.purchase_payment_status IN('credit','partially_paid') AND l.purchase_due_on<=(now() AT TIME ZONE 'Africa/Kampala')::date+7 THEN 'due_soon' ELSE l.purchase_payment_status END purchase_payment_state FROM recycling_material_lots l LEFT JOIN users creator ON creator.id=l.created_by LEFT JOIN users delivery ON delivery.id=l.delivered_by_user_id AND delivery.organization_id=l.organization_id LEFT JOIN LATERAL(SELECT SUM(amount_ugx)::bigint paid_ugx FROM recycling_purchase_payments WHERE lot_id=l.id AND organization_id=l.organization_id)p ON true WHERE l.organization_id=$1::uuid ORDER BY l.collected_on DESC,l.created_at DESC`,[org]),
  dbPool.query(`SELECT s.*,recorder.full_name recorded_by_name,l.material_type,(s.quantity_kg*s.unit_price_ugx)::bigint total_ugx,COALESCE(pay.paid_ugx,0)::bigint paid_ugx,GREATEST((s.quantity_kg*s.unit_price_ugx)-COALESCE(pay.paid_ugx,0),0)::bigint balance_ugx,(s.worker_wages_ugx+s.food_ugx+s.transport_ugx+s.other_expense_ugx)::bigint expenses_ugx,((s.quantity_kg*s.unit_price_ugx)-(s.worker_wages_ugx+s.food_ugx+s.transport_ugx+s.other_expense_ugx))::bigint net_income_ugx,CASE WHEN s.status IN('recorded','partially_paid') AND s.due_on<(now() AT TIME ZONE 'Africa/Kampala')::date THEN 'overdue' WHEN s.status IN('recorded','partially_paid') AND s.due_on<=(now() AT TIME ZONE 'Africa/Kampala')::date+7 THEN 'due_soon' ELSE s.status END payment_state,f.contact_method latest_follow_up_method,f.outcome latest_follow_up_outcome,f.note latest_follow_up_note,f.next_follow_up_on,f.created_at latest_follow_up_at,COALESCE(f.follow_up_count,0)::int follow_up_count FROM recycling_material_sales s JOIN recycling_material_lots l ON l.id=s.lot_id LEFT JOIN users recorder ON recorder.id=s.recorded_by LEFT JOIN LATERAL(SELECT SUM(amount_ugx)::bigint paid_ugx FROM recycling_sale_payments WHERE sale_id=s.id AND organization_id=s.organization_id)pay ON true LEFT JOIN LATERAL(SELECT p.contact_method,p.outcome,p.note,p.next_follow_up_on,p.created_at,COUNT(*)OVER() follow_up_count FROM recycling_payment_followups p WHERE p.sale_id=s.id AND p.organization_id=s.organization_id ORDER BY p.created_at DESC LIMIT 1)f ON true WHERE s.organization_id=$1::uuid ORDER BY s.sold_on DESC,s.created_at DESC`,[org]),
  dbPool.query(`SELECT movement.*,
    recorder.full_name recorded_by_name,
    SUM(CASE WHEN movement.transaction_type='given' THEN movement.amount_ugx ELSE -movement.amount_ugx END)
      OVER(ORDER BY movement.transaction_date,movement.created_at,movement.id)::bigint running_balance_ugx
   FROM recycling_manager_float_transactions movement
   LEFT JOIN users recorder ON recorder.id=movement.recorded_by AND recorder.organization_id=movement.organization_id
   WHERE movement.organization_id=$1::uuid
   ORDER BY movement.transaction_date DESC,movement.created_at DESC,movement.id DESC LIMIT 100`,[org]),
  dbPool.query(`SELECT b.*,i.material_type input_material_type,o.material_type output_material FROM recycling_sorting_batches b JOIN recycling_material_lots i ON i.id=b.input_lot_id JOIN recycling_material_lots o ON o.id=b.output_lot_id WHERE b.organization_id=$1::uuid ORDER BY b.processed_on DESC,b.created_at DESC`,[org]),
  dbPool.query(`SELECT * FROM recycling_trade_partners WHERE organization_id=$1::uuid ORDER BY active DESC,name`,[org]),
  dbPool.query(`SELECT a.*,l.material_type,l.source_name FROM recycling_stock_adjustments a JOIN recycling_material_lots l ON l.id=a.lot_id WHERE a.organization_id=$1::uuid ORDER BY a.adjustment_date DESC,a.created_at DESC LIMIT 100`,[org]),
  dbPool.query(`SELECT id,sale_id,amount_ugx,paid_on,reference,created_at FROM recycling_sale_payments WHERE organization_id=$1::uuid ORDER BY paid_on DESC,created_at DESC`,[org]),
  dbPool.query(`SELECT id,lot_id,amount_ugx,paid_on,reference,created_at FROM recycling_purchase_payments WHERE organization_id=$1::uuid ORDER BY paid_on DESC,created_at DESC`,[org]),
  dbPool.query(`SELECT * FROM recycling_material_catalog WHERE organization_id=$1::uuid ORDER BY active DESC,category,name`,[org]),
  dbPool.query(`SELECT c.*,u.full_name closed_by_name,r.full_name reopened_by_name,
   COALESCE(history.events,'[]'::jsonb) history
   FROM recycling_daily_closures c
   JOIN users u ON u.id=c.closed_by AND u.organization_id=c.organization_id
   LEFT JOIN users r ON r.id=c.reopened_by AND r.organization_id=c.organization_id
   LEFT JOIN LATERAL(
    SELECT jsonb_agg(jsonb_build_object(
      'id',e.id,'action',e.action,'reason',e.reason,'createdAt',e.created_at,
      'actorUserId',e.actor_user_id,'actorName',actor.full_name
    ) ORDER BY e.created_at DESC,e.id DESC) events
    FROM recycling_daily_closure_events e
    JOIN users actor ON actor.id=e.actor_user_id AND actor.organization_id=e.organization_id
    WHERE e.closure_id=c.id AND e.organization_id=c.organization_id
   ) history ON true
   WHERE c.organization_id=$1::uuid ORDER BY c.operating_date DESC LIMIT 31`,[org]),
  dbPool.query(`SELECT e.*,u.full_name edited_by_name FROM recycling_transaction_edits e JOIN users u ON u.id=e.edited_by AND u.organization_id=e.organization_id WHERE e.organization_id=$1::uuid ORDER BY e.edited_at DESC LIMIT 100`,[org])
  ,dbPool.query(`SELECT m.*,u.full_name recorded_by_name FROM recycling_cash_movements m JOIN users u ON u.id=m.recorded_by AND u.organization_id=m.organization_id WHERE m.organization_id=$1::uuid ORDER BY m.movement_date DESC,m.created_at DESC LIMIT 100`,[org]),
  dbPool.query(`SELECT u.id,u.full_name,ARRAY_AGG(DISTINCT r.name) roles FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE u.organization_id=$1::uuid AND u.status='active' AND r.name IN('driver','recycling_collector','recycling_field_manager','supervisor') GROUP BY u.id,u.full_name ORDER BY u.full_name`,[org])
  ,dbPool.query(`SELECT sale_id,lot_id,delivered_kg FROM recycling_sale_lots WHERE organization_id=$1::uuid`,[org])
  ,dbPool.query(`SELECT l.*,u.full_name recorded_by_name,COALESCE(r.repaid,0)::bigint repaid_ugx,(l.amount_ugx-COALESCE(r.repaid,0))::bigint outstanding_ugx,r.last_repaid_on FROM recycling_loans l LEFT JOIN users u ON u.id=l.recorded_by LEFT JOIN LATERAL(SELECT SUM(amount_ugx) repaid,MAX(movement_date) last_repaid_on FROM recycling_cash_movements WHERE loan_id=l.id AND category='loan_repayment')r ON true WHERE l.organization_id=$1::uuid ORDER BY (l.amount_ugx-COALESCE(r.repaid,0))>0 DESC,l.received_on DESC`,[org])
 ]);
 const purchasedLots=lots.rows.filter(x=>x.origin==='purchase');
 const operatingDate=dateOnly(context.rows[0]?.operating_date),dateValue=dateOnly;
 const purchaseCost=purchasedLots.reduce((n,x)=>n+Number(x.total_cost_ugx),0),revenue=sales.rows.reduce((n,x)=>n+Number(x.total_ugx),0),saleExpenses=sales.rows.reduce((n,x)=>n+Number(x.expenses_ugx),0),processingCost=sorting.rows.reduce((n,x)=>n+Number(x.processing_cost_ugx),0);
 // The float and adjustment lists hold only the latest 100 entries, so their totals come from SQL over every row.
 const floatBalance=Number(context.rows[0]?.float_balance_ugx||0);
 const sortedInputKg=sorting.rows.reduce((n,x)=>n+Number(x.input_kg),0),sortedOutputKg=sorting.rows.reduce((n,x)=>n+Number(x.output_kg),0),rejectedKg=sorting.rows.reduce((n,x)=>n+Number(x.rejected_kg),0);
 const stockAddedKg=Number(context.rows[0]?.stock_added_kg||0),stockRemovedKg=Number(context.rows[0]?.stock_removed_kg||0),lossKg=Number(context.rows[0]?.loss_kg||0);
 const today=Date.now(),daysOverdue=(date:unknown)=>date?Math.max(0,Math.floor((today-new Date(dateOnly(date)+'T00:00:00Z').getTime())/86400000)):0;
 const age=(items:any[],dueKey:string,amountKey:string)=>items.reduce((a,x)=>{const days=daysOverdue(x[dueKey]),amount=Number(x[amountKey]);if(!days)a.current+=amount;else if(days<=30)a.days1To30+=amount;else if(days<=60)a.days31To60+=amount;else a.days61Plus+=amount;return a},{current:0,days1To30:0,days31To60:0,days61Plus:0});
 const paymentAging={receivables:age(sales.rows.filter(x=>x.status!=='paid'),'due_on','balance_ugx'),payables:age(purchasedLots.filter(x=>x.purchase_payment_status!=='paid'),'purchase_due_on','balance_ugx')};
 const buyerExposure=[...sales.rows.filter(x=>x.status!=='paid').reduce((m,x)=>m.set(x.buyer_name,(m.get(x.buyer_name)||0)+Number(x.balance_ugx)),new Map<string,number>())].map(([buyerName,amountUgx])=>({buyerName,amountUgx})).sort((a,b)=>b.amountUgx-a.amountUgx);
 const upcomingFollowUps=sales.rows.filter(x=>x.status!=='paid'&&x.next_follow_up_on).map(x=>({saleId:x.id,buyerName:x.buyer_name,invoiceNumber:x.invoice_number,amountUgx:Number(x.balance_ugx),nextFollowUpOn:x.next_follow_up_on,outcome:x.latest_follow_up_outcome})).sort((a,b)=>String(a.nextFollowUpOn).localeCompare(String(b.nextFollowUpOn))).slice(0,10);
 const lotById=new Map(lots.rows.map(x=>[x.id,x])),batchByOutput=new Map(sorting.rows.map(x=>[x.output_lot_id,x]));
 const unitCost=(id:string,seen=new Set<string>()):number=>{if(seen.has(id))return 0;seen.add(id);const lot=lotById.get(id);if(!lot)return 0;if(lot.origin==='purchase')return Number(lot.total_cost_ugx)/Math.max(Number(lot.quantity_kg),1);const batch=batchByOutput.get(id);return batch?(unitCost(batch.input_lot_id,seen)*Number(batch.input_kg)+Number(batch.processing_cost_ugx))/Math.max(Number(batch.output_kg),1):0};
 // The cost of a sale is the cost of all the weight delivered, including what the buyer refused.
 const lotsBySale=saleLots.rows.reduce((m,x)=>m.set(x.sale_id,[...(m.get(x.sale_id)??[]),x]),new Map<string,any[]>());
 const cogs=sales.rows.reduce((n,x)=>n+(lotsBySale.get(x.id)?.reduce((t:number,p:any)=>t+unitCost(p.lot_id)*Number(p.delivered_kg),0)??unitCost(x.lot_id)*Number(x.quantity_kg)),0),inventoryValue=lots.rows.reduce((n,x)=>n+unitCost(x.id)*Number(x.available_kg),0),grossProfit=revenue-cogs;
 const finance=context.rows[0]||{};
 const totalCash=Number(finance.cash_position_ugx||0);
 const summary={lots:purchasedLots.length,purchasedKg:purchasedLots.reduce((n,x)=>n+Number(x.quantity_kg),0),availableKg:lots.rows.reduce((n,x)=>n+Number(x.available_kg),0),soldKg:sales.rows.reduce((n,x)=>n+Number(x.quantity_kg),0),buyerRejectedKg:sales.rows.reduce((n,x)=>n+Math.max(Number(x.delivered_kg??x.quantity_kg)-Number(x.quantity_kg),0),0),sortedInputKg,sortedOutputKg,rejectedKg,recoveryRate:sortedInputKg?Math.round(sortedOutputKg/sortedInputKg*1000)/10:0,stockAddedKg,stockRemovedKg,lossKg,purchaseCostUgx:purchaseCost,inventoryValueUgx:Math.round(inventoryValue),costOfGoodsSoldUgx:Math.round(cogs),grossProfitUgx:Math.round(grossProfit),creditPurchasesUgx:purchasedLots.filter(x=>x.purchase_payment_status!=='paid').reduce((n,x)=>n+Number(x.balance_ugx),0),overduePayablesUgx:purchasedLots.filter(x=>x.purchase_payment_state==='overdue').reduce((n,x)=>n+Number(x.balance_ugx),0),dueSoonPayablesUgx:purchasedLots.filter(x=>x.purchase_payment_state==='due_soon').reduce((n,x)=>n+Number(x.balance_ugx),0),revenueUgx:revenue,unpaidSalesUgx:sales.rows.filter(x=>x.status!=='paid').reduce((n,x)=>n+Number(x.balance_ugx),0),overdueReceivablesUgx:sales.rows.filter(x=>x.payment_state==='overdue').reduce((n,x)=>n+Number(x.balance_ugx),0),dueSoonReceivablesUgx:sales.rows.filter(x=>x.payment_state==='due_soon').reduce((n,x)=>n+Number(x.balance_ugx),0),saleExpensesUgx:saleExpenses,processingCostUgx:processingCost,profitLossUgx:Math.round(grossProfit-saleExpenses),floatBalanceUgx:floatBalance,officeCashUgx:totalCash-floatBalance,loansOutstandingUgx:loans.rows.reduce((n,x)=>n+Number(x.outstanding_ugx),0),openingBalanceUgx:Number(finance.opening_balance_ugx||0),openingBalanceConfigured:Boolean(finance.opening_balance_configured),cashPositionUgx:totalCash,committedFundsUgx:Number(finance.committed_funds_ugx||0),availableToCommitUgx:Number(finance.available_to_commit_ugx||0)};
 const materialMap=new Map<string,{materialType:string;purchasedKg:number;sortedKg:number;availableKg:number;soldKg:number;revenueUgx:number}>();
 const material=(name:string)=>{const key=name.trim().toLowerCase();if(!materialMap.has(key))materialMap.set(key,{materialType:name,purchasedKg:0,sortedKg:0,availableKg:0,soldKg:0,revenueUgx:0});return materialMap.get(key)!};
 lots.rows.forEach(x=>{const item=material(x.material_type);item.availableKg+=Number(x.available_kg);if(x.origin==='purchase')item.purchasedKg+=Number(x.quantity_kg);else item.sortedKg+=Number(x.quantity_kg)});
 sales.rows.forEach(x=>{const item=material(x.material_type);item.soldKg+=Number(x.quantity_kg);item.revenueUgx+=Number(x.total_ugx)});
 const expenseBreakdown={materialPurchasesUgx:purchasedLots.reduce((n,x)=>n+Number(x.material_cost_ugx),0),purchaseWagesUgx:purchasedLots.reduce((n,x)=>n+Number(x.worker_wages_ugx),0),purchaseFoodUgx:purchasedLots.reduce((n,x)=>n+Number(x.food_ugx),0),purchaseTransportUgx:purchasedLots.reduce((n,x)=>n+Number(x.transport_ugx),0),driverFeesUgx:purchasedLots.reduce((n,x)=>n+Number(x.driver_fee_ugx),0),purchaseOtherUgx:purchasedLots.reduce((n,x)=>n+Number(x.other_expense_ugx),0),processingUgx:processingCost,saleWagesUgx:sales.rows.reduce((n,x)=>n+Number(x.worker_wages_ugx),0),saleFoodUgx:sales.rows.reduce((n,x)=>n+Number(x.food_ugx),0),saleTransportUgx:sales.rows.reduce((n,x)=>n+Number(x.transport_ugx),0),saleOtherUgx:sales.rows.reduce((n,x)=>n+Number(x.other_expense_ugx),0)};
 const currentClosure=dailyClosures.rows.find(x=>dateValue(x.operating_date)===operatingDate);
 const operations={operatingDate,isClosed:currentClosure?.status==='closed',currentClosure:currentClosure??null,receivedTodayKg:purchasedLots.filter(x=>dateValue(x.collected_on)===operatingDate).reduce((n,x)=>n+Number(x.quantity_kg),0),sortedTodayKg:sorting.rows.filter(x=>dateValue(x.processed_on)===operatingDate).reduce((n,x)=>n+Number(x.output_kg),0),soldTodayKg:sales.rows.filter(x=>dateValue(x.sold_on)===operatingDate).reduce((n,x)=>n+Number(x.quantity_kg),0),stockLotsReady:lots.rows.filter(x=>Number(x.available_kg)>0).length,awaitingSortingKg:purchasedLots.reduce((n,x)=>n+Number(x.available_kg),0),saleableStockKg:lots.rows.filter(x=>x.origin==='sorting_output').reduce((n,x)=>n+Number(x.available_kg),0),workQueue:purchasedLots.filter(x=>Number(x.available_kg)>0).sort((a,b)=>dateValue(a.collected_on).localeCompare(dateValue(b.collected_on))).slice(0,8).map(x=>({lotId:x.id,materialType:x.material_type,sourceName:x.source_name,receivedOn:x.collected_on,availableKg:Number(x.available_kg),quality:x.quality}))};
 return{organization:context.rows[0],summary,operations,loans:loans.rows,dailyClosures:dailyClosures.rows,transactionEdits:transactionEdits.rows,lots:lots.rows,sales:sales.rows,floatTransactions:float.rows,cashMovements:cashMovements.rows,sortingBatches:sorting.rows,partners:partners.rows,deliveryStaff:deliveryStaff.rows,stockAdjustments:stockAdjustments.rows,salePayments:salePayments.rows,purchasePayments:purchasePayments.rows,materials:materials.rows,materialPerformance:[...materialMap.values()].sort((a,b)=>b.revenueUgx-a.revenueUgx||b.availableKg-a.availableKg),expenseBreakdown,paymentAging,buyerExposure,upcomingFollowUps};
}
/** The catalogue entry a name means, whatever its case or punctuation, following any merge. */
async function findMaterial(c:any,org:string,name:string):Promise<{name:string;active:boolean}|null>{
 const merged=(await c.query(`SELECT material FROM recycling_material_aliases WHERE organization_id=$1::uuid AND alias_key=recycling_material_key($2)`,[org,name])).rows[0];
 return(await c.query(`SELECT name,active FROM recycling_material_catalog WHERE organization_id=$1::uuid AND recycling_material_key(name)=recycling_material_key($2)`,[org,merged?.material??name])).rows[0]??null;
}
async function ensureMaterial(c:any,org:string,user:string,name:string,allowNew:boolean){
 const known=await findMaterial(c,org,name);
 if(known?.active)return known.name;
 if(!allowNew)throw Object.assign(new Error('Choose a material from the list or select Other and enter its name'),{statusCode:400});
 return(await c.query(`INSERT INTO recycling_material_catalog(organization_id,name,category,created_by)VALUES($1,$2,'other',$3) ON CONFLICT(organization_id,recycling_material_key(name)) DO UPDATE SET active=true,updated_at=now() RETURNING name`,[org,known?.name??name,user])).rows[0].name;
}
export async function createLot(org:string,user:string,d:any){const c=await dbPool.connect();try{await c.query('BEGIN');await assertRecyclingBusinessDayOpen(c,org,d.collectedOn,'recording this purchase');if(!(await c.query(`SELECT 1 FROM organizations WHERE id=$1::uuid AND type='recycling_company'`,[org])).rowCount)throw Object.assign(new Error('This workspace is not registered as a recycling company'),{statusCode:403});d.materialType=await ensureMaterial(c,org,user,d.materialType,d.allowNewMaterial);if(d.supplierPartnerId&&!(await c.query(`SELECT 1 FROM recycling_trade_partners WHERE id=$1::uuid AND organization_id=$2::uuid AND active=true AND partner_type IN('supplier','both')`,[d.supplierPartnerId,org])).rowCount)throw Object.assign(new Error('Choose an active supplier belonging to this organization'),{statusCode:400});const lot=(await c.query(`INSERT INTO recycling_material_lots(organization_id,material_type,supplier_partner_id,source_name,quantity_kg,available_kg,unit_purchase_price_ugx,collected_on,quality,purchase_payment_status,purchase_payment_reference,purchase_paid_on,worker_wages_ugx,food_ugx,transport_ugx,driver_fee_ugx,other_expense_ugx,manager_float_used_ugx,notes,created_by)VALUES($1,$2,$3,$4,$5,$5,$6,$7,$8,$9,$10,CASE WHEN $9='paid' THEN $7::date ELSE NULL END,$11,$12,$13,$14,$15,$16,$17,$18)RETURNING *`,[org,d.materialType,d.supplierPartnerId??null,d.sourceName,d.quantityKg,d.unitPurchasePriceUgx,d.collectedOn,d.quality,d.purchasePaymentStatus,d.purchasePaymentReference??null,d.workerWagesUgx,d.foodUgx,d.transportUgx,d.driverFeeUgx,d.otherExpenseUgx,d.managerFloatUsedUgx,d.notes??null,user])).rows[0];const total=Math.round(d.quantityKg*d.unitPurchasePriceUgx+d.workerWagesUgx+d.foodUgx+d.transportUgx+d.driverFeeUgx+d.otherExpenseUgx);if(d.purchasePaymentStatus==='paid')await c.query(`INSERT INTO recycling_purchase_payments(organization_id,lot_id,amount_ugx,paid_on,reference,recorded_by)VALUES($1,$2,$3,$4,$5,$6)`,[org,lot.id,total,d.collectedOn,d.purchasePaymentReference||`PURCHASE-${lot.id}`,user]);if(d.managerFloatUsedUgx>0)await c.query(`INSERT INTO recycling_manager_float_transactions(organization_id,transaction_date,transaction_type,amount_ugx,notes,purchase_lot_id,recorded_by)VALUES($1,$2,'spent',$3,$4,$5,$6)`,[org,d.collectedOn,d.managerFloatUsedUgx,`Purchase: ${d.materialType} from ${d.sourceName}`,lot.id,user]);await c.query('COMMIT');return lot}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}}
export async function createPurchaseBatch(org:string,user:string,d:any){const c=await dbPool.connect();try{await c.query('BEGIN');await assertRecyclingBusinessDayOpen(c,org,d.collectedOn,'recording this delivery');await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`recycling-finance:${org}`]);if(!(await c.query(`SELECT 1 FROM organizations WHERE id=$1::uuid AND type='recycling_company'`,[org])).rowCount)throw Object.assign(new Error('This workspace is not registered as a recycling company'),{statusCode:403});if(d.supplierPartnerId&&!(await c.query(`SELECT 1 FROM recycling_trade_partners WHERE id=$1::uuid AND organization_id=$2::uuid AND active=true AND partner_type IN('supplier','both')`,[d.supplierPartnerId,org])).rowCount)throw Object.assign(new Error('Choose an active supplier belonging to this organization'),{statusCode:400});if(d.deliveredByUserId&&!(await c.query(`SELECT 1 FROM users WHERE id=$1::uuid AND organization_id=$2::uuid AND status='active'`,[d.deliveredByUserId,org])).rowCount)throw Object.assign(new Error('Choose an active driver or field worker from this organization'),{statusCode:400});const shared=[d.workerWagesUgx,d.foodUgx,d.transportUgx,d.driverFeeUgx,d.otherExpenseUgx],materialTotal=d.lines.reduce((sum:number,line:any)=>sum+Math.round(line.quantityKg*line.unitPurchasePriceUgx),0),group=`${d.deliveryReference}-${Date.now().toString(36).toUpperCase()}`,lots=[];let allocated=[0,0,0,0,0],allocatedFloat=0;for(let index=0;index<d.lines.length;index++){const line=d.lines[index],last=index===d.lines.length-1,ratio=materialTotal>0?Math.round(line.quantityKg*line.unitPurchasePriceUgx)/materialTotal:1/d.lines.length,costs=shared.map((amount:number,costIndex:number)=>last?amount-allocated[costIndex]:Math.floor(amount*ratio));allocated=allocated.map((amount:number,costIndex:number)=>amount+costs[costIndex]);line.materialType=await ensureMaterial(c,org,user,line.materialType,line.allowNewMaterial);const lineTotal=Math.round(line.quantityKg*line.unitPurchasePriceUgx+costs.reduce((sum:number,value:number)=>sum+value,0)),floatUsed=last?d.managerFloatUsedUgx-allocatedFloat:Math.floor(d.managerFloatUsedUgx*ratio);allocatedFloat+=floatUsed;const lot=(await c.query(`INSERT INTO recycling_material_lots(organization_id,material_type,supplier_partner_id,source_name,quantity_kg,available_kg,unit_purchase_price_ugx,collected_on,quality,purchase_payment_status,purchase_payment_reference,purchase_paid_on,worker_wages_ugx,food_ugx,transport_ugx,driver_fee_ugx,other_expense_ugx,manager_float_used_ugx,notes,created_by,purchase_group_reference,delivered_by_user_id)VALUES($1,$2,$3,$4,$5,$5,$6,$7,$8,$9,$10,CASE WHEN $9='paid' THEN $7::date ELSE NULL END,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)RETURNING *`,[org,line.materialType,d.supplierPartnerId??null,d.sourceName,line.quantityKg,line.unitPurchasePriceUgx,d.collectedOn,line.quality,d.purchasePaymentStatus,d.purchasePaymentReference??null,costs[0],costs[1],costs[2],costs[3],costs[4],floatUsed,d.notes??null,user,group,d.deliveredByUserId??null])).rows[0];if(d.purchasePaymentStatus==='paid')await c.query(`INSERT INTO recycling_purchase_payments(organization_id,lot_id,amount_ugx,paid_on,reference,recorded_by)VALUES($1,$2,$3,$4,$5,$6)`,[org,lot.id,lineTotal,d.collectedOn,d.purchasePaymentReference?purchaseAllocationReference(d.purchasePaymentReference,index):`${d.deliveryReference}-${index+1}`,user]);if(floatUsed>0)await c.query(`INSERT INTO recycling_manager_float_transactions(organization_id,transaction_date,transaction_type,amount_ugx,reference,notes,purchase_lot_id,recorded_by)VALUES($1,$2,'spent',$3,$4,$5,$6,$7)`,[org,d.collectedOn,floatUsed,`${d.deliveryReference}-${index+1}`,`Grouped purchase: ${line.materialType} from ${d.sourceName}`,lot.id,user]);if(d.collectionLatitude!==undefined)await c.query(`UPDATE recycling_material_lots SET collection_latitude=$2,collection_longitude=$3,collection_accuracy_m=$4 WHERE id=$1::uuid`,[lot.id,d.collectionLatitude,d.collectionLongitude,d.collectionAccuracyM??null]);lots.push(lot)}await c.query('COMMIT');return{purchaseGroupReference:group,lots}}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}}
const setLotAvailable=(c:any,id:string,available:number)=>c.query(`UPDATE recycling_material_lots SET available_kg=$2::numeric,status=CASE WHEN $2::numeric<=0 THEN 'sold' WHEN $2::numeric<quantity_kg THEN 'partially_sold' ELSE 'available' END,updated_at=now() WHERE id=$1::uuid`,[id,available]);
/**
 * Locks the stock a sale or sorting draws from and splits the weight across it: one lot, or every lot of a material, oldest
 * first. Only material that had arrived by `onDate` can be used, so nothing is sorted or sold before it was received.
 */
async function takeFromStock(c:any,org:string,source:{lotId?:string;materialType?:string},kg:number,onDate:string){
 const material=source.materialType&&(await findMaterial(c,org,source.materialType))?.name||source.materialType;
 const lots=(await c.query(source.lotId
  ?`SELECT * FROM recycling_material_lots WHERE organization_id=$1::uuid AND id=$2::uuid AND collected_on<=$3::date FOR UPDATE`
  :`SELECT * FROM recycling_material_lots WHERE organization_id=$1::uuid AND lower(material_type)=lower($2) AND available_kg>0 AND collected_on<=$3::date ORDER BY collected_on,created_at,id FOR UPDATE`,[org,source.lotId??material,onDate])).rows;
 const available=lots.reduce((n:number,x:any)=>n+Number(x.available_kg),0);
 if(!lots.length)throw financeError(source.lotId?`The selected stock had not arrived by ${onDate}.`:`There was no ${material} in stock on ${onDate}.`);
 if(available+1e-9<kg)throw financeError(`Only ${available.toLocaleString()} kg of ${lots[0].material_type} was in stock on ${onDate}.`);
 const parts:{lot:any;kg:number}[]=[];let remaining=kg;
 for(const lot of lots){if(remaining<=0)break;const used=Math.min(Number(lot.available_kg),remaining);parts.push({lot,kg:used});remaining=Math.round((remaining-used)*1000)/1000}
 for(const p of parts)await setLotAvailable(c,p.lot.id,Math.round((Number(p.lot.available_kg)-p.kg)*1000)/1000);
 return parts;
}
async function saleBuyerName(c:any,org:string,d:any){
 if(!d.buyerPartnerId)return d.buyerName;
 const partner=(await c.query(`SELECT name FROM recycling_trade_partners WHERE id=$1::uuid AND organization_id=$2::uuid AND active=true AND partner_type IN('buyer','both')`,[d.buyerPartnerId,org])).rows[0];
 if(!partner)throw Object.assign(new Error('Choose an active buyer belonging to this organization'),{statusCode:400});
 return partner.name;
}
const saveSaleLots=async(c:any,org:string,saleId:string,parts:{lot:any;kg:number}[])=>{for(const p of parts)await c.query(`INSERT INTO recycling_sale_lots(organization_id,sale_id,lot_id,delivered_kg)VALUES($1,$2,$3,$4)`,[org,saleId,p.lot.id,p.kg])};
/**
 * Records a sale. The delivered weight leaves stock; the buyer pays for quantityKg and the rest is weight they refused.
 * When the buyer paid on the spot, the money is received into office cash as a payment against this sale.
 */
export async function createSale(org:string,user:string,d:any){
 const c=await dbPool.connect();
 try{
  await c.query('BEGIN');
  await assertRecyclingBusinessDayOpen(c,org,d.soldOn,'recording this sale');
  const floatUsed=Number(d.managerFloatUsedUgx||0);
  if(floatUsed>0){
   await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`recycling-finance:${org}`]);
   const balance=(await financeState(c,org)).floatBalance;
   if(floatUsed>balance)throw financeError(`Only ${Math.max(balance,0).toLocaleString()} UGX is left in the manager float and the sale costs need ${floatUsed.toLocaleString()} UGX. Ask the office to issue more float.`);
  }
  const deliveredKg=d.deliveredKg??d.quantityKg;
  const parts=await takeFromStock(c,org,d,deliveredKg,d.soldOn);
  const buyerName=await saleBuyerName(c,org,d);
  const sale=(await c.query(`INSERT INTO recycling_material_sales(organization_id,lot_id,buyer_partner_id,buyer_name,sale_channel,industry,invoice_number,quantity_kg,delivered_kg,unit_price_ugx,sold_on,worker_wages_ugx,food_ugx,transport_ugx,other_expense_ugx,notes,recorded_by,buyer_organization_id,manager_float_used_ugx)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)RETURNING *`,[org,parts[0].lot.id,d.buyerPartnerId??null,buyerName,d.saleChannel,d.industry,d.invoiceNumber??null,d.quantityKg,deliveredKg,d.unitPriceUgx,d.soldOn,d.workerWagesUgx,d.foodUgx,d.transportUgx,d.otherExpenseUgx,d.notes??null,user,d.buyerOrganizationId??null,floatUsed])).rows[0];
  await saveSaleLots(c,org,sale.id,parts);
  if(floatUsed>0)await c.query(`INSERT INTO recycling_manager_float_transactions(organization_id,transaction_date,transaction_type,amount_ugx,reference,notes,sale_id,recorded_by)VALUES($1,$2,'spent',$3,$4,$5,$6,$7)`,[org,d.soldOn,floatUsed,`SALE-${sale.id}`,`Sale costs: ${buyerName}`,sale.id,user]);
  let result=sale;
  if(d.paymentReceived==='now'){
   const reference=d.paymentReference??`SALE-CASH-${String(sale.id).slice(0,8).toUpperCase()}`;
   await c.query(`INSERT INTO recycling_sale_payments(organization_id,sale_id,amount_ugx,paid_on,reference,recorded_by)VALUES($1,$2,$3,$4,$5,$6)`,[org,sale.id,Math.round(d.quantityKg*d.unitPriceUgx),d.soldOn,reference,user]);
   result=(await c.query(`UPDATE recycling_material_sales SET status='paid',paid_on=$2::date,payment_reference=$3 WHERE id=$1::uuid RETURNING *`,[sale.id,d.soldOn,reference])).rows[0];
  }
  await c.query('COMMIT');
  return{...result,material_type:parts[0].lot.material_type};
 }catch(e:any){await c.query('ROLLBACK');if(e?.code==='23505'&&String(e?.constraint||'').includes('reference'))throw financeError('That payment reference is already used. Enter another one.');throw e}finally{c.release()}
}
export async function updateLot(org:string,user:string,id:string,d:any){const c=await dbPool.connect();try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`recycling-purchase:${id}`]);const lot=(await c.query(`SELECT * FROM recycling_material_lots WHERE id=$1::uuid AND organization_id=$2::uuid AND origin='purchase' FOR UPDATE`,[id,org])).rows[0];if(!lot){await c.query('ROLLBACK');return null}await assertRecyclingBusinessDaysOpen(c,org,[dateOnly(lot.collected_on),d.collectedOn],'correcting this purchase');d.materialType=await ensureMaterial(c,org,user,d.materialType,d.allowNewMaterial);if(d.supplierPartnerId&&!(await c.query(`SELECT 1 FROM recycling_trade_partners WHERE id=$1::uuid AND organization_id=$2::uuid AND active=true AND partner_type IN('supplier','both')`,[d.supplierPartnerId,org])).rowCount)throw Object.assign(new Error('Choose an active supplier belonging to this organization'),{statusCode:400});if(d.deliveredByUserId&&!(await c.query(`SELECT 1 FROM users WHERE id=$1::uuid AND organization_id=$2::uuid AND status='active'`,[d.deliveredByUserId,org])).rowCount)throw Object.assign(new Error('Choose an active driver or field worker from this organization'),{statusCode:400});const consumed=Number(lot.quantity_kg)-Number(lot.available_kg);if(d.quantityKg<consumed)throw financeError(`Purchase quantity cannot be below ${consumed.toLocaleString()} kg because that stock has already been used or sold.`);const paid=Number((await c.query(`SELECT COALESCE(SUM(amount_ugx),0)::bigint paid FROM recycling_purchase_payments WHERE organization_id=$1::uuid AND lot_id=$2::uuid`,[org,id])).rows[0].paid),total=Math.round(d.quantityKg*d.unitPurchasePriceUgx+d.workerWagesUgx+d.foodUgx+d.transportUgx+d.driverFeeUgx+d.otherExpenseUgx),oldTotal=Math.round(Number(lot.quantity_kg)*Number(lot.unit_purchase_price_ugx)+Number(lot.worker_wages_ugx)+Number(lot.food_ugx)+Number(lot.transport_ugx)+Number(lot.driver_fee_ugx)+Number(lot.other_expense_ugx));if(total<paid)throw financeError(`Purchase total cannot be below the UGX ${paid.toLocaleString()} already paid.`);const availableToCommit=Number((await c.query(`SELECT organization_available_to_commit($1::uuid)::bigint available`,[org])).rows[0].available),oldOutstanding=Math.max(oldTotal-paid,0),newOutstanding=Math.max(total-paid,0);if(newOutstanding>availableToCommit+oldOutstanding)throw financeError(`The corrected purchase exceeds available funds. Up to UGX ${(availableToCommit+oldOutstanding).toLocaleString()} can remain committed.`);const available=d.quantityKg-consumed,status=available===0?'sold':consumed>0?'partially_sold':'available',paymentStatus=paid===0?lot.purchase_payment_status:paid===total?'paid':'partially_paid';const updated=(await c.query(`UPDATE recycling_material_lots SET material_type=$3,supplier_partner_id=$4,source_name=$5,quantity_kg=$6,available_kg=$7,unit_purchase_price_ugx=$8,collected_on=$9,quality=$10,worker_wages_ugx=$11,food_ugx=$12,transport_ugx=$13,driver_fee_ugx=$14,other_expense_ugx=$15,notes=$16,status=$17,purchase_payment_status=$18,delivered_by_user_id=$19,purchase_group_reference=COALESCE($20,purchase_group_reference),updated_at=now() WHERE id=$1::uuid AND organization_id=$2::uuid RETURNING *`,[id,org,d.materialType,d.supplierPartnerId??null,d.sourceName,d.quantityKg,available,d.unitPurchasePriceUgx,d.collectedOn,d.quality,d.workerWagesUgx,d.foodUgx,d.transportUgx,d.driverFeeUgx,d.otherExpenseUgx,d.notes??null,status,paymentStatus,d.deliveredByUserId??null,d.deliveryReference??null])).rows[0];if(dateOnly(lot.collected_on)!==d.collectedOn){await c.query(`UPDATE recycling_purchase_payments SET paid_on=$4::date WHERE organization_id=$1::uuid AND lot_id=$2::uuid AND paid_on=$3::date`,[org,id,dateOnly(lot.collected_on),d.collectedOn]);await c.query(`UPDATE recycling_manager_float_transactions SET transaction_date=$4::date WHERE organization_id=$1::uuid AND purchase_lot_id=$2::uuid AND transaction_type='spent' AND transaction_date=$3::date`,[org,id,dateOnly(lot.collected_on),d.collectedOn]);await c.query(`UPDATE recycling_material_lots SET purchase_paid_on=$4::date WHERE organization_id=$1::uuid AND id=$2::uuid AND purchase_paid_on=$3::date`,[org,id,dateOnly(lot.collected_on),d.collectedOn])}await c.query(`INSERT INTO recycling_transaction_edits(organization_id,transaction_type,transaction_id,before_state,after_state,edited_by)VALUES($1,'purchase',$2,$3::jsonb,$4::jsonb,$5)`,[org,id,JSON.stringify(lot),JSON.stringify(updated),user]);await c.query('COMMIT');return updated}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}}
/** Corrects a sale: the weight it took is put back into stock and taken again from the corrected material and weights. */
export async function updateSale(org:string,user:string,id:string,d:any){
 const c=await dbPool.connect();
 try{
  await c.query('BEGIN');
  await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`recycling-sale:${id}`]);
  const sale=(await c.query(`SELECT * FROM recycling_material_sales WHERE id=$1::uuid AND organization_id=$2::uuid FOR UPDATE`,[id,org])).rows[0];
  if(!sale){await c.query('ROLLBACK');return null}
  await assertRecyclingBusinessDaysOpen(c,org,[dateOnly(sale.sold_on),d.soldOn],'correcting this sale');
  const taken=(await c.query(`SELECT lot_id,delivered_kg FROM recycling_sale_lots WHERE sale_id=$1::uuid ORDER BY lot_id`,[id])).rows;
  const restore=taken.length?taken.map((x:any)=>({lotId:x.lot_id,kg:Number(x.delivered_kg)})):[{lotId:sale.lot_id,kg:Number(sale.delivered_kg??sale.quantity_kg)}];
  for(const r of restore)await c.query(`UPDATE recycling_material_lots SET available_kg=available_kg+$2::numeric,status=CASE WHEN available_kg+$2::numeric>=quantity_kg THEN 'available' ELSE 'partially_sold' END,updated_at=now() WHERE id=$1::uuid AND organization_id=$3::uuid`,[r.lotId,r.kg,org]);
  await c.query(`DELETE FROM recycling_sale_lots WHERE sale_id=$1::uuid`,[id]);
  const deliveredKg=d.deliveredKg??d.quantityKg;
  const parts=await takeFromStock(c,org,d,deliveredKg,d.soldOn);
  const buyerName=await saleBuyerName(c,org,d);
  const paid=Number((await c.query(`SELECT COALESCE(SUM(amount_ugx),0)::bigint paid FROM recycling_sale_payments WHERE organization_id=$1::uuid AND sale_id=$2::uuid`,[org,id])).rows[0].paid),total=Math.round(d.quantityKg*d.unitPriceUgx);
  if(total<paid)throw financeError(`Sale total cannot be below the UGX ${paid.toLocaleString()} already received.`);
  const oldExpenses=Number(sale.worker_wages_ugx)+Number(sale.food_ugx)+Number(sale.transport_ugx)+Number(sale.other_expense_ugx),newExpenses=d.workerWagesUgx+d.foodUgx+d.transportUgx+d.otherExpenseUgx,extraExpense=Math.max(newExpenses-oldExpenses,0);
  if(Number(sale.manager_float_used_ugx)>0&&newExpenses!==oldExpenses)throw financeError('These sale costs were paid from the manager float, so they cannot be changed here. Record the difference as a float movement instead.');
  if(extraExpense>0){const cash=Number((await c.query(`SELECT organization_cash_position($1::uuid)::bigint cash`,[org])).rows[0].cash);if(extraExpense>cash)throw financeError(`The correction adds UGX ${extraExpense.toLocaleString()} in sale expenses but only UGX ${cash.toLocaleString()} cash is available.`)}
  const paymentStatus=paid===0?'recorded':paid===total?'paid':'partially_paid';
  const updated=(await c.query(`UPDATE recycling_material_sales SET lot_id=$3,buyer_partner_id=$4,buyer_name=$5,sale_channel=$6,industry=$7,invoice_number=$8,quantity_kg=$9,unit_price_ugx=$10,sold_on=$11,worker_wages_ugx=$12,food_ugx=$13,transport_ugx=$14,other_expense_ugx=$15,notes=$16,status=$17,buyer_organization_id=$18,delivered_kg=$19,paid_on=CASE WHEN $17='paid' THEN paid_on ELSE NULL END WHERE id=$1::uuid AND organization_id=$2::uuid RETURNING *`,[id,org,parts[0].lot.id,d.buyerPartnerId??null,buyerName,d.saleChannel,d.industry,d.invoiceNumber??null,d.quantityKg,d.unitPriceUgx,d.soldOn,d.workerWagesUgx,d.foodUgx,d.transportUgx,d.otherExpenseUgx,d.notes??null,paymentStatus,d.buyerOrganizationId??null,deliveredKg])).rows[0];
  await saveSaleLots(c,org,id,parts);
  if(dateOnly(sale.sold_on)!==d.soldOn)await c.query(`UPDATE recycling_manager_float_transactions SET transaction_date=$4::date WHERE organization_id=$1::uuid AND sale_id=$2::uuid AND transaction_type='spent' AND transaction_date=$3::date`,[org,id,dateOnly(sale.sold_on),d.soldOn]);
  await c.query(`INSERT INTO recycling_transaction_edits(organization_id,transaction_type,transaction_id,before_state,after_state,edited_by)VALUES($1,'sale',$2,$3::jsonb,$4::jsonb,$5)`,[org,id,JSON.stringify({...sale,lots:restore}),JSON.stringify({...updated,lots:parts.map(p=>({lotId:p.lot.id,kg:p.kg}))}),user]);
  await c.query('COMMIT');
  return updated;
 }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
}
export async function createFloatTransaction(org:string,user:string,d:any){const c=await dbPool.connect();try{await c.query('BEGIN');await assertRecyclingBusinessDayOpen(c,org,d.transactionDate,'recording this float movement');await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`recycling-finance:${org}`]);if(!(await c.query(`SELECT 1 FROM organizations WHERE id=$1::uuid AND type='recycling_company'`,[org])).rowCount)throw Object.assign(new Error('This workspace is not registered as a recycling company'),{statusCode:403});const state=await financeState(c,org),balance=state.floatBalance,officeCash=state.officeCash;if(d.transactionType==='given'&&!state.configured)throw financeError('Set the verified opening balance before issuing manager float.');if(d.transactionType==='given'&&d.amountUgx>officeCash)throw financeError(`Only ${Math.max(officeCash,0).toLocaleString()} UGX is available in office cash.`);if(d.transactionType!=='given'&&d.amountUgx>balance)throw financeError(`Only ${Math.max(balance,0).toLocaleString()} UGX remains with the manager.`);const row=(await c.query(`INSERT INTO recycling_manager_float_transactions(organization_id,transaction_date,transaction_type,amount_ugx,reference,notes,recorded_by)VALUES($1,$2,$3,$4,$5,$6,$7)RETURNING *`,[org,d.transactionDate,d.transactionType,d.amountUgx,d.reference,d.notes,user])).rows[0];await c.query('COMMIT');return row}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}}
export async function createCashMovement(org:string,user:string,d:any){const c=await dbPool.connect();try{await c.query('BEGIN');await assertRecyclingBusinessDayOpen(c,org,d.movementDate,'recording this cash movement');await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`recycling-finance:${org}`]);const officeCash=await configuredOfficeCash(c,org);if(d.direction==='out'&&d.amountUgx>officeCash)throw financeError(`Cash-out exceeds office cash. Only ${Math.max(officeCash,0).toLocaleString()} UGX is available.`);const row=(await c.query(`INSERT INTO recycling_cash_movements(organization_id,movement_date,direction,category,amount_ugx,reference,counterparty,notes,recorded_by)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)RETURNING *`,[org,d.movementDate,d.direction,d.category,d.amountUgx,d.reference,d.counterparty??null,d.notes,user])).rows[0];await c.query('COMMIT');return row}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}}
const duplicateReference=(e:any)=>e?.code==='23505'?financeError('That reference is already used. Enter another one.'):e;
/** Records money borrowed: the loan and the cash it brings into the office, together. */
export async function createLoan(org:string,user:string,d:any){
 const c=await dbPool.connect();
 try{
  await c.query('BEGIN');
  await assertRecyclingBusinessDayOpen(c,org,d.receivedOn,'recording this loan');
  await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`recycling-finance:${org}`]);
  await configuredOfficeCash(c,org);
  const loan=(await c.query(`INSERT INTO recycling_loans(organization_id,lender_name,amount_ugx,received_on,due_on,reference,notes,recorded_by)VALUES($1,$2,$3,$4,$5,$6,$7,$8)RETURNING *`,[org,d.lenderName,d.amountUgx,d.receivedOn,d.dueOn??null,d.reference,d.notes??null,user])).rows[0];
  await c.query(`INSERT INTO recycling_cash_movements(organization_id,movement_date,direction,category,amount_ugx,reference,counterparty,notes,recorded_by,loan_id)VALUES($1,$2,'in','loan_received',$3,$4,$5,$6,$7,$8)`,[org,d.receivedOn,d.amountUgx,d.reference,d.lenderName,d.notes||`Loan from ${d.lenderName}`,user,loan.id]);
  await c.query('COMMIT');
  return loan;
 }catch(e){await c.query('ROLLBACK');throw duplicateReference(e)}finally{c.release()}
}
/** Pays back part or all of a loan from office cash. */
export async function repayLoan(org:string,user:string,loanId:string,d:any){
 const c=await dbPool.connect();
 try{
  await c.query('BEGIN');
  await assertRecyclingBusinessDayOpen(c,org,d.paidOn,'recording this loan repayment');
  await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`recycling-finance:${org}`]);
  const loan=(await c.query(`SELECT l.*,l.amount_ugx-COALESCE((SELECT SUM(amount_ugx) FROM recycling_cash_movements WHERE loan_id=l.id AND category='loan_repayment'),0) outstanding FROM recycling_loans l WHERE l.id=$1::uuid AND l.organization_id=$2::uuid`,[loanId,org])).rows[0];
  if(!loan){await c.query('ROLLBACK');return null}
  const outstanding=Number(loan.outstanding);
  if(d.amountUgx>outstanding)throw financeError(outstanding>0?`Only UGX ${outstanding.toLocaleString()} of this loan is still owed.`:'This loan is already fully repaid.');
  if(d.paidOn<String(dateOnly(loan.received_on)))throw financeError('A repayment cannot be dated before the loan was received.');
  const officeCash=await configuredOfficeCash(c,org);
  if(d.amountUgx>officeCash)throw financeError(`The repayment is UGX ${d.amountUgx.toLocaleString()} but only UGX ${Math.max(officeCash,0).toLocaleString()} is in office cash.`);
  const row=(await c.query(`INSERT INTO recycling_cash_movements(organization_id,movement_date,direction,category,amount_ugx,reference,counterparty,notes,recorded_by,loan_id)VALUES($1,$2,'out','loan_repayment',$3,$4,$5,$6,$7,$8)RETURNING *`,[org,d.paidOn,d.amountUgx,d.reference,loan.lender_name,d.notes||`Repayment to ${loan.lender_name}`,user,loan.id])).rows[0];
  await c.query('COMMIT');
  return{...row,outstandingUgx:outstanding-d.amountUgx};
 }catch(e){await c.query('ROLLBACK');throw duplicateReference(e)}finally{c.release()}
}

const SORTING_COSTS=['workerWagesUgx','utilitiesUgx','transportUgx','consumablesUgx','otherExpenseUgx'] as const;
/**
 * Records sorting. The sorted weight and the waste are taken from one lot or from every lot of a material, oldest first.
 * Each input lot gets its own row and sorted lot, sharing the entry's costs by weight, and one entry id ties them together.
 */
export async function createSortingEntry(org:string,user:string,d:any){
 const c=await dbPool.connect();
 try{
  await c.query('BEGIN');
  await assertRecyclingBusinessDayOpen(c,org,d.processedOn,'recording this sorting entry');
  await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`recycling-finance:${org}`]);
  d.outputMaterialType=await ensureMaterial(c,org,user,d.outputMaterialType,d.allowNewMaterial);
  const total=SORTING_COSTS.reduce((sum,key)=>sum+d[key],0),money=await financeState(c,org);
  if(d.managerFloatUsedUgx>money.floatBalance)throw financeError(`Only ${Math.max(money.floatBalance,0).toLocaleString()} UGX manager float is available.`);
  if(total-d.managerFloatUsedUgx>money.officeCash)throw financeError(`Processing requires ${(total-d.managerFloatUsedUgx).toLocaleString()} UGX office cash but only ${Math.max(money.officeCash,0).toLocaleString()} UGX is available.`);
  const parts=await takeFromStock(c,org,d.inputMode==='lot'?{lotId:d.inputLotId}:{materialType:d.inputMaterialType},d.inputKg,d.processedOn);
  const entryId=randomUUID(),batches:any[]=[],allocated:Record<string,number>={outputKg:0};
  for(const [index,{lot,kg}] of parts.entries()){
   const last=index===parts.length-1,share=kg/d.inputKg;
   // Each row gets its share by weight; the last row takes what is left, so the rows add up exactly.
   const split=(key:string,value:number,round=(x:number)=>Math.round(x))=>{const part=last?value-(allocated[key]??0):round(value*share);allocated[key]=(allocated[key]??0)+part;return part};
   const costs=Object.fromEntries([...SORTING_COSTS,'managerFloatUsedUgx'].map(key=>[key,split(key,d[key])])) as Record<string,number>;
   const outputKg=Math.min(Math.round(split('outputKg',d.outputKg,x=>Math.round(x*100)/100)*100)/100,kg),rejectedKg=Math.max(Math.round((kg-outputKg)*100)/100,0);
   const output=(await c.query(`INSERT INTO recycling_material_lots(organization_id,material_type,source_name,quantity_kg,available_kg,unit_purchase_price_ugx,collected_on,quality,notes,created_by,origin,source_lot_id)VALUES($1,$2,$3,$4,$4,0,$5,'sorted',$6,$7,'sorting_output',$8)RETURNING *`,[org,d.outputMaterialType,`Sorted from ${lot.material_type}`,outputKg,d.processedOn,d.notes??null,user,lot.id])).rows[0];
   const batch=(await c.query(`INSERT INTO recycling_sorting_batches(organization_id,input_lot_id,output_lot_id,processed_on,input_kg,output_material_type,output_kg,rejected_kg,processing_cost_ugx,worker_wages_ugx,utilities_ugx,transport_ugx,consumables_ugx,other_expense_ugx,manager_float_used_ugx,notes,recorded_by,entry_id)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)RETURNING *`,[org,lot.id,output.id,d.processedOn,kg,d.outputMaterialType,outputKg,rejectedKg,SORTING_COSTS.reduce((sum,key)=>sum+costs[key],0),costs.workerWagesUgx,costs.utilitiesUgx,costs.transportUgx,costs.consumablesUgx,costs.otherExpenseUgx,costs.managerFloatUsedUgx,d.notes??null,user,entryId])).rows[0];
   if(costs.managerFloatUsedUgx>0)await c.query(`INSERT INTO recycling_manager_float_transactions(organization_id,transaction_date,transaction_type,amount_ugx,reference,notes,sorting_batch_id,recorded_by)VALUES($1,$2,'spent',$3,$4,$5,$6,$7)`,[org,d.processedOn,costs.managerFloatUsedUgx,`PROCESS-${batch.id}`,`Processing: ${d.outputMaterialType}`,batch.id,user]);
   batches.push({...batch,input_material_type:lot.material_type,output_material:output.material_type});
  }
  await c.query('COMMIT');
  const sum=(key:string)=>batches.reduce((n,b)=>n+Number(b[key]),0);
  return{entryId,inputKg:sum('input_kg'),outputKg:sum('output_kg'),rejectedKg:sum('rejected_kg'),batches};
 }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
}
/**
 * Reverses a sorting entry: the weight goes back into the input material, the sorted stock is removed, and the
 * processing costs and any float spent on them are taken off. Refused once any of the sorted stock has been used.
 * What was removed is kept in the edit history.
 */
export async function reverseSortingEntry(org:string,user:string,entryId:string,reason:string){
 const c=await dbPool.connect();
 try{
  await c.query('BEGIN');
  await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`recycling-finance:${org}`]);
  const batches=(await c.query(`SELECT * FROM recycling_sorting_batches WHERE organization_id=$1::uuid AND entry_id=$2::uuid ORDER BY input_lot_id FOR UPDATE`,[org,entryId])).rows;
  if(!batches.length){await c.query('ROLLBACK');return null}
  const day=dateOnly(batches[0].processed_on);
  await assertRecyclingBusinessDayOpen(c,org,day,'this sorting can be reversed');
  const outputIds=batches.map((b:any)=>b.output_lot_id),inputIds=batches.map((b:any)=>b.input_lot_id);
  const outputs=(await c.query(`SELECT * FROM recycling_material_lots WHERE organization_id=$1::uuid AND id=ANY($2::uuid[]) FOR UPDATE`,[org,outputIds])).rows;
  const used=outputs.some((x:any)=>Number(x.available_kg)!==Number(x.quantity_kg))||(await c.query(`SELECT 1 FROM recycling_material_sales WHERE lot_id=ANY($1::uuid[]) UNION ALL SELECT 1 FROM recycling_sale_lots WHERE lot_id=ANY($1::uuid[]) UNION ALL SELECT 1 FROM recycling_stock_adjustments WHERE lot_id=ANY($1::uuid[]) UNION ALL SELECT 1 FROM recycling_sorting_batches WHERE input_lot_id=ANY($1::uuid[]) LIMIT 1`,[outputIds])).rowCount;
  if(used)throw financeError(`Some of the sorted ${batches[0].output_material_type} has already been sold, sorted again or adjusted. Reverse those records first.`);
  await c.query(`SELECT 1 FROM recycling_material_lots WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE`,[inputIds]);
  for(const b of batches)await c.query(`UPDATE recycling_material_lots SET available_kg=available_kg+$2::numeric,status=CASE WHEN available_kg+$2::numeric>=quantity_kg THEN 'available' ELSE 'partially_sold' END,updated_at=now() WHERE id=$1::uuid`,[b.input_lot_id,b.input_kg]);
  const ids=batches.map((b:any)=>b.id);
  const float=(await c.query(`DELETE FROM recycling_manager_float_transactions WHERE organization_id=$1::uuid AND sorting_batch_id=ANY($2::uuid[]) RETURNING *`,[org,ids])).rows;
  await c.query(`INSERT INTO recycling_transaction_edits(organization_id,transaction_type,transaction_id,before_state,after_state,edited_by)VALUES($1,'sorting_reversal',$2,$3::jsonb,$4::jsonb,$5)`,[org,entryId,JSON.stringify({batches,outputLots:outputs,floatTransactions:float}),JSON.stringify({reversed:true,reason}),user]);
  await c.query(`DELETE FROM recycling_sorting_batches WHERE id=ANY($1::uuid[])`,[ids]);
  await c.query(`DELETE FROM recycling_material_lots WHERE id=ANY($1::uuid[])`,[outputIds]);
  await c.query('COMMIT');
  const sum=(key:string)=>batches.reduce((n:number,b:any)=>n+Number(b[key]),0);
  return{entryId,inputMaterial:(await dbPool.query(`SELECT material_type FROM recycling_material_lots WHERE id=$1::uuid`,[inputIds[0]])).rows[0]?.material_type,outputMaterial:batches[0].output_material_type,restoredKg:sum('input_kg'),removedKg:sum('output_kg'),processingCostUgx:sum('processing_cost_ugx')};
 }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
}
export async function createStockAdjustment(org:string,user:string,d:any){const c=await dbPool.connect();try{await c.query('BEGIN');await assertRecyclingBusinessDayOpen(c,org,d.adjustmentDate,'recording this stock adjustment');const lot=(await c.query(`SELECT * FROM recycling_material_lots WHERE id=$1::uuid AND organization_id=$2::uuid FOR UPDATE`,[d.lotId,org])).rows[0];if(!lot){await c.query('ROLLBACK');return null}const current=Number(lot.available_kg),outbound=d.adjustmentType!=='correction_in';if(outbound&&current<d.quantityKg){await c.query('ROLLBACK');return null}const available=current+(outbound?-d.quantityKg:d.quantityKg);await c.query(`UPDATE recycling_material_lots SET available_kg=$2::numeric,status=CASE WHEN $2::numeric=0::numeric THEN 'rejected' WHEN $2::numeric<quantity_kg THEN 'partially_sold' ELSE 'available' END,updated_at=now() WHERE id=$1::uuid`,[lot.id,available]);const adjustment=(await c.query(`INSERT INTO recycling_stock_adjustments(organization_id,lot_id,adjustment_date,adjustment_type,quantity_kg,reason,notes,recorded_by)VALUES($1,$2,$3,$4,$5,$6,$7,$8)RETURNING *`,[org,lot.id,d.adjustmentDate,d.adjustmentType,d.quantityKg,d.reason,d.notes??null,user])).rows[0];await c.query('COMMIT');return{...adjustment,material_type:lot.material_type,source_name:lot.source_name,available_kg:available}}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}}
export async function createPartner(org:string,user:string,d:any){if(!(await dbPool.query(`SELECT 1 FROM organizations WHERE id=$1::uuid AND type='recycling_company'`,[org])).rowCount)throw Object.assign(new Error('This workspace is not registered as a recycling company'),{statusCode:403});return(await dbPool.query(`INSERT INTO recycling_trade_partners(organization_id,partner_type,name,contact_person,phone,email,address,tax_number,created_by)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)RETURNING *`,[org,d.partnerType,d.name,d.contactPerson??null,d.phone??null,d.email??null,d.address??null,d.taxNumber??null,user])).rows[0]}
export async function updatePartner(org:string,id:string,d:any){return(await dbPool.query(`UPDATE recycling_trade_partners SET partner_type=$3,name=$4,contact_person=$5,phone=$6,email=$7,address=$8,tax_number=$9,updated_at=now() WHERE id=$1::uuid AND organization_id=$2::uuid RETURNING *`,[id,org,d.partnerType,d.name,d.contactPerson??null,d.phone??null,d.email??null,d.address??null,d.taxNumber??null])).rows[0]??null}
export async function setLotCollectionLocation(org:string,id:string,d:any){return(await dbPool.query(`UPDATE recycling_material_lots SET collection_latitude=$3,collection_longitude=$4,collection_accuracy_m=$5,updated_at=now() WHERE id=$1::uuid AND organization_id=$2::uuid RETURNING id`,[id,org,d.collectionLatitude,d.collectionLongitude,d.collectionAccuracyM??null])).rows[0]??null}
export async function setPartnerState(org:string,id:string,active:boolean){return(await dbPool.query(`UPDATE recycling_trade_partners SET active=$3,updated_at=now() WHERE id=$1::uuid AND organization_id=$2::uuid RETURNING *`,[id,org,active])).rows[0]??null}
export async function createMaterial(org:string,user:string,d:any){const known=await findMaterial(dbPool,org,d.name);if(known?.active)throw financeError(`${known.name} is already in the material list.`);return(await dbPool.query(`INSERT INTO recycling_material_catalog(organization_id,name,category,created_by)VALUES($1,$2,$3,$4) ON CONFLICT(organization_id,recycling_material_key(name)) DO UPDATE SET active=true,updated_at=now() RETURNING *`,[org,known?.name??d.name,d.category,user])).rows[0]}
export async function setMaterialState(org:string,id:string,active:boolean){return(await dbPool.query(`UPDATE recycling_material_catalog SET active=$3,updated_at=now() WHERE id=$1::uuid AND organization_id=$2::uuid RETURNING *`,[id,org,active])).rows[0]??null}
export async function markPurchasePaid(org:string,user:string,id:string,d:any,fromFloat=false){const c=await dbPool.connect();try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`recycling-purchase:${id}`]);await assertRecyclingBusinessDayOpen(c,org,d.paymentReceivedOn,'recording this supplier payment');const lot=(await c.query(`SELECT l.*,(ROUND(l.quantity_kg*l.unit_purchase_price_ugx)+l.worker_wages_ugx+l.food_ugx+l.transport_ugx+l.driver_fee_ugx+l.other_expense_ugx-COALESCE((SELECT SUM(amount_ugx) FROM recycling_purchase_payments WHERE lot_id=l.id),0))::bigint balance FROM recycling_material_lots l WHERE l.id=$1::uuid AND l.organization_id=$2::uuid AND l.origin='purchase' AND l.purchase_payment_status IN('credit','partially_paid') FOR UPDATE`,[id,org])).rows[0];if(!lot||d.amountUgx>Number(lot.balance)||d.paymentReceivedOn<lot.collected_on){await c.query('ROLLBACK');return null}if(fromFloat){await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`recycling-finance:${org}`]);const balance=Number((await c.query(`SELECT COALESCE(SUM(CASE WHEN transaction_type='given' THEN amount_ugx ELSE -amount_ugx END),0)::bigint balance FROM recycling_manager_float_transactions WHERE organization_id=$1::uuid`,[org])).rows[0].balance);if(d.amountUgx>balance)throw financeError(`Only ${Math.max(balance,0).toLocaleString()} UGX is left in the manager float. Ask the office to issue more float before paying this supplier.`);await c.query(`UPDATE recycling_material_lots SET manager_float_used_ugx=manager_float_used_ugx+$3 WHERE id=$1::uuid AND organization_id=$2::uuid`,[id,org,d.amountUgx]);await c.query(`INSERT INTO recycling_manager_float_transactions(organization_id,transaction_date,transaction_type,amount_ugx,reference,notes,purchase_lot_id,recorded_by)VALUES($1,$2,'spent',$3,$4,$5,$6,$7)`,[org,d.paymentReceivedOn,d.amountUgx,`SUPPLIER-${d.paymentReference}`,`Supplier payment: ${lot.source_name}`,id,user])}await c.query(`INSERT INTO recycling_purchase_payments(organization_id,lot_id,amount_ugx,paid_on,reference,recorded_by)VALUES($1,$2,$3,$4,$5,$6)`,[org,id,d.amountUgx,d.paymentReceivedOn,d.paymentReference,user]);const status=d.amountUgx===Number(lot.balance)?'paid':'partially_paid';const result=(await c.query(`UPDATE recycling_material_lots SET purchase_payment_status=$3,purchase_paid_on=CASE WHEN $3='paid' THEN $4::date ELSE purchase_paid_on END,purchase_payment_reference=$5,updated_at=now() WHERE id=$1::uuid AND organization_id=$2::uuid RETURNING *`,[id,org,status,d.paymentReceivedOn,d.paymentReference])).rows[0];await c.query('COMMIT');return result}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}}
export async function markSalePaid(org:string,user:string,id:string,d:any){const c=await dbPool.connect();try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`recycling-sale:${id}`]);await assertRecyclingBusinessDayOpen(c,org,d.paymentReceivedOn,'recording this buyer payment');const sale=(await c.query(`SELECT s.*,(ROUND(s.quantity_kg*s.unit_price_ugx)-COALESCE((SELECT SUM(amount_ugx) FROM recycling_sale_payments WHERE sale_id=s.id),0))::bigint balance FROM recycling_material_sales s WHERE s.id=$1::uuid AND s.organization_id=$2::uuid AND s.status IN('recorded','partially_paid') FOR UPDATE`,[id,org])).rows[0];if(!sale||d.amountUgx>Number(sale.balance)||d.paymentReceivedOn<sale.sold_on){await c.query('ROLLBACK');return null}await c.query(`INSERT INTO recycling_sale_payments(organization_id,sale_id,amount_ugx,paid_on,reference,recorded_by)VALUES($1,$2,$3,$4,$5,$6)`,[org,id,d.amountUgx,d.paymentReceivedOn,d.paymentReference,user]);const status=d.amountUgx===Number(sale.balance)?'paid':'partially_paid';const result=(await c.query(`UPDATE recycling_material_sales SET status=$3,paid_on=CASE WHEN $3='paid' THEN $4::date ELSE paid_on END,payment_reference=$5 WHERE id=$1::uuid AND organization_id=$2::uuid RETURNING *`,[id,org,status,d.paymentReceivedOn,d.paymentReference])).rows[0];await c.query('COMMIT');return result}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}}

export async function setPurchaseDueDate(org:string,id:string,dueOn:string){return(await dbPool.query(`UPDATE recycling_material_lots SET purchase_due_on=$3::date,updated_at=now() WHERE id=$1::uuid AND organization_id=$2::uuid AND origin='purchase' AND purchase_payment_status IN('credit','partially_paid') AND $3::date>=collected_on RETURNING *`,[id,org,dueOn])).rows[0]??null}
export async function setSaleDueDate(org:string,id:string,dueOn:string){return(await dbPool.query(`UPDATE recycling_material_sales SET due_on=$3::date WHERE id=$1::uuid AND organization_id=$2::uuid AND status IN('recorded','partially_paid') AND $3::date>=sold_on RETURNING *`,[id,org,dueOn])).rows[0]??null}
export async function createPaymentFollowUp(org:string,user:string,id:string,d:any){return(await dbPool.query(`INSERT INTO recycling_payment_followups(organization_id,sale_id,contact_method,outcome,note,next_follow_up_on,recorded_by) SELECT $2::uuid,s.id,$3,$4,$5,$6::date,$7::uuid FROM recycling_material_sales s WHERE s.id=$1::uuid AND s.organization_id=$2::uuid AND s.status IN('recorded','partially_paid') RETURNING *`,[id,org,d.contactMethod,d.outcome,d.note,d.nextFollowUpOn??null,user])).rows[0]??null}

export async function closeRecyclingDay(org:string,user:string,d:any){
 const c=await dbPool.connect();
 try{
  await c.query('BEGIN');
  await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`recycling-close:${org}:${d.operatingDate}`]);
  const context=(await c.query(`SELECT type,(now() AT TIME ZONE 'Africa/Kampala')::date::text today FROM organizations WHERE id=$1::uuid`,[org])).rows[0];
  if(!context||context.type!=='recycling_company')throw Object.assign(new Error('This workspace is not registered as a recycling company'),{statusCode:403});
  if(d.operatingDate>String(context.today).slice(0,10))throw Object.assign(new Error('A future business day cannot be closed'),{statusCode:400});
  if((await c.query(`SELECT 1 FROM recycling_daily_closures WHERE organization_id=$1::uuid AND operating_date=$2::date AND status='closed'`,[org,d.operatingDate])).rowCount)throw financeError(`Business day ${d.operatingDate} is already closed`);
  const state=await financeState(c,org),today=String(context.today).slice(0,10);
  if(!state.configured)throw financeError('Set and verify the opening cash balance before closing a business day.');
  if(state.cash<0||state.floatBalance<0||state.officeCash<0)throw financeError('The day cannot be closed while cash or manager float has a negative balance. Review the money ledger first.');
  if(d.operatingDate===today){
   if(d.countedOfficeCashUgx===undefined||d.countedManagerFloatUgx===undefined)throw financeError('Count office cash and manager float separately before closing today.');
   if(d.countedOfficeCashUgx!==state.officeCash)throw financeError(`Office cash count does not reconcile. The ledger expects UGX ${state.officeCash.toLocaleString()}, but UGX ${d.countedOfficeCashUgx.toLocaleString()} was counted.`);
   if(d.countedManagerFloatUgx!==state.floatBalance)throw financeError(`Manager float count does not reconcile. The ledger expects UGX ${state.floatBalance.toLocaleString()}, but UGX ${d.countedManagerFloatUgx.toLocaleString()} was counted.`);
  }
  const invalidStock=Number((await c.query(`SELECT COUNT(*)::int count FROM recycling_material_lots WHERE organization_id=$1::uuid AND (available_kg<0 OR available_kg>quantity_kg)`,[org])).rows[0].count);
  if(invalidStock)throw financeError(`${invalidStock} stock lot${invalidStock===1?' has':'s have'} an invalid available quantity. Correct stock before closing the day.`);
  const unresolvedExpenses=Number((await c.query(`SELECT COUNT(*)::int count FROM organization_expenses WHERE organization_id=$1::uuid AND expense_date=$2::date AND status NOT IN('paid','void')`,[org,d.operatingDate])).rows[0].count);
  if(unresolvedExpenses)throw financeError(`${unresolvedExpenses} expense${unresolvedExpenses===1?' is':'s are'} still awaiting approval or payment. Complete or void them before closing the day.`);
  const snapshot=(await c.query(`SELECT jsonb_build_object(
   'purchaseCount',(SELECT COUNT(*) FROM recycling_material_lots WHERE organization_id=$1::uuid AND origin='purchase' AND collected_on=$2::date),
   'purchasedKg',COALESCE((SELECT SUM(quantity_kg) FROM recycling_material_lots WHERE organization_id=$1::uuid AND origin='purchase' AND collected_on=$2::date),0),
   'purchaseCostUgx',COALESCE((SELECT SUM(ROUND(quantity_kg*unit_purchase_price_ugx)+worker_wages_ugx+food_ugx+transport_ugx+driver_fee_ugx+other_expense_ugx) FROM recycling_material_lots WHERE organization_id=$1::uuid AND origin='purchase' AND collected_on=$2::date),0),
   'sortingCount',(SELECT COUNT(*) FROM recycling_sorting_batches WHERE organization_id=$1::uuid AND processed_on=$2::date),
   'sortedOutputKg',COALESCE((SELECT SUM(output_kg) FROM recycling_sorting_batches WHERE organization_id=$1::uuid AND processed_on=$2::date),0),
   'processingCostUgx',COALESCE((SELECT SUM(processing_cost_ugx) FROM recycling_sorting_batches WHERE organization_id=$1::uuid AND processed_on=$2::date),0),
   'saleCount',(SELECT COUNT(*) FROM recycling_material_sales WHERE organization_id=$1::uuid AND sold_on=$2::date),
   'soldKg',COALESCE((SELECT SUM(quantity_kg) FROM recycling_material_sales WHERE organization_id=$1::uuid AND sold_on=$2::date),0),
   'salesValueUgx',COALESCE((SELECT SUM(quantity_kg*unit_price_ugx) FROM recycling_material_sales WHERE organization_id=$1::uuid AND sold_on=$2::date),0),
   'cashReceivedUgx',COALESCE((SELECT SUM(amount_ugx) FROM recycling_sale_payments WHERE organization_id=$1::uuid AND paid_on=$2::date),0),
   'supplierPaymentsUgx',COALESCE((SELECT SUM(amount_ugx) FROM recycling_purchase_payments WHERE organization_id=$1::uuid AND paid_on=$2::date),0),
   'dailyExpensesUgx',COALESCE((SELECT SUM(amount_ugx) FROM organization_expenses WHERE organization_id=$1::uuid AND expense_date=$2::date AND status='paid'),0),
   'cashInUgx',COALESCE((SELECT SUM(amount_ugx) FROM recycling_cash_movements WHERE organization_id=$1::uuid AND movement_date=$2::date AND direction='in'),0),
   'cashOutUgx',COALESCE((SELECT SUM(amount_ugx) FROM recycling_cash_movements WHERE organization_id=$1::uuid AND movement_date=$2::date AND direction='out'),0),
   'floatGivenUgx',COALESCE((SELECT SUM(amount_ugx) FROM recycling_manager_float_transactions WHERE organization_id=$1::uuid AND transaction_date=$2::date AND transaction_type='given'),0),
   'floatSpentUgx',COALESCE((SELECT SUM(amount_ugx) FROM recycling_manager_float_transactions WHERE organization_id=$1::uuid AND transaction_date=$2::date AND transaction_type='spent'),0),
   'floatReturnedUgx',COALESCE((SELECT SUM(amount_ugx) FROM recycling_manager_float_transactions WHERE organization_id=$1::uuid AND transaction_date=$2::date AND transaction_type='returned'),0),
   'receivablesUgx',COALESCE((SELECT SUM(GREATEST(ROUND(s.quantity_kg*s.unit_price_ugx)-COALESCE(p.paid,0),0)) FROM recycling_material_sales s LEFT JOIN LATERAL(SELECT SUM(amount_ugx) paid FROM recycling_sale_payments WHERE sale_id=s.id AND organization_id=s.organization_id)p ON true WHERE s.organization_id=$1::uuid),0),
   'payablesUgx',COALESCE((SELECT SUM(GREATEST(ROUND(l.quantity_kg*l.unit_purchase_price_ugx)+l.worker_wages_ugx+l.food_ugx+l.transport_ugx+l.driver_fee_ugx+l.other_expense_ugx-COALESCE(p.paid,0),0)) FROM recycling_material_lots l LEFT JOIN LATERAL(SELECT SUM(amount_ugx) paid FROM recycling_purchase_payments WHERE lot_id=l.id AND organization_id=l.organization_id)p ON true WHERE l.organization_id=$1::uuid AND l.origin='purchase'),0),
   'stockOnHandKg',COALESCE((SELECT SUM(available_kg) FROM recycling_material_lots WHERE organization_id=$1::uuid),0)
  ) snapshot`,[org,d.operatingDate])).rows[0].snapshot;
  snapshot.cashPositionUgx=state.cash;
  snapshot.officeCashUgx=state.officeCash;
  snapshot.managerFloatUgx=state.floatBalance;
  snapshot.countedOfficeCashUgx=d.countedOfficeCashUgx??null;
  snapshot.countedManagerFloatUgx=d.countedManagerFloatUgx??null;
  snapshot.allDevicesSynced=true;
  snapshot.reconciledAt=new Date().toISOString();
  const result=(await c.query(`INSERT INTO recycling_daily_closures(organization_id,operating_date,status,snapshot,notes,closed_by) VALUES($1,$2,'closed',$3::jsonb,$4,$5) ON CONFLICT(organization_id,operating_date) DO UPDATE SET status='closed',snapshot=EXCLUDED.snapshot,notes=EXCLUDED.notes,closed_by=EXCLUDED.closed_by,closed_at=now(),reopened_by=NULL,reopened_at=NULL,reopen_reason=NULL,updated_at=now() RETURNING *`,[org,d.operatingDate,JSON.stringify(snapshot),d.notes??null,user])).rows[0];
  await c.query(`INSERT INTO recycling_daily_closure_events(organization_id,closure_id,operating_date,action,actor_user_id,reason,snapshot) VALUES($1,$2,$3,'closed',$4,$5,$6::jsonb)`,[org,result.id,d.operatingDate,user,d.notes??null,JSON.stringify(snapshot)]);
  await c.query('COMMIT');return result;
 }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
}

export async function reopenRecyclingDay(org:string,user:string,id:string,reason:string){
 const c=await dbPool.connect();
 try{
  await c.query('BEGIN');
  const target=(await c.query(`SELECT operating_date FROM recycling_daily_closures WHERE id=$1::uuid AND organization_id=$2::uuid`,[id,org])).rows[0];
  if(!target){await c.query('ROLLBACK');return null}
  await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`recycling-close:${org}:${dateOnly(target.operating_date)}`]);
  const closure=(await c.query(`SELECT * FROM recycling_daily_closures WHERE id=$1::uuid AND organization_id=$2::uuid AND status='closed' FOR UPDATE`,[id,org])).rows[0];
  if(!closure){await c.query('ROLLBACK');return null}
  await c.query(`INSERT INTO recycling_daily_closure_events(organization_id,closure_id,operating_date,action,actor_user_id,reason,snapshot) VALUES($1,$2,$3,'reopened',$4,$5,$6::jsonb)`,[org,id,closure.operating_date,user,reason,JSON.stringify(closure.snapshot??{})]);
  const result=(await c.query(`UPDATE recycling_daily_closures SET status='reopened',reopened_by=$3::uuid,reopened_at=now(),reopen_reason=$4,updated_at=now() WHERE id=$1::uuid AND organization_id=$2::uuid AND status='closed' RETURNING *`,[id,org,user,reason])).rows[0]??null;
  await c.query('COMMIT');return result;
 }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
}

export async function assertPurchaseFunding(org:string,d:any){
 const total=d.quantityKg*d.unitPurchasePriceUgx+d.workerWagesUgx+d.foodUgx+d.transportUgx+d.driverFeeUgx+d.otherExpenseUgx;
 const state=await financeState(dbPool,org),available=Number((await dbPool.query(`SELECT organization_available_to_commit($1::uuid)::bigint available`,[org])).rows[0].available);
 if(d.purchasePaymentStatus==='paid'&&!state.configured)throw financeError('Company funding has not been initialized. Ask the company administrator to set the verified opening balance under Finance before recording a paid purchase.');
 const officeCash=state.officeCash,officeRequired=total-d.managerFloatUsedUgx;
 if(d.purchasePaymentStatus==='paid'&&officeRequired>officeCash)throw financeError(`Purchase needs ${officeRequired.toLocaleString()} UGX from office cash, but only ${Math.max(officeCash,0).toLocaleString()} UGX is available after manager float.`)
 if(d.purchasePaymentStatus==='credit'&&total>available)throw financeError(available<0?`Credit purchase cannot be committed. Available funds are UGX 0 and existing commitments exceed cash by UGX ${Math.abs(available).toLocaleString()}.`:`Credit purchase cannot be committed. Only UGX ${available.toLocaleString()} is available.`);
 if(d.purchasePaymentStatus==='credit'&&d.managerFloatUsedUgx>0)throw financeError('A credit purchase cannot use manager float before it is paid.');
 if(d.managerFloatUsedUgx>state.floatBalance)throw financeError(`Only ${Math.max(state.floatBalance,0).toLocaleString()} UGX is left in the manager float and this needs ${Number(d.managerFloatUsedUgx).toLocaleString()} UGX. Ask the office to issue more float.`);
}
export async function assertCashFunding(org:string,amount:number,label:string){
 if(amount<=0)return;
 const cash=(await financeState(dbPool,org)).officeCash;
 if(amount>cash)throw financeError(`${label} cannot be paid: ${amount.toLocaleString()} UGX is required but only ${cash.toLocaleString()} UGX cash is available.`);
}
export async function assertCreditPurchasePaymentFunding(org:string,amount:number){
 await assertCashFunding(org,amount,'Supplier payment');
}
