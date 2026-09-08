"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.findExpenses = findExpenses;
exports.createExpense = createExpense;
exports.updateExpenseStatus = updateExpenseStatus;
exports.findFinancialPosition = findFinancialPosition;
exports.setOpeningBalance = setOpeningBalance;
const database_1 = require("../config/database");
async function findExpenses(organizationId) {
    const rows = await database_1.dbPool.query(`SELECT e.*,u.full_name AS created_by_name,a.full_name AS approved_by_name FROM organization_expenses e LEFT JOIN users u ON u.id=e.created_by LEFT JOIN users a ON a.id=e.approved_by WHERE ($1::uuid IS NULL OR e.organization_id=$1::uuid) ORDER BY e.expense_date DESC,e.created_at DESC`, [organizationId]);
    const summary = await database_1.dbPool.query(`SELECT COALESCE(SUM(amount_ugx) FILTER(WHERE status='paid' AND expense_date>=date_trunc('month',CURRENT_DATE)),0)::bigint paid_this_month,COALESCE(SUM(amount_ugx) FILTER(WHERE status='approved'),0)::bigint awaiting_payment,COUNT(*) FILTER(WHERE status='draft')::int awaiting_approval FROM organization_expenses WHERE ($1::uuid IS NULL OR organization_id=$1::uuid)`, [organizationId]);
    return { summary: summary.rows[0], expenses: rows.rows };
}
async function createExpense(organizationId, userId, data) { const number = `EXP-${Date.now()}`; const r = await database_1.dbPool.query(`INSERT INTO organization_expenses(organization_id,expense_number,category,description,vendor,amount_ugx,expense_date,reference,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [organizationId, number, data.category, data.description, data.vendor ?? null, data.amountUgx, data.expenseDate, data.reference ?? null, userId]); return r.rows[0]; }
async function updateExpenseStatus(id, organizationId, userId, status) { const client = await database_1.dbPool.connect(); try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`finance:${organizationId}`]);
    const r = await client.query(`UPDATE organization_expenses SET status=$4,approved_by=CASE WHEN $4='approved' THEN $3::uuid ELSE approved_by END,approved_at=CASE WHEN $4='approved' THEN CURRENT_TIMESTAMP ELSE approved_at END,paid_at=CASE WHEN $4='paid' THEN CURRENT_TIMESTAMP ELSE paid_at END,updated_at=CURRENT_TIMESTAMP WHERE id=$1::uuid AND organization_id=$2::uuid AND (($4='approved' AND status='draft' AND amount_ugx<=organization_available_to_commit($2::uuid)) OR ($4='paid' AND status='approved' AND amount_ugx<=organization_cash_position($2::uuid)) OR ($4='void' AND status<>'paid')) RETURNING *`, [id, organizationId, userId, status]);
    await client.query('COMMIT');
    return r.rows[0] ?? null;
}
catch (e) {
    await client.query('ROLLBACK');
    throw e;
}
finally {
    client.release();
} }
async function findFinancialPosition(organizationId) {
    const r = await database_1.dbPool.query(`WITH settings AS (SELECT COALESCE((SELECT opening_balance_ugx FROM organization_finance_settings WHERE organization_id=$1::uuid),0)::bigint opening_balance_ugx,COALESCE((SELECT as_of_date FROM organization_finance_settings WHERE organization_id=$1::uuid),CURRENT_DATE)::date as_of_date), totals AS (SELECT s.*,
 COALESCE((SELECT SUM(amount_ugx) FROM customer_payments WHERE organization_id=$1::uuid AND status='successful' AND COALESCE(confirmed_at,created_at)::date>=s.as_of_date),0)::bigint customer_receipts_ugx,
 COALESCE((SELECT SUM(amount_ugx) FROM organization_expenses WHERE organization_id=$1::uuid AND status='paid' AND COALESCE(paid_at::date,expense_date)>=s.as_of_date),0)::bigint operating_payments_ugx,
 COALESCE((SELECT SUM(amount_ugx) FROM supplier_payments WHERE organization_id=$1::uuid AND paid_on>=s.as_of_date),0)::bigint supplier_payments_ugx,
 COALESCE((SELECT SUM(balance_ugx) FROM customer_invoices WHERE organization_id=$1::uuid AND status<>'cancelled'),0)::bigint receivables_ugx,
 COALESCE((SELECT SUM(balance_ugx) FROM supplier_bills WHERE organization_id=$1::uuid AND status<>'void'),0)::bigint payables_ugx FROM settings s)
 SELECT *, organization_cash_position($1::uuid)::bigint cash_position_ugx,organization_committed_funds($1::uuid)::bigint committed_funds_ugx,organization_available_to_commit($1::uuid)::bigint available_to_commit_ugx FROM totals`, [organizationId]);
    return r.rows[0];
}
async function setOpeningBalance(organizationId, userId, input) { const r = await database_1.dbPool.query(`INSERT INTO organization_finance_settings(organization_id,opening_balance_ugx,as_of_date,updated_by) VALUES($1,$2,$3,$4) ON CONFLICT(organization_id) DO UPDATE SET opening_balance_ugx=EXCLUDED.opening_balance_ugx,as_of_date=EXCLUDED.as_of_date,updated_by=EXCLUDED.updated_by,updated_at=CURRENT_TIMESTAMP RETURNING *`, [organizationId, input.openingBalanceUgx, input.asOfDate, userId]); return r.rows[0]; }
