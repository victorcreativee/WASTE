"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.complianceCases = complianceCases;
exports.createComplianceCase = createComplianceCase;
exports.respondComplianceCase = respondComplianceCase;
exports.reviewComplianceCase = reviewComplianceCase;
const database_1 = require("../config/database");
async function complianceCases(org) { return (await database_1.dbPool.query(`SELECT c.*,o.name organization_name,u.full_name created_by_name,COALESCE(h.history,'[]'::json) history FROM collector_compliance_cases c JOIN organizations o ON o.id=c.organization_id JOIN users u ON u.id=c.created_by LEFT JOIN LATERAL(SELECT json_agg(json_build_object('status',x.new_status,'note',x.note,'changed_by',actor.full_name,'created_at',x.created_at) ORDER BY x.created_at) history FROM collector_compliance_history x JOIN users actor ON actor.id=x.changed_by WHERE x.case_id=c.id)h ON true WHERE($1::uuid IS NULL OR c.organization_id=$1::uuid) ORDER BY CASE WHEN c.status='closed' THEN 1 ELSE 0 END,c.due_date,c.created_at DESC`, [org])).rows; }
async function createComplianceCase(userId, input) { const client = await database_1.dbPool.connect(); try {
    await client.query('BEGIN');
    const eligible = (await client.query(`SELECT id FROM organizations WHERE id=$1::uuid AND type IN('waste_collection_company','recycling_company')`, [input.organizationId])).rows[0];
    if (!eligible)
        throw Object.assign(new Error('Choose a registered waste collector'), { statusCode: 400 });
    const number = `CMP-${new Date().getFullYear()}-${Date.now()}`;
    const row = (await client.query(`INSERT INTO collector_compliance_cases(case_number,organization_id,category,severity,title,details,required_action,due_date,created_by,updated_by)VALUES($1,$2::uuid,$3,$4,$5,$6,$7,$8::date,$9::uuid,$9::uuid)RETURNING *`, [number, input.organizationId, input.category, input.severity, input.title, input.details, input.requiredAction, input.dueDate, userId])).rows[0];
    await client.query(`INSERT INTO collector_compliance_history(case_id,new_status,note,changed_by)VALUES($1::uuid,'open',$2,$3::uuid)`, [row.id, 'Compliance notice issued', userId]);
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
async function respondComplianceCase(id, org, userId, response) { const client = await database_1.dbPool.connect(); try {
    await client.query('BEGIN');
    const current = (await client.query(`SELECT status FROM collector_compliance_cases WHERE id=$1::uuid AND organization_id=$2::uuid AND status IN('open','acknowledged','remediation_submitted') FOR UPDATE`, [id, org])).rows[0];
    if (!current)
        throw Object.assign(new Error('This compliance case is not available for response'), { statusCode: 409 });
    const row = (await client.query(`UPDATE collector_compliance_cases SET company_response=$3,responded_at=CURRENT_TIMESTAMP,status='remediation_submitted',updated_by=$4::uuid,updated_at=CURRENT_TIMESTAMP WHERE id=$1::uuid AND organization_id=$2::uuid RETURNING *`, [id, org, response, userId])).rows[0];
    await client.query(`INSERT INTO collector_compliance_history(case_id,previous_status,new_status,note,changed_by)VALUES($1::uuid,$2,'remediation_submitted',$3,$4::uuid)`, [id, current.status, response, userId]);
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
async function reviewComplianceCase(id, userId, action, notes) { const client = await database_1.dbPool.connect(); try {
    await client.query('BEGIN');
    const current = (await client.query(`SELECT status FROM collector_compliance_cases WHERE id=$1::uuid FOR UPDATE`, [id])).rows[0];
    if (!current)
        throw Object.assign(new Error('Compliance case not found'), { statusCode: 404 });
    if (action === 'close' && current.status !== 'remediation_submitted')
        throw Object.assign(new Error('The company must submit remediation before this case can be closed'), { statusCode: 409 });
    const next = action === 'close' ? 'closed' : 'open';
    const row = (await client.query(`UPDATE collector_compliance_cases SET status=$2,resolution_notes=$3,closed_at=CASE WHEN $2='closed' THEN CURRENT_TIMESTAMP ELSE NULL END,updated_by=$4::uuid,updated_at=CURRENT_TIMESTAMP WHERE id=$1::uuid RETURNING *`, [id, next, notes, userId])).rows[0];
    await client.query(`INSERT INTO collector_compliance_history(case_id,previous_status,new_status,note,changed_by)VALUES($1::uuid,$2,$3,$4,$5::uuid)`, [id, current.status, next, notes, userId]);
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
