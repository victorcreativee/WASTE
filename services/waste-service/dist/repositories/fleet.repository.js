"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fleetOverview = fleetOverview;
exports.fleetTruckDetail = fleetTruckDetail;
exports.addMaintenance = addMaintenance;
exports.updateMaintenanceStatus = updateMaintenanceStatus;
exports.addTruckDocument = addTruckDocument;
exports.addFuelRecord = addFuelRecord;
exports.updateTruckStatus = updateTruckStatus;
const database_1 = require("../config/database");
async function fleetOverview(organizationId) {
    const params = [organizationId];
    const trucks = await database_1.dbPool.query(`SELECT wt.id,wt.organization_id,wt.plate_number,wt.truck_name,wt.capacity_tons,wt.status,
    COALESCE((SELECT SUM(cost_ugx) FROM truck_maintenance_records m WHERE m.truck_id=wt.id AND m.status='completed'),0)::bigint AS maintenance_cost_ugx,
    COALESCE((SELECT SUM(cost_ugx) FROM truck_fuel_records f WHERE f.truck_id=wt.id),0)::bigint AS fuel_cost_ugx,
    (SELECT MIN(scheduled_date) FROM truck_maintenance_records m WHERE m.truck_id=wt.id AND m.status IN ('scheduled','in_progress')) AS next_service_date,
    (SELECT MIN(expires_on) FROM truck_documents d WHERE d.truck_id=wt.id) AS next_document_expiry,
    (SELECT COUNT(*)::int FROM collection_jobs j WHERE j.truck_id=wt.id AND j.status IN ('assigned','in_progress')) AS active_jobs
    FROM waste_trucks wt WHERE ($1::uuid IS NULL OR wt.organization_id=$1::uuid) ORDER BY wt.plate_number`, params);
    const summary = await database_1.dbPool.query(`SELECT COUNT(*)::int total,
    COUNT(*) FILTER(WHERE status='available')::int available,COUNT(*) FILTER(WHERE status='assigned')::int assigned,
    COUNT(*) FILTER(WHERE status='maintenance')::int maintenance,COUNT(*) FILTER(WHERE status='inactive')::int inactive
    FROM waste_trucks WHERE ($1::uuid IS NULL OR organization_id=$1::uuid)`, params);
    const costs = await database_1.dbPool.query(`SELECT
    COALESCE((SELECT SUM(cost_ugx) FROM truck_maintenance_records WHERE ($1::uuid IS NULL OR organization_id=$1::uuid) AND scheduled_date>=date_trunc('month',CURRENT_DATE)),0)::bigint maintenance_month,
    COALESCE((SELECT SUM(cost_ugx) FROM truck_fuel_records WHERE ($1::uuid IS NULL OR organization_id=$1::uuid) AND fuel_date>=date_trunc('month',CURRENT_DATE)),0)::bigint fuel_month,
    (SELECT COUNT(*)::int FROM truck_documents WHERE ($1::uuid IS NULL OR organization_id=$1::uuid) AND expires_on BETWEEN CURRENT_DATE AND CURRENT_DATE+30) expiring_documents`, params);
    return { summary: { ...summary.rows[0], ...costs.rows[0] }, trucks: trucks.rows };
}
async function fleetTruckDetail(truckId, organizationId) {
    const truck = await database_1.dbPool.query(`SELECT id,organization_id,plate_number,truck_name,capacity_tons,status,created_at FROM waste_trucks WHERE id=$1::uuid AND ($2::uuid IS NULL OR organization_id=$2::uuid)`, [truckId, organizationId]);
    if (!truck.rows[0])
        return null;
    const [maintenance, documents, fuel] = await Promise.all([
        database_1.dbPool.query(`SELECT * FROM truck_maintenance_records WHERE truck_id=$1::uuid ORDER BY scheduled_date DESC,created_at DESC`, [truckId]),
        database_1.dbPool.query(`SELECT *,CASE WHEN expires_on<CURRENT_DATE THEN 'expired' WHEN expires_on<=CURRENT_DATE+30 THEN 'expiring' ELSE 'valid' END AS compliance_status FROM truck_documents WHERE truck_id=$1::uuid ORDER BY expires_on`, [truckId]),
        database_1.dbPool.query(`SELECT * FROM truck_fuel_records WHERE truck_id=$1::uuid ORDER BY fuel_date DESC,created_at DESC LIMIT 100`, [truckId]),
    ]);
    return { ...truck.rows[0], maintenance: maintenance.rows, documents: documents.rows, fuel: fuel.rows };
}
async function addMaintenance(truckId, orgId, userId, data) {
    const r = await database_1.dbPool.query(`INSERT INTO truck_maintenance_records(truck_id,organization_id,category,title,description,status,scheduled_date,completed_at,odometer_km,cost_ugx,service_provider,created_by)
    SELECT id,organization_id,$3,$4,$5,$6,$7,CASE WHEN $6='completed' THEN CURRENT_TIMESTAMP END,$8,$9,$10,$11::uuid FROM waste_trucks WHERE id=$1::uuid AND organization_id=$2::uuid RETURNING *`, [truckId, orgId, data.category, data.title, data.description ?? null, data.status, data.scheduledDate, data.odometerKm ?? null, data.costUgx, data.serviceProvider ?? null, userId]);
    if (r.rows[0] && data.status === 'in_progress')
        await database_1.dbPool.query(`UPDATE waste_trucks SET status='maintenance',updated_at=CURRENT_TIMESTAMP WHERE id=$1`, [truckId]);
    return r.rows[0] ?? null;
}
async function updateMaintenanceStatus(id, orgId, status) {
    const client = await database_1.dbPool.connect();
    try {
        await client.query('BEGIN');
        const r = await client.query(`UPDATE truck_maintenance_records SET status=$3,completed_at=CASE WHEN $3='completed' THEN CURRENT_TIMESTAMP ELSE completed_at END,updated_at=CURRENT_TIMESTAMP WHERE id=$1::uuid AND organization_id=$2::uuid RETURNING *`, [id, orgId, status]);
        const row = r.rows[0];
        if (row && status === 'in_progress')
            await client.query(`UPDATE waste_trucks SET status='maintenance',updated_at=CURRENT_TIMESTAMP WHERE id=$1`, [row.truck_id]);
        if (row && status === 'completed')
            await client.query(`UPDATE waste_trucks SET status='available',updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM truck_maintenance_records WHERE truck_id=$1 AND status='in_progress')`, [row.truck_id]);
        await client.query('COMMIT');
        return row ?? null;
    }
    catch (e) {
        await client.query('ROLLBACK');
        throw e;
    }
    finally {
        client.release();
    }
}
async function addTruckDocument(truckId, orgId, userId, data) { const r = await database_1.dbPool.query(`INSERT INTO truck_documents(truck_id,organization_id,document_type,document_number,issued_on,expires_on,file_url,created_by) SELECT id,organization_id,$3,$4,$5,$6,$7,$8::uuid FROM waste_trucks WHERE id=$1::uuid AND organization_id=$2::uuid RETURNING *`, [truckId, orgId, data.documentType, data.documentNumber, data.issuedOn ?? null, data.expiresOn, data.fileUrl || null, userId]); return r.rows[0] ?? null; }
async function addFuelRecord(truckId, orgId, userId, data) { const r = await database_1.dbPool.query(`INSERT INTO truck_fuel_records(truck_id,organization_id,litres,cost_ugx,odometer_km,fuel_date,station,recorded_by) SELECT id,organization_id,$3,$4,$5,$6,$7,$8::uuid FROM waste_trucks WHERE id=$1::uuid AND organization_id=$2::uuid RETURNING *`, [truckId, orgId, data.litres, data.costUgx, data.odometerKm ?? null, data.fuelDate, data.station ?? null, userId]); return r.rows[0] ?? null; }
async function updateTruckStatus(truckId, orgId, status) { const r = await database_1.dbPool.query(`UPDATE waste_trucks SET status=$3,updated_at=CURRENT_TIMESTAMP WHERE id=$1::uuid AND organization_id=$2::uuid RETURNING *`, [truckId, orgId, status]); return r.rows[0] ?? null; }
