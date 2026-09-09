"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.findWeighbridgeTransactions = findWeighbridgeTransactions;
exports.createWeighbridgeTransaction = createWeighbridgeTransaction;
exports.completeWeighbridgeTransaction = completeWeighbridgeTransaction;
exports.voidWeighbridgeTransaction = voidWeighbridgeTransaction;
const database_1 = require("../config/database");
async function findWeighbridgeTransactions(org) { return (await database_1.dbPool.query(`SELECT w.*,r.trip_number,r.status trip_status,t.plate_number,d.full_name linked_driver_name,o.name organization_name FROM weighbridge_transactions w JOIN organizations o ON o.id=w.organization_id LEFT JOIN collection_routes r ON r.id=w.trip_id LEFT JOIN waste_trucks t ON t.id=w.vehicle_id LEFT JOIN drivers d ON d.id=w.driver_id WHERE ($1::uuid IS NULL OR w.organization_id=$1::uuid) ORDER BY w.operation_date DESC,w.created_at DESC`, [org])).rows; }
async function syncTrip(client, row, userId) { if (row.status !== "completed" || !row.trip_id)
    return; await client.query(`UPDATE collection_routes SET weighbridge_ticket_number=$3,weighbridge_facility=$4,verified_weight_kg=$5,weight_verified_at=CURRENT_TIMESTAMP,weight_verified_by=$2::uuid,updated_at=CURRENT_TIMESTAMP WHERE id=$1::uuid AND organization_id=$6::uuid AND status='completed'`, [row.trip_id, userId, row.ticket_number, row.facility, row.net_kg, row.organization_id]); }
async function createWeighbridgeTransaction(userId, input) { const org = input.organizationId, client = await database_1.dbPool.connect(); try {
    await client.query("BEGIN");
    const organization = (await client.query(`SELECT id FROM organizations WHERE id=$1::uuid AND status='active'`, [org])).rows[0];
    if (!organization)
        throw Object.assign(new Error("Choose an active licensed waste company"), { statusCode: 400 });
    if (input.tripId) {
        const trip = (await client.query(`SELECT id FROM collection_routes WHERE id=$1::uuid AND organization_id=$2::uuid`, [input.tripId, org])).rows[0];
        if (!trip)
            throw Object.assign(new Error("The selected trip does not belong to this company"), { statusCode: 400 });
    }
    const tare = input.tareKg ?? null, net = tare === null ? null : input.grossKg - tare;
    const row = (await client.query(`INSERT INTO weighbridge_transactions(organization_id,trip_id,vehicle_id,driver_id,ticket_number,facility,registration,driver_name,route_source,operation_date,arrival_at,departure_at,gross_kg,tare_kg,net_kg,status,created_by,updated_by) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8,$9,$10::date,$11::timestamptz,$12::timestamptz,$13,$14,$15,$16,$17::uuid,$17::uuid) RETURNING *`, [org, input.tripId ?? null, input.vehicleId ?? null, input.driverId ?? null, input.ticketNumber, input.facility, input.registration.toUpperCase(), input.driverName ?? null, input.routeSource ?? null, input.operationDate, input.arrivalAt, input.departureAt ?? null, input.grossKg, tare, net, input.status, userId])).rows[0];
    await syncTrip(client, row, userId);
    await client.query("COMMIT");
    return row;
}
catch (e) {
    await client.query("ROLLBACK");
    throw e;
}
finally {
    client.release();
} }
async function completeWeighbridgeTransaction(id, org, userId, input) { const client = await database_1.dbPool.connect(); try {
    await client.query("BEGIN");
    const current = (await client.query(`SELECT gross_kg FROM weighbridge_transactions WHERE id=$1::uuid AND organization_id=$2::uuid AND status='open' FOR UPDATE`, [id, org])).rows[0];
    if (!current)
        throw Object.assign(new Error("Only an open transaction can be completed"), { statusCode: 400 });
    if (input.tareKg >= Number(current.gross_kg))
        throw Object.assign(new Error("Tare weight must be less than gross weight"), { statusCode: 400 });
    const row = (await client.query(`UPDATE weighbridge_transactions SET tare_kg=$4,net_kg=gross_kg-$4,departure_at=$5::timestamptz,status='completed',updated_by=$3::uuid,updated_at=CURRENT_TIMESTAMP WHERE id=$1::uuid AND organization_id=$2::uuid RETURNING *`, [id, org, userId, input.tareKg, input.departureAt])).rows[0];
    await syncTrip(client, row, userId);
    await client.query("COMMIT");
    return row;
}
catch (e) {
    await client.query("ROLLBACK");
    throw e;
}
finally {
    client.release();
} }
async function voidWeighbridgeTransaction(id, userId, reason) { const client = await database_1.dbPool.connect(); try {
    await client.query("BEGIN");
    const current = (await client.query(`SELECT * FROM weighbridge_transactions WHERE id=$1::uuid AND status<>'voided' FOR UPDATE`, [id])).rows[0];
    if (!current)
        throw Object.assign(new Error("This transaction is already voided or does not exist"), { statusCode: 400 });
    const row = (await client.query(`UPDATE weighbridge_transactions SET status='voided',void_reason=$2,updated_by=$3::uuid,updated_at=CURRENT_TIMESTAMP WHERE id=$1::uuid RETURNING *`, [id, reason, userId])).rows[0];
    if (current.trip_id) {
        await client.query(`UPDATE collection_routes SET weighbridge_ticket_number=NULL,weighbridge_facility=NULL,verified_weight_kg=NULL,weight_verified_at=NULL,weight_verified_by=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=$1::uuid AND organization_id=$2::uuid AND weighbridge_ticket_number=$3`, [current.trip_id, current.organization_id, current.ticket_number]);
    }
    await client.query("COMMIT");
    return row;
}
catch (e) {
    await client.query("ROLLBACK");
    throw e;
}
finally {
    client.release();
} }
