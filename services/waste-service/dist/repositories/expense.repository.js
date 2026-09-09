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
    const summary = await database_1.dbPool.query(`SELECT COALESCE(SUM(amount_ugx) FILTER(WHERE status='paid' AND COALESCE(paid_at::date,expense_date)>=date_trunc('month',CURRENT_DATE)),0)::bigint paid_this_month,COALESCE(SUM(amount_ugx) FILTER(WHERE status='approved'),0)::bigint awaiting_payment,COUNT(*) FILTER(WHERE status='draft')::int awaiting_approval FROM organization_expenses WHERE ($1::uuid IS NULL OR organization_id=$1::uuid)`, [organizationId]);
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
    const r = await database_1.dbPool.query(`WITH settings AS (SELECT COALESCE((SELECT opening_balance_ugx FROM organization_finance_settings WHERE organization_id=$1::uuid),0)::bigint opening_balance_ugx,COALESCE((SELECT as_of_date FROM organization_finance_settings WHERE organization_id=$1::uuid),DATE '1970-01-01')::date as_of_date,EXISTS(SELECT 1 FROM organization_finance_settings WHERE organization_id=$1::uuid) AS opening_balance_configured), totals AS (SELECT s.*,
 COALESCE((SELECT SUM(amount_ugx) FROM customer_payments WHERE organization_id=$1::uuid AND status='successful' AND COALESCE(confirmed_at,created_at)::date>=s.as_of_date),0)::bigint customer_receipts_ugx,
 COALESCE((SELECT SUM(amount_ugx) FROM organization_expenses WHERE organization_id=$1::uuid AND status='paid' AND COALESCE(paid_at::date,expense_date)>=s.as_of_date),0)::bigint operating_payments_ugx,
 COALESCE((SELECT SUM(amount_ugx) FROM supplier_payments WHERE organization_id=$1::uuid AND paid_on>=s.as_of_date),0)::bigint supplier_payments_ugx,
 COALESCE((SELECT SUM(balance_ugx) FROM customer_invoices WHERE organization_id=$1::uuid AND status<>'cancelled'),0)::bigint receivables_ugx,
 COALESCE((SELECT SUM(balance_ugx) FROM supplier_bills WHERE organization_id=$1::uuid AND status<>'void'),0)::bigint payables_ugx FROM settings s)
 SELECT *, (opening_balance_configured AND (
 EXISTS(SELECT 1 FROM customer_payments WHERE organization_id=$1::uuid AND status='successful')
 OR EXISTS(SELECT 1 FROM organization_expenses WHERE organization_id=$1::uuid AND status='paid')
 OR EXISTS(SELECT 1 FROM supplier_payments WHERE organization_id=$1::uuid))) AS opening_balance_locked,
 COALESCE((SELECT jsonb_agg(h ORDER BY h.changed_at DESC) FROM
   (SELECT opening_balance_ugx,as_of_date,previous_balance_ugx,previous_as_of_date,action,changed_at FROM organization_finance_setting_history WHERE organization_id=$1::uuid ORDER BY changed_at DESC LIMIT 20) h),'[]'::jsonb) AS opening_balance_history,
 organization_cash_position($1::uuid)::bigint cash_position_ugx,organization_committed_funds($1::uuid)::bigint committed_funds_ugx,organization_available_to_commit($1::uuid)::bigint available_to_commit_ugx FROM totals`, [organizationId]);
    return r.rows[0];
}
async function setOpeningBalance(organizationId, userId, input) {
    const client = await database_1.dbPool.connect();
    const conflict = (message) => Object.assign(new Error(message), { statusCode: 409 });
    try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`finance:${organizationId}`]);
        const dates = await client.query(`SELECT CURRENT_DATE::text today,
    MIN(d)::text first_cash_date FROM (
      SELECT COALESCE(confirmed_at,created_at)::date d FROM customer_payments WHERE organization_id=$1::uuid AND status='successful'
      UNION ALL SELECT COALESCE(paid_at::date,expense_date) FROM organization_expenses WHERE organization_id=$1::uuid AND status='paid'
      UNION ALL SELECT paid_on FROM supplier_payments WHERE organization_id=$1::uuid
    ) cash_dates`, [organizationId]);
        const existing = await client.query('SELECT *,as_of_date::text opening_date FROM organization_finance_settings WHERE organization_id=$1::uuid FOR UPDATE', [organizationId]);
        const previous = existing.rows[0], { today, first_cash_date } = dates.rows[0];
        if (input.asOfDate < '1970-01-01' || input.asOfDate > today)
            throw conflict('Choose an opening date from 1 January 1970 through today.');
        if (!Number.isSafeInteger(input.openingBalanceUgx) || input.openingBalanceUgx < 0)
            throw conflict('Enter a valid non-negative opening balance.');
        // An unchanged save is harmless and must not add duplicate history.
        if (previous && previous.opening_date === input.asOfDate && BigInt(previous.opening_balance_ugx) === BigInt(input.openingBalanceUgx)) {
            await client.query('COMMIT');
            return previous;
        }
        if (previous && first_cash_date)
            throw conflict('Opening balance is locked because receipts or payments have been recorded. Use a reviewed accounting adjustment, not a replacement opening balance.');
        if (first_cash_date && input.asOfDate > first_cash_date)
            throw conflict('The opening date cannot exclude existing receipts or payments. Choose a date on or before ' + first_cash_date + '.');
        const result = await client.query(`INSERT INTO organization_finance_settings(organization_id,opening_balance_ugx,as_of_date,updated_by)
    VALUES($1,$2,$3,$4) ON CONFLICT(organization_id) DO UPDATE SET opening_balance_ugx=EXCLUDED.opening_balance_ugx,
    as_of_date=EXCLUDED.as_of_date,updated_by=EXCLUDED.updated_by,updated_at=CURRENT_TIMESTAMP RETURNING *`, [organizationId, input.openingBalanceUgx, input.asOfDate, userId]);
        const funding = await client.query('SELECT organization_available_to_commit($1::uuid)::bigint available', [organizationId]);
        if (BigInt(funding.rows[0].available) < 0n)
            throw conflict('This opening balance would leave existing payments or commitments unfunded. Review the amount before saving.');
        await client.query(`INSERT INTO organization_finance_setting_history
    (organization_id,previous_balance_ugx,previous_as_of_date,opening_balance_ugx,as_of_date,changed_by,action)
    VALUES($1,$2,$3,$4,$5,$6,$7)`, [organizationId, previous?.opening_balance_ugx ?? null, previous?.opening_date ?? null, input.openingBalanceUgx, input.asOfDate, userId, previous ? 'updated' : 'created']);
        await client.query('COMMIT');
        return result.rows[0];
    }
    catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
    finally {
        client.release();
    }
}
