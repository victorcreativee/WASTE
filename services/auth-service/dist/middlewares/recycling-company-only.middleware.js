"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireRecyclingCompany = requireRecyclingCompany;
const database_1 = require("../config/database");
/** Staff management is currently a recycling-company capability only. */
async function requireRecyclingCompany(req, res, next) {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
        return res.status(403).json({ success: false, message: "Your account is not linked to an organization" });
    }
    const result = await database_1.dbPool.query("SELECT 1 FROM organizations WHERE id=$1::uuid AND type='recycling_company'", [organizationId]);
    if (!result.rowCount) {
        return res.status(403).json({ success: false, message: "Staff management is available only to recycling companies" });
    }
    return next();
}
