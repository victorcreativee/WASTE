"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.findRecycling = findRecycling;
exports.createLot = createLot;
exports.createSale = createSale;
exports.createFloatTransaction = createFloatTransaction;
exports.createSortingBatch = createSortingBatch;
exports.createStockAdjustment = createStockAdjustment;
exports.createPartner = createPartner;
exports.setLotCollectionLocation = setLotCollectionLocation;
exports.setPartnerState = setPartnerState;
exports.createMaterial = createMaterial;
exports.setMaterialState = setMaterialState;
exports.markPurchasePaid = markPurchasePaid;
exports.markSalePaid = markSalePaid;
exports.setPurchaseDueDate = setPurchaseDueDate;
exports.setSaleDueDate = setSaleDueDate;
exports.createPaymentFollowUp = createPaymentFollowUp;
exports.closeRecyclingDay = closeRecyclingDay;
exports.reopenRecyclingDay = reopenRecyclingDay;
exports.assertPurchaseFunding = assertPurchaseFunding;
exports.assertCashFunding = assertCashFunding;
exports.assertFloatFunding = assertFloatFunding;
exports.assertCreditPurchasePaymentFunding = assertCreditPurchasePaymentFunding;
const database_1 = require("../config/database");
const financeError = (message) => Object.assign(new Error(message), { statusCode: 409 });
async function findRecycling(org) {
    const [context, lots, sales, float, sorting, partners, stockAdjustments, salePayments, purchasePayments, materials, dailyClosures] = await Promise.all([
        database_1.dbPool.query(`SELECT o.id,o.name,o.type,CURRENT_DATE::text operating_date,
   COALESCE(f.opening_balance_ugx,0)::bigint opening_balance_ugx,(f.organization_id IS NOT NULL) opening_balance_configured,
   organization_cash_position(o.id)::bigint cash_position_ugx,
   organization_committed_funds(o.id)::bigint committed_funds_ugx,
   organization_available_to_commit(o.id)::bigint available_to_commit_ugx
   FROM organizations o LEFT JOIN organization_finance_settings f ON f.organization_id=o.id WHERE o.id=$1::uuid`, [org]),
        database_1.dbPool.query(`SELECT l.*,creator.full_name recorded_by_name,ROUND(l.quantity_kg*l.unit_purchase_price_ugx)::bigint material_cost_ugx,(ROUND(l.quantity_kg*l.unit_purchase_price_ugx)+l.worker_wages_ugx+l.food_ugx+l.transport_ugx+l.driver_fee_ugx+l.other_expense_ugx)::bigint total_cost_ugx,COALESCE(p.paid_ugx,0)::bigint paid_ugx,GREATEST((ROUND(l.quantity_kg*l.unit_purchase_price_ugx)+l.worker_wages_ugx+l.food_ugx+l.transport_ugx+l.driver_fee_ugx+l.other_expense_ugx)-COALESCE(p.paid_ugx,0),0)::bigint balance_ugx,CASE WHEN l.purchase_payment_status IN('credit','partially_paid') AND l.purchase_due_on<CURRENT_DATE THEN 'overdue' WHEN l.purchase_payment_status IN('credit','partially_paid') AND l.purchase_due_on<=CURRENT_DATE+7 THEN 'due_soon' ELSE l.purchase_payment_status END purchase_payment_state FROM recycling_material_lots l LEFT JOIN users creator ON creator.id=l.created_by LEFT JOIN LATERAL(SELECT SUM(amount_ugx)::bigint paid_ugx FROM recycling_purchase_payments WHERE lot_id=l.id AND organization_id=l.organization_id)p ON true WHERE l.organization_id=$1::uuid ORDER BY l.collected_on DESC,l.created_at DESC`, [org]),
        database_1.dbPool.query(`SELECT s.*,recorder.full_name recorded_by_name,l.material_type,(s.quantity_kg*s.unit_price_ugx)::bigint total_ugx,COALESCE(pay.paid_ugx,0)::bigint paid_ugx,GREATEST((s.quantity_kg*s.unit_price_ugx)-COALESCE(pay.paid_ugx,0),0)::bigint balance_ugx,(s.worker_wages_ugx+s.food_ugx+s.transport_ugx+s.other_expense_ugx)::bigint expenses_ugx,((s.quantity_kg*s.unit_price_ugx)-(s.worker_wages_ugx+s.food_ugx+s.transport_ugx+s.other_expense_ugx))::bigint net_income_ugx,CASE WHEN s.status IN('recorded','partially_paid') AND s.due_on<CURRENT_DATE THEN 'overdue' WHEN s.status IN('recorded','partially_paid') AND s.due_on<=CURRENT_DATE+7 THEN 'due_soon' ELSE s.status END payment_state,f.contact_method latest_follow_up_method,f.outcome latest_follow_up_outcome,f.note latest_follow_up_note,f.next_follow_up_on,f.created_at latest_follow_up_at,COALESCE(f.follow_up_count,0)::int follow_up_count FROM recycling_material_sales s JOIN recycling_material_lots l ON l.id=s.lot_id LEFT JOIN users recorder ON recorder.id=s.recorded_by LEFT JOIN LATERAL(SELECT SUM(amount_ugx)::bigint paid_ugx FROM recycling_sale_payments WHERE sale_id=s.id AND organization_id=s.organization_id)pay ON true LEFT JOIN LATERAL(SELECT p.contact_method,p.outcome,p.note,p.next_follow_up_on,p.created_at,COUNT(*)OVER() follow_up_count FROM recycling_payment_followups p WHERE p.sale_id=s.id AND p.organization_id=s.organization_id ORDER BY p.created_at DESC LIMIT 1)f ON true WHERE s.organization_id=$1::uuid ORDER BY s.sold_on DESC,s.created_at DESC LIMIT 100`, [org]),
        database_1.dbPool.query(`SELECT *,SUM(CASE WHEN transaction_type='given' THEN amount_ugx ELSE -amount_ugx END)OVER(ORDER BY transaction_date,created_at,id)::bigint running_balance_ugx FROM recycling_manager_float_transactions WHERE organization_id=$1::uuid ORDER BY transaction_date DESC,created_at DESC LIMIT 100`, [org]),
        database_1.dbPool.query(`SELECT b.*,i.material_type input_material_type,o.material_type output_material FROM recycling_sorting_batches b JOIN recycling_material_lots i ON i.id=b.input_lot_id JOIN recycling_material_lots o ON o.id=b.output_lot_id WHERE b.organization_id=$1::uuid ORDER BY b.processed_on DESC,b.created_at DESC`, [org]),
        database_1.dbPool.query(`SELECT * FROM recycling_trade_partners WHERE organization_id=$1::uuid ORDER BY active DESC,name`, [org]),
        database_1.dbPool.query(`SELECT a.*,l.material_type,l.source_name FROM recycling_stock_adjustments a JOIN recycling_material_lots l ON l.id=a.lot_id WHERE a.organization_id=$1::uuid ORDER BY a.adjustment_date DESC,a.created_at DESC LIMIT 100`, [org]),
        database_1.dbPool.query(`SELECT id,sale_id,amount_ugx,paid_on,reference,created_at FROM recycling_sale_payments WHERE organization_id=$1::uuid ORDER BY paid_on DESC,created_at DESC`, [org]),
        database_1.dbPool.query(`SELECT id,lot_id,amount_ugx,paid_on,reference,created_at FROM recycling_purchase_payments WHERE organization_id=$1::uuid ORDER BY paid_on DESC,created_at DESC`, [org]),
        database_1.dbPool.query(`SELECT * FROM recycling_material_catalog WHERE organization_id=$1::uuid ORDER BY active DESC,category,name`, [org]),
        database_1.dbPool.query(`SELECT c.*,u.full_name closed_by_name,r.full_name reopened_by_name FROM recycling_daily_closures c JOIN users u ON u.id=c.closed_by LEFT JOIN users r ON r.id=c.reopened_by WHERE c.organization_id=$1::uuid ORDER BY c.operating_date DESC LIMIT 31`, [org])
    ]);
    const purchasedLots = lots.rows.filter(x => x.origin === 'purchase');
    const operatingDate = String(context.rows[0]?.operating_date || '').slice(0, 10), dateValue = (value) => String(value || '').slice(0, 10);
    const purchaseCost = purchasedLots.reduce((n, x) => n + Number(x.total_cost_ugx), 0), revenue = sales.rows.reduce((n, x) => n + Number(x.total_ugx), 0), saleExpenses = sales.rows.reduce((n, x) => n + Number(x.expenses_ugx), 0), processingCost = sorting.rows.reduce((n, x) => n + Number(x.processing_cost_ugx), 0);
    const floatBalance = float.rows.reduce((n, x) => n + (x.transaction_type === 'given' ? 1 : -1) * Number(x.amount_ugx), 0);
    const sortedInputKg = sorting.rows.reduce((n, x) => n + Number(x.input_kg), 0), sortedOutputKg = sorting.rows.reduce((n, x) => n + Number(x.output_kg), 0), rejectedKg = sorting.rows.reduce((n, x) => n + Number(x.rejected_kg), 0);
    const stockAddedKg = stockAdjustments.rows.filter(x => x.adjustment_type === 'correction_in').reduce((n, x) => n + Number(x.quantity_kg), 0), stockRemovedKg = stockAdjustments.rows.filter(x => x.adjustment_type !== 'correction_in').reduce((n, x) => n + Number(x.quantity_kg), 0), lossKg = stockAdjustments.rows.filter(x => x.adjustment_type === 'loss').reduce((n, x) => n + Number(x.quantity_kg), 0);
    const today = Date.now(), daysOverdue = (date) => date ? Math.max(0, Math.floor((today - new Date(String(date).slice(0, 10) + 'T00:00:00Z').getTime()) / 86400000)) : 0;
    const age = (items, dueKey, amountKey) => items.reduce((a, x) => { const days = daysOverdue(x[dueKey]), amount = Number(x[amountKey]); if (!days)
        a.current += amount;
    else if (days <= 30)
        a.days1To30 += amount;
    else if (days <= 60)
        a.days31To60 += amount;
    else
        a.days61Plus += amount; return a; }, { current: 0, days1To30: 0, days31To60: 0, days61Plus: 0 });
    const paymentAging = { receivables: age(sales.rows.filter(x => x.status !== 'paid'), 'due_on', 'balance_ugx'), payables: age(purchasedLots.filter(x => x.purchase_payment_status !== 'paid'), 'purchase_due_on', 'balance_ugx') };
    const buyerExposure = [...sales.rows.filter(x => x.status !== 'paid').reduce((m, x) => m.set(x.buyer_name, (m.get(x.buyer_name) || 0) + Number(x.balance_ugx)), new Map())].map(([buyerName, amountUgx]) => ({ buyerName, amountUgx })).sort((a, b) => b.amountUgx - a.amountUgx);
    const upcomingFollowUps = sales.rows.filter(x => x.status !== 'paid' && x.next_follow_up_on).map(x => ({ saleId: x.id, buyerName: x.buyer_name, invoiceNumber: x.invoice_number, amountUgx: Number(x.balance_ugx), nextFollowUpOn: x.next_follow_up_on, outcome: x.latest_follow_up_outcome })).sort((a, b) => String(a.nextFollowUpOn).localeCompare(String(b.nextFollowUpOn))).slice(0, 10);
    const lotById = new Map(lots.rows.map(x => [x.id, x])), batchByOutput = new Map(sorting.rows.map(x => [x.output_lot_id, x]));
    const unitCost = (id, seen = new Set()) => { if (seen.has(id))
        return 0; seen.add(id); const lot = lotById.get(id); if (!lot)
        return 0; if (lot.origin === 'purchase')
        return Number(lot.total_cost_ugx) / Math.max(Number(lot.quantity_kg), 1); const batch = batchByOutput.get(id); return batch ? (unitCost(batch.input_lot_id, seen) * Number(batch.input_kg) + Number(batch.processing_cost_ugx)) / Math.max(Number(batch.output_kg), 1) : 0; };
    const cogs = sales.rows.reduce((n, x) => n + unitCost(x.lot_id) * Number(x.quantity_kg), 0), inventoryValue = lots.rows.reduce((n, x) => n + unitCost(x.id) * Number(x.available_kg), 0), grossProfit = revenue - cogs;
    const finance = context.rows[0] || {};
    const summary = { lots: purchasedLots.length, purchasedKg: purchasedLots.reduce((n, x) => n + Number(x.quantity_kg), 0), availableKg: lots.rows.reduce((n, x) => n + Number(x.available_kg), 0), soldKg: sales.rows.reduce((n, x) => n + Number(x.quantity_kg), 0), sortedInputKg, sortedOutputKg, rejectedKg, recoveryRate: sortedInputKg ? Math.round(sortedOutputKg / sortedInputKg * 1000) / 10 : 0, stockAddedKg, stockRemovedKg, lossKg, purchaseCostUgx: purchaseCost, inventoryValueUgx: Math.round(inventoryValue), costOfGoodsSoldUgx: Math.round(cogs), grossProfitUgx: Math.round(grossProfit), creditPurchasesUgx: purchasedLots.filter(x => x.purchase_payment_status !== 'paid').reduce((n, x) => n + Number(x.balance_ugx), 0), overduePayablesUgx: purchasedLots.filter(x => x.purchase_payment_state === 'overdue').reduce((n, x) => n + Number(x.balance_ugx), 0), dueSoonPayablesUgx: purchasedLots.filter(x => x.purchase_payment_state === 'due_soon').reduce((n, x) => n + Number(x.balance_ugx), 0), revenueUgx: revenue, unpaidSalesUgx: sales.rows.filter(x => x.status !== 'paid').reduce((n, x) => n + Number(x.balance_ugx), 0), overdueReceivablesUgx: sales.rows.filter(x => x.payment_state === 'overdue').reduce((n, x) => n + Number(x.balance_ugx), 0), dueSoonReceivablesUgx: sales.rows.filter(x => x.payment_state === 'due_soon').reduce((n, x) => n + Number(x.balance_ugx), 0), saleExpensesUgx: saleExpenses, processingCostUgx: processingCost, profitLossUgx: Math.round(grossProfit - saleExpenses), floatBalanceUgx: floatBalance, openingBalanceUgx: Number(finance.opening_balance_ugx || 0), openingBalanceConfigured: Boolean(finance.opening_balance_configured), cashPositionUgx: Number(finance.cash_position_ugx || 0), committedFundsUgx: Number(finance.committed_funds_ugx || 0), availableToCommitUgx: Number(finance.available_to_commit_ugx || 0) };
    const materialMap = new Map();
    const material = (name) => { const key = name.trim().toLowerCase(); if (!materialMap.has(key))
        materialMap.set(key, { materialType: name, purchasedKg: 0, sortedKg: 0, availableKg: 0, soldKg: 0, revenueUgx: 0 }); return materialMap.get(key); };
    lots.rows.forEach(x => { const item = material(x.material_type); item.availableKg += Number(x.available_kg); if (x.origin === 'purchase')
        item.purchasedKg += Number(x.quantity_kg);
    else
        item.sortedKg += Number(x.quantity_kg); });
    sales.rows.forEach(x => { const item = material(x.material_type); item.soldKg += Number(x.quantity_kg); item.revenueUgx += Number(x.total_ugx); });
    const expenseBreakdown = { materialPurchasesUgx: purchasedLots.reduce((n, x) => n + Number(x.material_cost_ugx), 0), purchaseWagesUgx: purchasedLots.reduce((n, x) => n + Number(x.worker_wages_ugx), 0), purchaseFoodUgx: purchasedLots.reduce((n, x) => n + Number(x.food_ugx), 0), purchaseTransportUgx: purchasedLots.reduce((n, x) => n + Number(x.transport_ugx), 0), driverFeesUgx: purchasedLots.reduce((n, x) => n + Number(x.driver_fee_ugx), 0), purchaseOtherUgx: purchasedLots.reduce((n, x) => n + Number(x.other_expense_ugx), 0), processingUgx: processingCost, saleWagesUgx: sales.rows.reduce((n, x) => n + Number(x.worker_wages_ugx), 0), saleFoodUgx: sales.rows.reduce((n, x) => n + Number(x.food_ugx), 0), saleTransportUgx: sales.rows.reduce((n, x) => n + Number(x.transport_ugx), 0), saleOtherUgx: sales.rows.reduce((n, x) => n + Number(x.other_expense_ugx), 0) };
    const currentClosure = dailyClosures.rows.find(x => dateValue(x.operating_date) === operatingDate);
    const operations = { operatingDate, isClosed: currentClosure?.status === 'closed', currentClosure: currentClosure ?? null, receivedTodayKg: purchasedLots.filter(x => dateValue(x.collected_on) === operatingDate).reduce((n, x) => n + Number(x.quantity_kg), 0), sortedTodayKg: sorting.rows.filter(x => dateValue(x.processed_on) === operatingDate).reduce((n, x) => n + Number(x.output_kg), 0), soldTodayKg: sales.rows.filter(x => dateValue(x.sold_on) === operatingDate).reduce((n, x) => n + Number(x.quantity_kg), 0), stockLotsReady: lots.rows.filter(x => Number(x.available_kg) > 0).length, awaitingSortingKg: purchasedLots.reduce((n, x) => n + Number(x.available_kg), 0), saleableStockKg: lots.rows.filter(x => x.origin === 'sorting_output').reduce((n, x) => n + Number(x.available_kg), 0), workQueue: purchasedLots.filter(x => Number(x.available_kg) > 0).sort((a, b) => dateValue(a.collected_on).localeCompare(dateValue(b.collected_on))).slice(0, 8).map(x => ({ lotId: x.id, materialType: x.material_type, sourceName: x.source_name, receivedOn: x.collected_on, availableKg: Number(x.available_kg), quality: x.quality })) };
    return { organization: context.rows[0], summary, operations, dailyClosures: dailyClosures.rows, lots: lots.rows, sales: sales.rows, floatTransactions: float.rows, sortingBatches: sorting.rows, partners: partners.rows, stockAdjustments: stockAdjustments.rows, salePayments: salePayments.rows, purchasePayments: purchasePayments.rows, materials: materials.rows, materialPerformance: [...materialMap.values()].sort((a, b) => b.revenueUgx - a.revenueUgx || b.availableKg - a.availableKg), expenseBreakdown, paymentAging, buyerExposure, upcomingFollowUps };
}
async function ensureMaterial(c, org, user, name, allowNew) { const existing = await c.query(`SELECT name FROM recycling_material_catalog WHERE organization_id=$1::uuid AND lower(name)=lower($2) AND active=true`, [org, name]); if (existing.rowCount)
    return existing.rows[0].name; if (!allowNew)
    throw Object.assign(new Error('Choose a material from the list or select Other and enter its name'), { statusCode: 400 }); return (await c.query(`INSERT INTO recycling_material_catalog(organization_id,name,category,created_by)VALUES($1,$2,'other',$3) ON CONFLICT(organization_id,lower(name)) DO UPDATE SET active=true,updated_at=now() RETURNING name`, [org, name, user])).rows[0].name; }
async function createLot(org, user, d) { const c = await database_1.dbPool.connect(); try {
    await c.query('BEGIN');
    if (!(await c.query(`SELECT 1 FROM organizations WHERE id=$1::uuid AND type='recycling_company'`, [org])).rowCount)
        throw Object.assign(new Error('This workspace is not registered as a recycling company'), { statusCode: 403 });
    d.materialType = await ensureMaterial(c, org, user, d.materialType, d.allowNewMaterial);
    if (d.supplierPartnerId && !(await c.query(`SELECT 1 FROM recycling_trade_partners WHERE id=$1::uuid AND organization_id=$2::uuid AND active=true AND partner_type IN('supplier','both')`, [d.supplierPartnerId, org])).rowCount)
        throw Object.assign(new Error('Choose an active supplier belonging to this organization'), { statusCode: 400 });
    const lot = (await c.query(`INSERT INTO recycling_material_lots(organization_id,material_type,supplier_partner_id,source_name,quantity_kg,available_kg,unit_purchase_price_ugx,collected_on,quality,purchase_payment_status,purchase_payment_reference,purchase_paid_on,worker_wages_ugx,food_ugx,transport_ugx,driver_fee_ugx,other_expense_ugx,manager_float_used_ugx,notes,created_by)VALUES($1,$2,$3,$4,$5,$5,$6,$7,$8,$9,$10,CASE WHEN $9='paid' THEN $7::date ELSE NULL END,$11,$12,$13,$14,$15,$16,$17,$18)RETURNING *`, [org, d.materialType, d.supplierPartnerId ?? null, d.sourceName, d.quantityKg, d.unitPurchasePriceUgx, d.collectedOn, d.quality, d.purchasePaymentStatus, d.purchasePaymentReference ?? null, d.workerWagesUgx, d.foodUgx, d.transportUgx, d.driverFeeUgx, d.otherExpenseUgx, d.managerFloatUsedUgx, d.notes ?? null, user])).rows[0];
    const total = Math.round(d.quantityKg * d.unitPurchasePriceUgx + d.workerWagesUgx + d.foodUgx + d.transportUgx + d.driverFeeUgx + d.otherExpenseUgx);
    if (d.purchasePaymentStatus === 'paid')
        await c.query(`INSERT INTO recycling_purchase_payments(organization_id,lot_id,amount_ugx,paid_on,reference,recorded_by)VALUES($1,$2,$3,$4,$5,$6)`, [org, lot.id, total, d.collectedOn, d.purchasePaymentReference || `PURCHASE-${lot.id}`, user]);
    if (d.managerFloatUsedUgx > 0)
        await c.query(`INSERT INTO recycling_manager_float_transactions(organization_id,transaction_date,transaction_type,amount_ugx,notes,purchase_lot_id,recorded_by)VALUES($1,$2,'spent',$3,$4,$5,$6)`, [org, d.collectedOn, d.managerFloatUsedUgx, `Purchase: ${d.materialType} from ${d.sourceName}`, lot.id, user]);
    await c.query('COMMIT');
    return lot;
}
catch (e) {
    await c.query('ROLLBACK');
    throw e;
}
finally {
    c.release();
} }
async function createSale(org, user, d) { const c = await database_1.dbPool.connect(); try {
    await c.query('BEGIN');
    const lot = (await c.query(`SELECT * FROM recycling_material_lots WHERE id=$1::uuid AND organization_id=$2::uuid FOR UPDATE`, [d.lotId, org])).rows[0];
    if (!lot || Number(lot.available_kg) < d.quantityKg) {
        await c.query('ROLLBACK');
        return null;
    }
    let buyerName = d.buyerName;
    if (d.buyerPartnerId) {
        const partner = (await c.query(`SELECT name FROM recycling_trade_partners WHERE id=$1::uuid AND organization_id=$2::uuid AND active=true AND partner_type IN('buyer','both')`, [d.buyerPartnerId, org])).rows[0];
        if (!partner)
            throw Object.assign(new Error('Choose an active buyer belonging to this organization'), { statusCode: 400 });
        buyerName = partner.name;
    }
    const sale = (await c.query(`INSERT INTO recycling_material_sales(organization_id,lot_id,buyer_partner_id,buyer_name,sale_channel,industry,invoice_number,quantity_kg,unit_price_ugx,sold_on,worker_wages_ugx,food_ugx,transport_ugx,other_expense_ugx,notes,recorded_by)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)RETURNING *`, [org, d.lotId, d.buyerPartnerId ?? null, buyerName, d.saleChannel, d.industry, d.invoiceNumber ?? null, d.quantityKg, d.unitPriceUgx, d.soldOn, d.workerWagesUgx, d.foodUgx, d.transportUgx, d.otherExpenseUgx, d.notes ?? null, user])).rows[0];
    const available = Number(lot.available_kg) - d.quantityKg;
    await c.query(`UPDATE recycling_material_lots SET available_kg=$2::numeric,status=CASE WHEN $2::numeric=0::numeric THEN 'sold' ELSE 'partially_sold' END,updated_at=now() WHERE id=$1::uuid`, [d.lotId, available]);
    await c.query('COMMIT');
    return sale;
}
catch (e) {
    await c.query('ROLLBACK');
    throw e;
}
finally {
    c.release();
} }
async function createFloatTransaction(org, user, d) { if (!(await database_1.dbPool.query(`SELECT 1 FROM organizations WHERE id=$1::uuid AND type='recycling_company'`, [org])).rowCount)
    throw Object.assign(new Error('This workspace is not registered as a recycling company'), { statusCode: 403 }); return (await database_1.dbPool.query(`INSERT INTO recycling_manager_float_transactions(organization_id,transaction_date,transaction_type,amount_ugx,notes,recorded_by)VALUES($1,$2,$3,$4,$5,$6)RETURNING *`, [org, d.transactionDate, d.transactionType, d.amountUgx, d.notes ?? null, user])).rows[0]; }
async function createSortingBatch(org, user, d) { const c = await database_1.dbPool.connect(); try {
    await c.query('BEGIN');
    d.outputMaterialType = await ensureMaterial(c, org, user, d.outputMaterialType, d.allowNewMaterial);
    const input = (await c.query(`SELECT * FROM recycling_material_lots WHERE id=$1::uuid AND organization_id=$2::uuid FOR UPDATE`, [d.inputLotId, org])).rows[0];
    if (!input || Number(input.available_kg) < d.inputKg) {
        await c.query('ROLLBACK');
        return null;
    }
    const output = (await c.query(`INSERT INTO recycling_material_lots(organization_id,material_type,source_name,quantity_kg,available_kg,unit_purchase_price_ugx,collected_on,quality,notes,created_by,origin,source_lot_id)VALUES($1,$2,$3,$4,$4,0,$5,'sorted',$6,$7,'sorting_output',$8)RETURNING *`, [org, d.outputMaterialType, `Sorted from ${input.material_type}`, d.outputKg, d.processedOn, d.notes ?? null, user, input.id])).rows[0];
    const batch = (await c.query(`INSERT INTO recycling_sorting_batches(organization_id,input_lot_id,output_lot_id,processed_on,input_kg,output_material_type,output_kg,rejected_kg,processing_cost_ugx,notes,recorded_by)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)RETURNING *`, [org, input.id, output.id, d.processedOn, d.inputKg, d.outputMaterialType, d.outputKg, d.rejectedKg, d.processingCostUgx, d.notes ?? null, user])).rows[0];
    const available = Number(input.available_kg) - d.inputKg;
    await c.query(`UPDATE recycling_material_lots SET available_kg=$2::numeric,status=CASE WHEN $2::numeric=0::numeric THEN 'sold' ELSE 'partially_sold' END,updated_at=now() WHERE id=$1::uuid`, [input.id, available]);
    await c.query('COMMIT');
    return { ...batch, input_material_type: input.material_type, output_material: output.material_type };
}
catch (e) {
    await c.query('ROLLBACK');
    throw e;
}
finally {
    c.release();
} }
async function createStockAdjustment(org, user, d) { const c = await database_1.dbPool.connect(); try {
    await c.query('BEGIN');
    const lot = (await c.query(`SELECT * FROM recycling_material_lots WHERE id=$1::uuid AND organization_id=$2::uuid FOR UPDATE`, [d.lotId, org])).rows[0];
    if (!lot) {
        await c.query('ROLLBACK');
        return null;
    }
    const current = Number(lot.available_kg), outbound = d.adjustmentType !== 'correction_in';
    if (outbound && current < d.quantityKg) {
        await c.query('ROLLBACK');
        return null;
    }
    const available = current + (outbound ? -d.quantityKg : d.quantityKg);
    await c.query(`UPDATE recycling_material_lots SET available_kg=$2::numeric,status=CASE WHEN $2::numeric=0::numeric THEN 'rejected' WHEN $2::numeric<quantity_kg THEN 'partially_sold' ELSE 'available' END,updated_at=now() WHERE id=$1::uuid`, [lot.id, available]);
    const adjustment = (await c.query(`INSERT INTO recycling_stock_adjustments(organization_id,lot_id,adjustment_date,adjustment_type,quantity_kg,reason,notes,recorded_by)VALUES($1,$2,$3,$4,$5,$6,$7,$8)RETURNING *`, [org, lot.id, d.adjustmentDate, d.adjustmentType, d.quantityKg, d.reason, d.notes ?? null, user])).rows[0];
    await c.query('COMMIT');
    return { ...adjustment, material_type: lot.material_type, source_name: lot.source_name, available_kg: available };
}
catch (e) {
    await c.query('ROLLBACK');
    throw e;
}
finally {
    c.release();
} }
async function createPartner(org, user, d) { if (!(await database_1.dbPool.query(`SELECT 1 FROM organizations WHERE id=$1::uuid AND type='recycling_company'`, [org])).rowCount)
    throw Object.assign(new Error('This workspace is not registered as a recycling company'), { statusCode: 403 }); return (await database_1.dbPool.query(`INSERT INTO recycling_trade_partners(organization_id,partner_type,name,contact_person,phone,email,address,tax_number,created_by)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)RETURNING *`, [org, d.partnerType, d.name, d.contactPerson ?? null, d.phone ?? null, d.email ?? null, d.address ?? null, d.taxNumber ?? null, user])).rows[0]; }
async function setLotCollectionLocation(org, id, d) { return (await database_1.dbPool.query(`UPDATE recycling_material_lots SET collection_latitude=$3,collection_longitude=$4,collection_accuracy_m=$5,updated_at=now() WHERE id=$1::uuid AND organization_id=$2::uuid RETURNING id`, [id, org, d.collectionLatitude, d.collectionLongitude, d.collectionAccuracyM ?? null])).rows[0] ?? null; }
async function setPartnerState(org, id, active) { return (await database_1.dbPool.query(`UPDATE recycling_trade_partners SET active=$3,updated_at=now() WHERE id=$1::uuid AND organization_id=$2::uuid RETURNING *`, [id, org, active])).rows[0] ?? null; }
async function createMaterial(org, user, d) { return (await database_1.dbPool.query(`INSERT INTO recycling_material_catalog(organization_id,name,category,created_by)VALUES($1,$2,$3,$4)RETURNING *`, [org, d.name, d.category, user])).rows[0]; }
async function setMaterialState(org, id, active) { return (await database_1.dbPool.query(`UPDATE recycling_material_catalog SET active=$3,updated_at=now() WHERE id=$1::uuid AND organization_id=$2::uuid RETURNING *`, [id, org, active])).rows[0] ?? null; }
async function markPurchasePaid(org, user, id, d) { const c = await database_1.dbPool.connect(); try {
    await c.query('BEGIN');
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`recycling-purchase:${id}`]);
    const lot = (await c.query(`SELECT l.*,(ROUND(l.quantity_kg*l.unit_purchase_price_ugx)+l.worker_wages_ugx+l.food_ugx+l.transport_ugx+l.driver_fee_ugx+l.other_expense_ugx-COALESCE((SELECT SUM(amount_ugx) FROM recycling_purchase_payments WHERE lot_id=l.id),0))::bigint balance FROM recycling_material_lots l WHERE l.id=$1::uuid AND l.organization_id=$2::uuid AND l.origin='purchase' AND l.purchase_payment_status IN('credit','partially_paid') FOR UPDATE`, [id, org])).rows[0];
    if (!lot || d.amountUgx > Number(lot.balance) || d.paymentReceivedOn < lot.collected_on) {
        await c.query('ROLLBACK');
        return null;
    }
    await c.query(`INSERT INTO recycling_purchase_payments(organization_id,lot_id,amount_ugx,paid_on,reference,recorded_by)VALUES($1,$2,$3,$4,$5,$6)`, [org, id, d.amountUgx, d.paymentReceivedOn, d.paymentReference, user]);
    const status = d.amountUgx === Number(lot.balance) ? 'paid' : 'partially_paid';
    const result = (await c.query(`UPDATE recycling_material_lots SET purchase_payment_status=$3,purchase_paid_on=CASE WHEN $3='paid' THEN $4::date ELSE purchase_paid_on END,purchase_payment_reference=$5,updated_at=now() WHERE id=$1::uuid AND organization_id=$2::uuid RETURNING *`, [id, org, status, d.paymentReceivedOn, d.paymentReference])).rows[0];
    await c.query('COMMIT');
    return result;
}
catch (e) {
    await c.query('ROLLBACK');
    throw e;
}
finally {
    c.release();
} }
async function markSalePaid(org, user, id, d) { const c = await database_1.dbPool.connect(); try {
    await c.query('BEGIN');
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`recycling-sale:${id}`]);
    const sale = (await c.query(`SELECT s.*,(ROUND(s.quantity_kg*s.unit_price_ugx)-COALESCE((SELECT SUM(amount_ugx) FROM recycling_sale_payments WHERE sale_id=s.id),0))::bigint balance FROM recycling_material_sales s WHERE s.id=$1::uuid AND s.organization_id=$2::uuid AND s.status IN('recorded','partially_paid') FOR UPDATE`, [id, org])).rows[0];
    if (!sale || d.amountUgx > Number(sale.balance) || d.paymentReceivedOn < sale.sold_on) {
        await c.query('ROLLBACK');
        return null;
    }
    await c.query(`INSERT INTO recycling_sale_payments(organization_id,sale_id,amount_ugx,paid_on,reference,recorded_by)VALUES($1,$2,$3,$4,$5,$6)`, [org, id, d.amountUgx, d.paymentReceivedOn, d.paymentReference, user]);
    const status = d.amountUgx === Number(sale.balance) ? 'paid' : 'partially_paid';
    const result = (await c.query(`UPDATE recycling_material_sales SET status=$3,paid_on=CASE WHEN $3='paid' THEN $4::date ELSE paid_on END,payment_reference=$5 WHERE id=$1::uuid AND organization_id=$2::uuid RETURNING *`, [id, org, status, d.paymentReceivedOn, d.paymentReference])).rows[0];
    await c.query('COMMIT');
    return result;
}
catch (e) {
    await c.query('ROLLBACK');
    throw e;
}
finally {
    c.release();
} }
async function setPurchaseDueDate(org, id, dueOn) { return (await database_1.dbPool.query(`UPDATE recycling_material_lots SET purchase_due_on=$3::date,updated_at=now() WHERE id=$1::uuid AND organization_id=$2::uuid AND origin='purchase' AND purchase_payment_status IN('credit','partially_paid') AND $3::date>=collected_on RETURNING *`, [id, org, dueOn])).rows[0] ?? null; }
async function setSaleDueDate(org, id, dueOn) { return (await database_1.dbPool.query(`UPDATE recycling_material_sales SET due_on=$3::date WHERE id=$1::uuid AND organization_id=$2::uuid AND status IN('recorded','partially_paid') AND $3::date>=sold_on RETURNING *`, [id, org, dueOn])).rows[0] ?? null; }
async function createPaymentFollowUp(org, user, id, d) { return (await database_1.dbPool.query(`INSERT INTO recycling_payment_followups(organization_id,sale_id,contact_method,outcome,note,next_follow_up_on,recorded_by) SELECT $2::uuid,s.id,$3,$4,$5,$6::date,$7::uuid FROM recycling_material_sales s WHERE s.id=$1::uuid AND s.organization_id=$2::uuid AND s.status IN('recorded','partially_paid') RETURNING *`, [id, org, d.contactMethod, d.outcome, d.note, d.nextFollowUpOn ?? null, user])).rows[0] ?? null; }
async function closeRecyclingDay(org, user, d) {
    const c = await database_1.dbPool.connect();
    try {
        await c.query('BEGIN');
        await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`recycling-close:${org}:${d.operatingDate}`]);
        const context = (await c.query(`SELECT type,CURRENT_DATE::text today FROM organizations WHERE id=$1::uuid`, [org])).rows[0];
        if (!context || context.type !== 'recycling_company')
            throw Object.assign(new Error('This workspace is not registered as a recycling company'), { statusCode: 403 });
        if (d.operatingDate > String(context.today).slice(0, 10))
            throw Object.assign(new Error('A future business day cannot be closed'), { statusCode: 400 });
        if ((await c.query(`SELECT 1 FROM recycling_daily_closures WHERE organization_id=$1::uuid AND operating_date=$2::date AND status='closed'`, [org, d.operatingDate])).rowCount)
            throw financeError(`Business day ${d.operatingDate} is already closed`);
        const snapshot = (await c.query(`SELECT jsonb_build_object(
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
   'floatGivenUgx',COALESCE((SELECT SUM(amount_ugx) FROM recycling_manager_float_transactions WHERE organization_id=$1::uuid AND transaction_date=$2::date AND transaction_type='given'),0),
   'floatSpentUgx',COALESCE((SELECT SUM(amount_ugx) FROM recycling_manager_float_transactions WHERE organization_id=$1::uuid AND transaction_date=$2::date AND transaction_type='spent'),0),
   'stockOnHandKg',COALESCE((SELECT SUM(available_kg) FROM recycling_material_lots WHERE organization_id=$1::uuid),0)
  ) snapshot`, [org, d.operatingDate])).rows[0].snapshot;
        const result = (await c.query(`INSERT INTO recycling_daily_closures(organization_id,operating_date,status,snapshot,notes,closed_by) VALUES($1,$2,'closed',$3::jsonb,$4,$5) ON CONFLICT(organization_id,operating_date) DO UPDATE SET status='closed',snapshot=EXCLUDED.snapshot,notes=EXCLUDED.notes,closed_by=EXCLUDED.closed_by,closed_at=now(),reopened_by=NULL,reopened_at=NULL,reopen_reason=NULL,updated_at=now() RETURNING *`, [org, d.operatingDate, JSON.stringify(snapshot), d.notes ?? null, user])).rows[0];
        await c.query('COMMIT');
        return result;
    }
    catch (e) {
        await c.query('ROLLBACK');
        throw e;
    }
    finally {
        c.release();
    }
}
async function reopenRecyclingDay(org, user, id, reason) { return (await database_1.dbPool.query(`UPDATE recycling_daily_closures SET status='reopened',reopened_by=$3::uuid,reopened_at=now(),reopen_reason=$4,updated_at=now() WHERE id=$1::uuid AND organization_id=$2::uuid AND status='closed' RETURNING *`, [id, org, user, reason])).rows[0] ?? null; }
async function assertPurchaseFunding(org, d) {
    const total = d.quantityKg * d.unitPurchasePriceUgx + d.workerWagesUgx + d.foodUgx + d.transportUgx + d.driverFeeUgx + d.otherExpenseUgx;
    const state = (await database_1.dbPool.query(`SELECT organization_cash_position($1::uuid)::bigint cash,organization_available_to_commit($1::uuid)::bigint available,COALESCE((SELECT SUM(CASE WHEN transaction_type='given' THEN amount_ugx ELSE -amount_ugx END) FROM recycling_manager_float_transactions WHERE organization_id=$1::uuid),0)::bigint float_balance`, [org])).rows[0];
    if (d.purchasePaymentStatus === 'paid' && total > Number(state.cash)) {
        const cash = Number(state.cash);
        throw financeError(cash < 0 ? `Purchase cannot be paid. Available cash is UGX 0 and the account has an existing deficit of UGX ${Math.abs(cash).toLocaleString()}. Ask the company administrator to correct or fund the account.` : `Purchase cannot be paid. UGX ${total.toLocaleString()} is required but only UGX ${cash.toLocaleString()} is available.`);
    }
    if (d.purchasePaymentStatus === 'credit' && total > Number(state.available)) {
        const available = Number(state.available);
        throw financeError(available < 0 ? `Credit purchase cannot be committed. Available funds are UGX 0 and existing commitments exceed cash by UGX ${Math.abs(available).toLocaleString()}.` : `Credit purchase cannot be committed. Only UGX ${available.toLocaleString()} is available.`);
    }
    if (d.purchasePaymentStatus === 'credit' && d.managerFloatUsedUgx > 0)
        throw financeError('A credit purchase cannot use manager float before it is paid.');
    if (d.managerFloatUsedUgx > Number(state.float_balance))
        throw financeError(`Manager float is insufficient. Available float is ${Number(state.float_balance).toLocaleString()} UGX.`);
}
async function assertCashFunding(org, amount, label) {
    if (amount <= 0)
        return;
    const cash = Number((await database_1.dbPool.query(`SELECT organization_cash_position($1::uuid)::bigint cash`, [org])).rows[0].cash);
    if (amount > cash)
        throw financeError(`${label} cannot be paid: ${amount.toLocaleString()} UGX is required but only ${cash.toLocaleString()} UGX cash is available.`);
}
async function assertFloatFunding(org, d) {
    const state = (await database_1.dbPool.query(`SELECT organization_cash_position($1::uuid)::bigint cash,COALESCE((SELECT SUM(CASE WHEN transaction_type='given' THEN amount_ugx ELSE -amount_ugx END) FROM recycling_manager_float_transactions WHERE organization_id=$1::uuid),0)::bigint float_balance`, [org])).rows[0], cash = Number(state.cash), balance = Number(state.float_balance);
    if (d.transactionType === 'given' && balance + d.amountUgx > cash)
        throw financeError(`Float allocation exceeds available cash. Cash is ${cash.toLocaleString()} UGX and ${balance.toLocaleString()} UGX is already allocated.`);
    if (d.transactionType === 'spent' && (d.amountUgx > balance || d.amountUgx > cash))
        throw financeError(`Float spending is unavailable. Float balance is ${balance.toLocaleString()} UGX and cash balance is ${cash.toLocaleString()} UGX.`);
}
async function assertCreditPurchasePaymentFunding(org, amount) {
    await assertCashFunding(org, amount, 'Supplier payment');
}
