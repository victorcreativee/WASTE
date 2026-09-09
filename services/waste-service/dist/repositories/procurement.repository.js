"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.findProcurement = findProcurement;
exports.createSupplier = createSupplier;
exports.createOrder = createOrder;
exports.changeOrder = changeOrder;
const expense_repository_1 = require("./expense.repository");
const database_1 = require("../config/database");
async function findProcurement(org) { const suppliers = await database_1.dbPool.query(`SELECT s.*,COUNT(po.id)::int order_count,COALESCE(SUM(po.quantity*po.unit_price_ugx) FILTER(WHERE po.status<>'cancelled'),0)::bigint ordered_value_ugx FROM suppliers s LEFT JOIN purchase_orders po ON po.supplier_id=s.id WHERE ($1::uuid IS NULL OR s.organization_id=$1::uuid) GROUP BY s.id ORDER BY s.name`, [org]); const orders = await database_1.dbPool.query(`SELECT po.*,s.name supplier_name,pr.request_number,(po.quantity*po.unit_price_ugx)::bigint total_ugx,u.full_name created_by_name FROM purchase_orders po JOIN suppliers s ON s.id=po.supplier_id LEFT JOIN purchase_requests pr ON pr.id=po.purchase_request_id LEFT JOIN users u ON u.id=po.created_by WHERE ($1::uuid IS NULL OR po.organization_id=$1::uuid) ORDER BY po.created_at DESC`, [org]); const approved = await database_1.dbPool.query(`SELECT * FROM purchase_requests pr WHERE status='approved' AND ($1::uuid IS NULL OR organization_id=$1::uuid) AND NOT EXISTS(SELECT 1 FROM purchase_orders po WHERE po.purchase_request_id=pr.id AND po.status<>'cancelled') ORDER BY created_at`, [org]); return { funding: org ? await (0, expense_repository_1.findFinancialPosition)(org) : null, suppliers: suppliers.rows, orders: orders.rows, approvedRequests: approved.rows }; }
async function createSupplier(org, data) { const r = await database_1.dbPool.query(`INSERT INTO suppliers(organization_id,name,contact_person,phone,email,address,tax_number,payment_terms) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [org, data.name, data.contactPerson ?? null, data.phone ?? null, data.email || null, data.address ?? null, data.taxNumber ?? null, data.paymentTerms ?? null]); return r.rows[0]; }
async function createOrder(org, user, data) {
    const r = await database_1.dbPool.query(`INSERT INTO purchase_orders(organization_id,order_number,purchase_request_id,supplier_id,item_name,quantity,unit,unit_price_ugx,expected_on,notes,created_by)
 SELECT $1,$2,$3::uuid,s.id,COALESCE(pr.item_name,$5),COALESCE(pr.quantity,$6),COALESCE(pr.unit,$7),$8,$9,$10,$11
 FROM suppliers s LEFT JOIN purchase_requests pr ON pr.id=$3::uuid AND pr.organization_id=$1::uuid AND pr.status='approved'
 WHERE s.id=$4::uuid AND s.organization_id=$1::uuid AND s.status='active' AND ($3::uuid IS NULL OR pr.id IS NOT NULL)
 RETURNING *`, [org, `PO-${Date.now()}`, data.purchaseRequestId ?? null, data.supplierId, data.itemName, data.quantity, data.unit, data.unitPriceUgx, data.expectedOn ?? null, data.notes ?? null, user]);
    return r.rows[0] ?? null;
}
async function changeOrder(org, user, id, status) {
    const client = await database_1.dbPool.connect();
    try {
        await client.query('BEGIN');
        await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`finance:${org}`]);
        const r = await client.query(`UPDATE purchase_orders SET status=$3,issued_at=CASE WHEN $3='issued' THEN CURRENT_TIMESTAMP ELSE issued_at END,received_at=CASE WHEN $3='received' THEN CURRENT_TIMESTAMP ELSE received_at END,updated_at=CURRENT_TIMESTAMP WHERE id=$1::uuid AND organization_id=$2::uuid AND (($3='issued' AND status='draft' AND quantity*unit_price_ugx<=organization_available_to_commit($2::uuid)) OR ($3='received' AND status='issued') OR ($3='cancelled' AND status IN ('draft','issued'))) RETURNING *`, [id, org, status]);
        const row = r.rows[0];
        if (row?.purchase_request_id) {
            const request = await client.query(`UPDATE purchase_requests SET status=CASE WHEN $2='issued' THEN 'ordered' WHEN $2='received' THEN 'received' ELSE 'approved' END,received_at=CASE WHEN $2='received' THEN CURRENT_TIMESTAMP ELSE received_at END,updated_at=CURRENT_TIMESTAMP WHERE id=$1::uuid RETURNING *`, [row.purchase_request_id, status]);
            if (status === 'received') {
                await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`${org}:${String(row.item_name).toLowerCase()}:${String(row.unit).toLowerCase()}`]);
                const existing = await client.query(`SELECT id FROM inventory_items WHERE organization_id=$1::uuid AND is_active=true AND LOWER(name)=LOWER($2) AND LOWER(unit)=LOWER($3) ORDER BY created_at LIMIT 1 FOR UPDATE`, [org, row.item_name, row.unit]);
                let itemId = existing.rows[0]?.id;
                if (itemId) {
                    await client.query(`UPDATE inventory_items SET quantity=quantity+$2,unit_cost_ugx=$3,updated_at=CURRENT_TIMESTAMP WHERE id=$1::uuid`, [itemId, row.quantity, row.unit_price_ugx]);
                }
                else {
                    const created = await client.query(`INSERT INTO inventory_items(organization_id,sku,name,category,unit,quantity,reorder_level,unit_cost_ugx) VALUES($1,$2,$3,$4,$5,$6,0,$7) RETURNING id`, [org, `AUTO-${request.rows[0].request_number}`, row.item_name, request.rows[0].category, row.unit, row.quantity, row.unit_price_ugx]);
                    itemId = created.rows[0].id;
                }
                await client.query(`INSERT INTO inventory_movements(organization_id,item_id,movement_type,quantity,reason,reference,recorded_by) VALUES($1,$2,'receipt',$3,$4,$5,$6)`, [org, itemId, row.quantity, `Purchase order ${row.order_number} received`, row.order_number, user]);
                row.inventory_item_id = itemId;
            }
        }
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
