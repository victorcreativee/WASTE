"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAuth = requireAuth;
exports.requireRoles = requireRoles;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const database_1 = require("../config/database");
const env_1 = require("../config/env");
async function requireAuth(req, res, next) {
    const authorization = req.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) {
        return res.status(401).json({ success: false, message: "Authentication token is required" });
    }
    if (!env_1.env.jwtAccessSecret) {
        return res.status(503).json({ success: false, message: "Authentication is not configured" });
    }
    try {
        const claims = jsonwebtoken_1.default.verify(authorization.slice(7), env_1.env.jwtAccessSecret);
        if (!claims.userId)
            throw new Error("Missing user identity");
        const result = await database_1.dbPool.query(`SELECT u.status, u.organization_id,
              ARRAY_REMOVE(ARRAY_AGG(r.name), NULL) AS roles
       FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       LEFT JOIN roles r ON r.id = ur.role_id
       WHERE u.id = $1::uuid
       GROUP BY u.id`, [claims.userId]);
        const user = result.rows[0];
        if (!user || user.status !== "active") {
            return res.status(401).json({ success: false, message: "User account is unavailable" });
        }
        req.auth = { userId: claims.userId, organizationId: user.organization_id, roles: user.roles ?? [] };
        next();
    }
    catch {
        return res.status(401).json({ success: false, message: "Invalid or expired authentication token" });
    }
}
function requireRoles(...allowedRoles) {
    return (req, res, next) => {
        if (!req.auth)
            return res.status(401).json({ success: false, message: "Unauthorized" });
        if (!req.auth.roles.some((role) => allowedRoles.includes(role))) {
            return res.status(403).json({ success: false, message: "You do not have access to organization administration" });
        }
        if (req.auth.roles.includes("company_admin") && !req.auth.organizationId) {
            return res.status(403).json({
                success: false,
                message: "Company administrator is not linked to an organization",
            });
        }
        next();
    };
}
