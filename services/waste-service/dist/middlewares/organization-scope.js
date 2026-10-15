"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireOrganizationScope = requireOrganizationScope;
exports.operationalOrganizationScope = operationalOrganizationScope;
/** Private organization data never has a platform-wide/null scope. */
function requireOrganizationScope(req) {
    const auth = req.auth;
    if (!auth)
        throw Object.assign(new Error("Authentication is required"), { statusCode: 401 });
    if (!auth.roles.some(role => ["company_admin", "supervisor", "recycling_collector", "recycling_sales", "recycling_field_manager"].includes(role)) || !auth.organizationId) {
        throw Object.assign(new Error("An authorized organization context is required"), { statusCode: 403 });
    }
    return auth.organizationId;
}
/** Only explicitly admitted city/platform roles may use city-wide operational queries. */
function operationalOrganizationScope(req) {
    const auth = req.auth;
    if (!auth)
        throw Object.assign(new Error("Authentication is required"), { statusCode: 401 });
    if (auth.roles.some(role => ["company_admin", "supervisor"].includes(role))) {
        return requireOrganizationScope(req);
    }
    // Driver endpoints add their own user/assignment filter as well as this tenant scope.
    if (auth.roles.includes("driver")) {
        if (auth.organizationId)
            return auth.organizationId;
        throw Object.assign(new Error("An organization context is required"), { statusCode: 403 });
    }
    if (auth.roles.some(role => ["kcca_admin", "system_admin", "weighbridge_operator"].includes(role)))
        return null;
    throw Object.assign(new Error("Operational access is not permitted"), { statusCode: 403 });
}
