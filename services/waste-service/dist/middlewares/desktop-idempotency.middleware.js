"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.desktopIdempotency = desktopIdempotency;
const node_crypto_1 = require("node:crypto");
const database_1 = require("../config/database");
const mutationMethods = new Set(["POST", "PUT", "PATCH"]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
async function desktopIdempotency(req, res, next) {
    const offlineClient = req.header("X-KWMS-Desktop") === "1" || req.header("X-KWMS-Offline") === "1";
    if (!offlineClient || !mutationMethods.has(req.method))
        return next();
    const key = req.header("Idempotency-Key") ?? "";
    const organizationId = req.auth?.organizationId;
    const userId = req.auth?.userId;
    if (!uuid.test(key))
        return res.status(400).json({ success: false, message: "A valid desktop synchronization key is required" });
    if (!organizationId || !userId)
        return res.status(403).json({ success: false, message: "Desktop synchronization requires an organization account" });
    const hash = (0, node_crypto_1.createHash)("sha256")
        .update(`${req.method}\n${req.originalUrl}\n${JSON.stringify(req.body ?? null)}`)
        .digest("hex");
    await database_1.dbPool.query(`DELETE FROM desktop_sync_requests
     WHERE organization_id=$1::uuid AND idempotency_key=$2::uuid
       AND state='processing' AND created_at<CURRENT_TIMESTAMP-INTERVAL '15 minutes'`, [organizationId, key]);
    const claimed = await database_1.dbPool.query(`INSERT INTO desktop_sync_requests
       (organization_id,idempotency_key,user_id,method,endpoint,request_hash)
     VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,$6)
     ON CONFLICT(organization_id,idempotency_key) DO NOTHING
     RETURNING idempotency_key`, [organizationId, key, userId, req.method, req.originalUrl, hash]);
    if (!claimed.rowCount) {
        const existing = (await database_1.dbPool.query(`SELECT request_hash,state,response_status,response_body
       FROM desktop_sync_requests WHERE organization_id=$1::uuid AND idempotency_key=$2::uuid`, [organizationId, key])).rows[0];
        if (!existing || existing.request_hash !== hash)
            return res.status(409).json({ success: false, message: "This synchronization key belongs to different work" });
        if (existing.state === "completed")
            return res.status(existing.response_status).json(existing.response_body);
        return res.status(409).json({ success: false, message: "This offline action is already synchronizing. Try again shortly." });
    }
    const originalJson = res.json.bind(res);
    res.json = ((body) => {
        const status = res.statusCode;
        const persist = status >= 500
            ? database_1.dbPool.query(`DELETE FROM desktop_sync_requests WHERE organization_id=$1::uuid AND idempotency_key=$2::uuid`, [organizationId, key])
            : database_1.dbPool.query(`UPDATE desktop_sync_requests SET state='completed',response_status=$3,response_body=$4::jsonb,completed_at=CURRENT_TIMESTAMP
           WHERE organization_id=$1::uuid AND idempotency_key=$2::uuid`, [organizationId, key, status, JSON.stringify(body ?? null)]);
        void persist.then(() => originalJson(body)).catch(() => {
            res.status(503);
            originalJson({ success: false, message: "The operation was saved but its synchronization receipt could not be recorded. Contact support before retrying." });
        });
        return res;
    });
    next();
}
