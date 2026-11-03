type Row = Record<string, any>;
export type CompanyReportRecords = { organization: Row; lots: Row[]; sales: Row[]; saleLots?: Row[]; sorting: Row[]; adjustments: Row[]; expenses: Row[]; purchasePayments: Row[]; salePayments: Row[]; float: Row[] };
const n = (value: unknown) => Number(value || 0);
const sum = (rows: Row[], field: string) => rows.reduce((total, row) => total + n(row[field]), 0);
const purchaseCost = (lot: Row) => Math.round(n(lot.quantity_kg) * n(lot.unit_purchase_price_ugx)) + ['worker_wages_ugx','food_ugx','transport_ugx','driver_fee_ugx','other_expense_ugx'].reduce((total,key)=>total+n(lot[key]),0);
const saleCosts = (sale: Row) => ['worker_wages_ugx','food_ugx','transport_ugx','other_expense_ugx'].reduce((total,key)=>total+n(sale[key]),0);
/** Pure report calculation, shared by every client through the company report API. Stock is explicitly current; balances are as of the period end. */
export function buildCompanyReport(records: CompanyReportRecords, from: string, to: string, generatedAt = new Date().toISOString()) {
 const within = (date: string) => date >= from && date <= to;
 const lots = new Map(records.lots.map(row=>[row.id,row]));
 const batches = new Map(records.sorting.map(row=>[row.output_lot_id,row]));
 const warnings = new Set<string>();
 const costs = new Map<string,number>();
 const unitCost = (id: string, seen = new Set<string>()): number => {
  if(costs.has(id))return costs.get(id)!;
  const lot = lots.get(id);
  if(!lot || seen.has(id)){warnings.add('Some material costs could not be traced. Profit and stock value are estimates.');return 0;}
  if(n(lot.quantity_kg)<=0){warnings.add('Some material quantities are invalid. Review the stock records.');return 0;}
  seen.add(id);
  const batch=batches.get(id);
  const cost=lot.origin==='purchase'?purchaseCost(lot)/n(lot.quantity_kg):batch&&n(batch.output_kg)>0?(unitCost(batch.input_lot_id,seen)*n(batch.input_kg)+n(batch.processing_cost_ugx))/n(batch.output_kg):0;
  if(lot.origin!=='purchase'&&!batch)warnings.add('Some material costs could not be traced. Profit and stock value are estimates.');
  costs.set(id,cost);return cost;
 };
 const payments = (rows: Row[],key: string) => {const totals=new Map<string,number>();for(const row of rows.filter(p=>p.paid_on<=to))totals.set(row[key],(totals.get(row[key])||0)+n(row.amount_ugx));return totals;};
 const purchasePaid=payments(records.purchasePayments,'lot_id'),salePaid=payments(records.salePayments,'sale_id');
 const purchases=records.lots.filter(row=>row.origin==='purchase'&&within(row.collected_on)).map<Row & {totalCostUgx:number;paidUgx:number;balanceUgx:number}>(row=>({...row,totalCostUgx:purchaseCost(row),paidUgx:purchasePaid.get(row.id)||0,balanceUgx:Math.max(0,purchaseCost(row)-(purchasePaid.get(row.id)||0))}));
 // A sale costs all the weight it delivered from each lot, including weight the buyer refused. Sales recorded before
 // sale lots existed took their paid weight from one lot.
 const saleLots=new Map<string,Row[]>();for(const row of records.saleLots??[])saleLots.set(row.sale_id,[...(saleLots.get(row.sale_id)??[]),row]);
 const saleCost=(sale:Row)=>saleLots.get(sale.id)?.reduce((total,part)=>total+unitCost(part.lot_id)*n(part.delivered_kg),0)??unitCost(sale.lot_id)*n(sale.quantity_kg);
 const sales=records.sales.filter(row=>within(row.sold_on)).map<Row & {revenueUgx:number;costOfGoodsUgx:number;sellingCostsUgx:number;paidUgx:number;balanceUgx:number}>(row=>({...row,material_type:lots.get(row.lot_id)?.material_type||'Unknown',revenueUgx:Math.round(n(row.quantity_kg)*n(row.unit_price_ugx)),costOfGoodsUgx:saleCost(row),sellingCostsUgx:saleCosts(row),paidUgx:salePaid.get(row.id)||0,balanceUgx:Math.max(0,Math.round(n(row.quantity_kg)*n(row.unit_price_ugx))-(salePaid.get(row.id)||0))}));
 const expenses=records.expenses.filter(row=>within(row.expense_date));
 const recognizedExpenses=expenses.filter(row=>['approved','paid'].includes(row.status)&&row.category!=='worker_credit');
 const stockLoss=records.adjustments.filter(row=>within(row.adjustment_date)&&['loss','correction_out'].includes(row.adjustment_type)).reduce((total,row)=>total+unitCost(row.lot_id)*n(row.quantity_kg),0);
 const unallocatedFloat=records.float.filter(row=>within(row.transaction_date)&&row.transaction_type==='spent'&&!row.purchase_lot_id&&!row.sale_id&&!row.sorting_batch_id);
 const stock=records.lots.filter(row=>n(row.available_kg)>0).map(row=>({id:row.id,material:row.material_type,quantityKg:n(row.available_kg),valueUgx:unitCost(row.id)*n(row.available_kg)}));
 const materials=new Map<string,{material:string;quantityKg:number;valueUgx:number}>();
 for(const row of stock){const item=materials.get(row.material)||{material:row.material,quantityKg:0,valueUgx:0};item.quantityKg+=row.quantityKg;item.valueUgx+=row.valueUgx;materials.set(row.material,item);}
 const revenue=sum(sales,'revenueUgx'),cogs=sum(sales,'costOfGoodsUgx'),selling=sum(sales,'sellingCostsUgx'),overhead=sum(recognizedExpenses,'amount_ugx')+sum(unallocatedFloat,'amount_ugx');
 const days=new Map<string,{date:string;purchases:number;purchaseCostUgx:number;purchasedKg:number;sales:number;revenueUgx:number;soldKg:number;costOfGoodsUgx:number;sellingCostsUgx:number;overheadUgx:number;stockLossUgx:number}>();
 const day=(date:string)=>{if(!days.has(date))days.set(date,{date,purchases:0,purchaseCostUgx:0,purchasedKg:0,sales:0,revenueUgx:0,soldKg:0,costOfGoodsUgx:0,sellingCostsUgx:0,overheadUgx:0,stockLossUgx:0});return days.get(date)!;};
 for(const p of purchases){const d=day(p.collected_on);d.purchases++;d.purchaseCostUgx+=p.totalCostUgx;d.purchasedKg+=n(p.quantity_kg);}
 for(const s of sales){const d=day(s.sold_on);d.sales++;d.revenueUgx+=s.revenueUgx;d.soldKg+=n(s.quantity_kg);d.costOfGoodsUgx+=s.costOfGoodsUgx;d.sellingCostsUgx+=s.sellingCostsUgx;}
 for(const e of recognizedExpenses)day(e.expense_date).overheadUgx+=n(e.amount_ugx);
 for(const f of unallocatedFloat)day(f.transaction_date).overheadUgx+=n(f.amount_ugx);
 for(const a of records.adjustments.filter(row=>within(row.adjustment_date)&&['loss','correction_out'].includes(row.adjustment_type)))day(a.adjustment_date).stockLossUgx+=unitCost(a.lot_id)*n(a.quantity_kg);
 const partners=(rows: Row[],nameKey:string,valueKey:string)=>{const grouped=new Map<string,{name:string;transactions:number;quantityKg:number;valueUgx:number;paidUgx:number;balanceUgx:number}>();for(const row of rows){const name=String(row[nameKey]||'Unrecorded');const item=grouped.get(name)||{name,transactions:0,quantityKg:0,valueUgx:0,paidUgx:0,balanceUgx:0};item.transactions++;item.quantityKg+=n(row.quantity_kg);item.valueUgx+=n(row[valueKey]);item.paidUgx+=row.paidUgx;item.balanceUgx+=row.balanceUgx;grouped.set(name,item);}return [...grouped.values()].sort((a,b)=>b.valueUgx-a.valueUgx);};
 return {
  organization:records.organization,range:{from,to},generatedAt,
  basis:{stock:'Current stock at report generation',balances:`Outstanding as of ${to}`,profit:'Sales less the allocated cost of material sold, selling costs, approved or paid operating expenses, unlinked float spending and recorded stock losses. Sorting costs are allocated through material cost. Draft, void expenses and worker advances are excluded. This is an operating estimate before tax; capital purchases and unrecorded costs require accounting review.'},
  summary:{purchases:purchases.length,purchasedKg:sum(purchases,'quantity_kg'),purchaseCostUgx:sum(purchases,'totalCostUgx'),deliveries:new Set(purchases.map(row=>row.purchase_group_reference||row.id)).size,sales:sales.length,soldKg:sum(sales,'quantity_kg'),revenueUgx:revenue,costOfGoodsUgx:cogs,grossProfitUgx:revenue-cogs,sellingCostsUgx:selling,operatingExpensesUgx:overhead,stockLossUgx:stockLoss,operatingProfitUgx:revenue-cogs-selling-overhead-stockLoss,marginPercent:revenue?(revenue-cogs-selling-overhead-stockLoss)/revenue*100:0,
   buyerReceiptsUgx:sum(records.salePayments.filter(row=>within(row.paid_on)),'amount_ugx'),supplierPaymentsUgx:sum(records.purchasePayments.filter(row=>within(row.paid_on)),'amount_ugx'),
   receivablesUgx:records.sales.filter(row=>row.sold_on<=to).reduce((total,row)=>total+Math.max(0,Math.round(n(row.quantity_kg)*n(row.unit_price_ugx))-(salePaid.get(row.id)||0)),0),payablesUgx:records.lots.filter(row=>row.origin==='purchase'&&row.collected_on<=to).reduce((total,row)=>total+Math.max(0,purchaseCost(row)-(purchasePaid.get(row.id)||0)),0),
   stockKg:sum(stock,'quantityKg'),stockValueUgx:sum(stock,'valueUgx'),draftExpensesUgx:sum(expenses.filter(row=>row.status==='draft'),'amount_ugx'),workerAdvancesUgx:sum(expenses.filter(row=>row.category==='worker_credit'&&row.status!=='void'),'amount_ugx')},
  purchases,sales,expenses,stock:[...materials.values()].sort((a,b)=>a.material.localeCompare(b.material)),suppliers:partners(purchases,'source_name','totalCostUgx'),buyers:partners(sales,'buyer_name','revenueUgx'),daily:[...days.values()].sort((a,b)=>a.date.localeCompare(b.date)).map(row=>({...row,operatingProfitUgx:row.revenueUgx-row.costOfGoodsUgx-row.sellingCostsUgx-row.overheadUgx-row.stockLossUgx})),warnings:[...warnings],
 };
}
