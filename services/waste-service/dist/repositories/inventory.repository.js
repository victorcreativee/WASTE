"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.findInventory = findInventory;
exports.createItem = createItem;
exports.recordMovement = recordMovement;
exports.createRequest = createRequest;
exports.changeRequest = changeRequest;
const database_1 = require("../config/database");
async function findInventory(org) { const items = await database_1.dbPool.query(`SELECT *,(quantity<=reorder_level) low_stock,(quantity*unit_cost_ugx)::bigint stock_value_ugx FROM inventory_items WHERE is_active=true AND ($1::uuid IS NULL OR organization_id=$1::uuid) ORDER BY (quantity<=reorder_level) DESC,name`, [org]); const movements = await database_1.dbPool.query(`SELECT m.*,i.name item_name,i.sku,u.full_name recorded_by_name FROM inventory_movements m JOIN inventory_items i ON i.id=m.item_id LEFT JOIN users u ON u.id=m.recorded_by WHERE ($1::uuid IS NULL OR m.organization_id=$1::uuid) ORDER BY m.created_at DESC LIMIT 100`, [org]); const requests = await database_1.dbPool.query(`SELECT p.*,u.full_name requested_by_name,a.full_name approved_by_name FROM purchase_requests p LEFT JOIN users u ON u.id=p.requested_by LEFT JOIN users a ON a.id=p.approved_by WHERE ($1::uuid IS NULL OR p.organization_id=$1::uuid) ORDER BY p.created_at DESC`, [org]); return { items: items.rows, movements: movements.rows, requests: requests.rows }; }
async function createItem(org, data) { const r = await database_1.dbPool.query(`INSERT INTO inventory_items(organization_id,sku,name,category,unit,reorder_level,unit_cost_ugx,storage_location) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [org, data.sku.toUpperCase(), data.name, data.category, data.unit, data.reorderLevel, data.unitCostUgx, data.storageLocation ?? null]); return r.rows[0]; }
async function recordMovement(org, user, itemId, data) { const client = await database_1.dbPool.connect(); try {
    await client.query('BEGIN');
    const delta = data.movementType === 'issue' ? -Math.abs(data.quantity) : data.quantity;
    const item = await client.query(`UPDATE inventory_items SET quantity=quantity+$3,updated_at=CURRENT_TIMESTAMP WHERE id=$1::uuid AND organization_id=$2::uuid AND quantity+$3>=0 RETURNING *`, [itemId, org, delta]);
    if (!item.rows[0]) {
        await client.query('ROLLBACK');
        return null;
    }
    const m = await client.query(`INSERT INTO inventory_movements(organization_id,item_id,movement_type,quantity,reason,reference,recorded_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [org, itemId, data.movementType, delta, data.reason, data.reference ?? null, user]);
    await client.query('COMMIT');
    return { item: item.rows[0], movement: m.rows[0] };
}
catch (e) {
    await client.query('ROLLBACK');
    throw e;
}
finally {
    client.release();
} }
async function createRequest(org, user, data) { const r = await database_1.dbPool.query(`INSERT INTO purchase_requests(organization_id,request_number,item_name,category,quantity,unit,estimated_cost_ugx,justification,requested_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [org, `PR-${Date.now()}`, data.itemName, data.category, data.quantity, data.unit, data.estimatedCostUgx, data.justification, user]); return r.rows[0]; }
async function changeRequest(org, user, id, status) { const r = await database_1.dbPool.query(`UPDATE purchase_requests SET status=$4,approved_by=CASE WHEN $4='approved' THEN $2::uuid ELSE approved_by END,approved_at=CASE WHEN $4='approved' THEN CURRENT_TIMESTAMP ELSE approved_at END,received_at=CASE WHEN $4='received' THEN CURRENT_TIMESTAMP ELSE received_at END,updated_at=CURRENT_TIMESTAMP WHERE id=$3::uuid AND organization_id=$1::uuid AND (($4='submitted' AND status='draft') OR ($4 IN ('approved','rejected') AND status='submitted') OR ($4='ordered' AND status='approved') OR ($4='received' AND status='ordered') OR ($4='cancelled' AND status IN ('draft','submitted'))) RETURNING *`, [org, user, id, status]); return r.rows[0] ?? null; }
