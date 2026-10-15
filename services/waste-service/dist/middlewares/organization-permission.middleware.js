"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireOrganizationPermission = requireOrganizationPermission;
exports.requireAnyOrganizationPermission = requireAnyOrganizationPermission;
exports.requireRoleOrOrganizationPermission = requireRoleOrOrganizationPermission;
const database_1 = require("../config/database");
async function hasAnyPermission(req, res, next, permissionCodes) {
    const identity = req.auth;
    if (!identity?.userId || !identity.organizationId) {
        return res.status(403).json({
            success: false,
            message: "An active organization membership is required",
        });
    }
    try {
        const result = await database_1.dbPool.query(`SELECT code
       FROM organization_effective_permissions($1::uuid, $2::uuid)
       WHERE code = ANY($3::text[])
       LIMIT 1`, [identity.userId, identity.organizationId, permissionCodes]);
        if (!result.rowCount) {
            return res.status(403).json({
                success: false,
                message: "Your organization role does not permit this action",
                requiredPermissions: permissionCodes,
            });
        }
        next();
    }
    catch (error) {
        next(error);
    }
}
function requireOrganizationPermission(code) {
    return (req, res, next) => hasAnyPermission(req, res, next, [code]);
}
function requireAnyOrganizationPermission(...codes) {
    return (req, res, next) => hasAnyPermission(req, res, next, codes);
}
/** Allow a public-facing account role or an explicitly granted tenant permission. */
function requireRoleOrOrganizationPermission(allowedRoles, ...codes) {
    return (req, res, next) => {
        if (req.auth?.roles.some(role => allowedRoles.includes(role)))
            return next();
        return hasAnyPermission(req, res, next, codes);
    };
}
