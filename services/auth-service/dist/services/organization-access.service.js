"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireActiveOrganization = requireActiveOrganization;
const database_1 = require("../config/database");
/** Require active membership in the current organization for legacy tenant roles. */
async function requireActiveOrganization(organizationId, roles, userId) {
    if (!roles.some(role => ["company_admin", "supervisor", "driver", "iot_operator", "recycling_collector", "recycling_sales", "recycling_field_manager"].includes(role.name)))
        return;
    const result = organizationId
        ? await database_1.dbPool.query("SELECT o.id FROM organizations o JOIN organization_memberships m ON m.organization_id=o.id WHERE o.id=$1::uuid AND o.is_active=true AND m.user_id=$2::uuid AND m.status='active'", [organizationId, userId])
        : null;
    if (!result?.rows.length) {
        throw Object.assign(new Error("Your organization or membership is unavailable. Contact your administrator."), { statusCode: 403 });
    }
}
