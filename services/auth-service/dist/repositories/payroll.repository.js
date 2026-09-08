"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.findPayroll = findPayroll;
exports.createPeriod = createPeriod;
exports.saveLine = saveLine;
exports.changePeriodStatus = changePeriodStatus;
const database_1 = require("../config/database");
async function findPayroll(organizationId) { const periods = await database_1.dbPool.query(`SELECT p.*,COUNT(l.id)::int staff_count,COALESCE(SUM(l.basic_pay_ugx+l.allowance_ugx-l.deduction_ugx),0)::bigint net_total_ugx FROM payroll_periods p LEFT JOIN payroll_lines l ON l.period_id=p.id WHERE p.organization_id=$1::uuid GROUP BY p.id ORDER BY p.starts_on DESC`, [organizationId]); const lines = await database_1.dbPool.query(`SELECT l.*,u.full_name,u.email,ARRAY_REMOVE(ARRAY_AGG(DISTINCT r.name),NULL) roles,(l.basic_pay_ugx+l.allowance_ugx-l.deduction_ugx)::bigint net_pay_ugx FROM payroll_lines l JOIN users u ON u.id=l.user_id LEFT JOIN user_roles ur ON ur.user_id=u.id LEFT JOIN roles r ON r.id=ur.role_id WHERE l.organization_id=$1::uuid GROUP BY l.id,u.id ORDER BY u.full_name`, [organizationId]); return { periods: periods.rows, lines: lines.rows }; }
async function createPeriod(org, user, data) { const client = await database_1.dbPool.connect(); try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`finance:${org}`]);
    const r = await client.query(`INSERT INTO payroll_periods(organization_id,name,starts_on,ends_on,pay_date,created_by) SELECT $1,$2,$3,$4,$5,$6 WHERE NOT EXISTS(SELECT 1 FROM payroll_periods WHERE organization_id=$1::uuid AND status<>'cancelled' AND daterange(starts_on,ends_on,'[]')&&daterange($3::date,$4::date,'[]')) RETURNING *`, [org, data.name, data.startsOn, data.endsOn, data.payDate, user]);
    await client.query('COMMIT');
    return r.rows[0] ?? null;
}
catch (error) {
    await client.query('ROLLBACK');
    throw error;
}
finally {
    client.release();
} }
async function saveLine(org, periodId, data) { const client = await database_1.dbPool.connect(); try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`finance:${org}`]);
    const period = await client.query("SELECT id FROM payroll_periods WHERE id=$1::uuid AND organization_id=$2::uuid AND status='draft' FOR UPDATE", [periodId, org]);
    if (!period.rows[0]) {
        await client.query('ROLLBACK');
        return null;
    }
    const r = await client.query(`INSERT INTO payroll_lines(period_id,organization_id,user_id,basic_pay_ugx,allowance_ugx,deduction_ugx,notes) SELECT p.id,p.organization_id,u.id,$4,$5,$6,$7 FROM payroll_periods p JOIN users u ON u.id=$3::uuid AND u.organization_id=p.organization_id AND u.status='active' WHERE p.id=$2::uuid AND p.organization_id=$1::uuid AND p.status='draft' ON CONFLICT(period_id,user_id) DO UPDATE SET basic_pay_ugx=EXCLUDED.basic_pay_ugx,allowance_ugx=EXCLUDED.allowance_ugx,deduction_ugx=EXCLUDED.deduction_ugx,notes=EXCLUDED.notes,updated_at=CURRENT_TIMESTAMP RETURNING *`, [org, periodId, data.userId, data.basicPayUgx, data.allowanceUgx, data.deductionUgx, data.notes ?? null]);
    await client.query('COMMIT');
    return r.rows[0] ?? null;
}
catch (error) {
    await client.query('ROLLBACK');
    throw error;
}
finally {
    client.release();
} }
async function changePeriodStatus(org, user, id, status) { const client = await database_1.dbPool.connect(); try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`finance:${org}`]);
    const r = await client.query(`UPDATE payroll_periods SET status=$4,approved_by=CASE WHEN $4='approved' THEN $2::uuid ELSE approved_by END,approved_at=CASE WHEN $4='approved' THEN CURRENT_TIMESTAMP ELSE approved_at END,paid_at=CASE WHEN $4='paid' THEN CURRENT_TIMESTAMP ELSE paid_at END WHERE id=$3::uuid AND organization_id=$1::uuid AND (($4='approved' AND status='draft' AND COALESCE((SELECT SUM(basic_pay_ugx+allowance_ugx-deduction_ugx) FROM payroll_lines WHERE period_id=payroll_periods.id),0)>0 AND COALESCE((SELECT SUM(basic_pay_ugx+allowance_ugx-deduction_ugx) FROM payroll_lines WHERE period_id=payroll_periods.id),0)<=organization_available_to_commit($1::uuid)) OR ($4='paid' AND status='approved' AND COALESCE((SELECT SUM(basic_pay_ugx+allowance_ugx-deduction_ugx) FROM payroll_lines WHERE period_id=payroll_periods.id),0)<=organization_cash_position($1::uuid)) OR ($4='cancelled' AND status<>'paid')) RETURNING *`, [org, user, id, status]);
    const row = r.rows[0];
    if (!row) {
        await client.query('ROLLBACK');
        return null;
    }
    if (status === 'paid') {
        const total = await client.query(`SELECT SUM(basic_pay_ugx+allowance_ugx-deduction_ugx)::bigint amount FROM payroll_lines WHERE period_id=$1::uuid`, [id]);
        await client.query(`INSERT INTO organization_expenses(organization_id,expense_number,category,description,amount_ugx,expense_date,status,reference,created_by,approved_by,approved_at,paid_at) VALUES($1,$2,'payroll',$3,$4,$5,'paid',$6,$7,$7,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`, [org, `EXP-PAY-${Date.now()}`, `Payroll · ${row.name}`, total.rows[0].amount, row.pay_date, `PAYROLL-${id}`, user]);
    }
    await client.query('COMMIT');
    return row;
}
catch (e) {
    await client.query('ROLLBACK');
    throw e;
}
finally {
    client.release();
} }
