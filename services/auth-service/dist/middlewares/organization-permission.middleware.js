"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireOrganizationPermission = requireOrganizationPermission;
const database_1 = require("../config/database");
/** Run after fresh identity/role checks. Global permissions never bypass tenant grants. */
function requireOrganizationPermission(code) {
    return async (req, res, next) => {
        const user = req.user;
        if (!user?.userId || !user.organizationId)
            return res.status(403).json({ success: false, message: "An active organization membership is required" });
        const result = await database_1.dbPool.query("SELECT 1 FROM organization_effective_permissions($1::uuid,$2::uuid) WHERE code=$3", [user.userId, user.organizationId, code]);
        if (!result.rowCount)
            return res.status(403).json({ success: false, message: "Your organization role does not permit this action", requiredPermission: code });
        next();
    };
}
