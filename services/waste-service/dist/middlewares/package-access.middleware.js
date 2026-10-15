"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requirePackageFeature = requirePackageFeature;
const database_1 = require("../config/database");
function requirePackageFeature(featureCode) {
    return async (req, res, next) => {
        try {
            if (!req.auth?.organizationId || !req.auth.roles.some(role => ["company_admin", "supervisor", "driver"].includes(role)))
                return next();
            const result = await database_1.dbPool.query(`SELECT o.type,p.code,
     CASE WHEN p.code='collector_custom' THEN COALESCE((SELECT array_agg(feature_code) FROM organization_package_feature_overrides WHERE organization_id=o.id AND enabled),p.feature_codes) ELSE p.feature_codes END feature_codes
     FROM organizations o LEFT JOIN platform_packages p ON p.id=o.platform_package_id WHERE o.id=$1::uuid`, [req.auth.organizationId]);
            const access = result.rows[0];
            if (!access || access.type !== "waste_collection_company")
                return next();
            if ((access.feature_codes || []).includes(featureCode))
                return next();
            return res.status(403).json({ success: false, message: `This feature is not included in the ${access.code?.replaceAll("_", " ") || "current"} package. Contact your System Admin to change package access.` });
        }
        catch (error) {
            next(error);
        }
    };
}
