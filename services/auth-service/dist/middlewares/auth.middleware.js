"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAuth = requireAuth;
exports.requireRoles = requireRoles;
exports.requirePermission = requirePermission;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const organization_access_service_1 = require("../services/organization-access.service");
const env_1 = require("../config/env");
const role_repository_1 = require("../repositories/role.repository");
const role_repository_2 = require("../repositories/role.repository");
const auth_repository_1 = require("../repositories/auth.repository");
function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({
            success: false,
            message: "Authentication token is required",
        });
    }
    const token = authHeader.split(" ")[1];
    try {
        const decoded = jsonwebtoken_1.default.verify(token, env_1.env.jwtAccessSecret);
        req.user = decoded;
        next();
    }
    catch {
        return res.status(401).json({
            success: false,
            message: "Invalid or expired authentication token",
        });
    }
}
function requireRoles(...allowedRoles) {
    return async (req, res, next) => {
        const userId = req.user?.userId;
        if (!userId)
            return res.status(401).json({ success: false, message: "Unauthorized" });
        const [user, roles] = await Promise.all([(0, auth_repository_1.findUserById)(userId), (0, role_repository_2.getUserRoles)(userId)]);
        if (!user || user.status !== "active") {
            return res.status(401).json({ success: false, message: "User account is unavailable" });
        }
        if (!roles.some((role) => allowedRoles.includes(role.name))) {
            return res.status(403).json({ success: false, message: "You do not have access to manage organization staff" });
        }
        await (0, organization_access_service_1.requireActiveOrganization)(user.organization_id, roles, userId);
        req.user = {
            userId,
            email: req.user?.email,
            organizationId: user.organization_id,
        };
        next();
    };
}
function requirePermission(permissionCode) {
    return async (req, res, next) => {
        const userId = req.user?.userId;
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "Unauthorized",
            });
        }
        const permissions = await (0, role_repository_1.getUserPermissions)(userId);
        const hasPermission = permissions.some((permission) => permission.code === permissionCode);
        if (!hasPermission) {
            return res.status(403).json({
                success: false,
                message: "You do not have permission to perform this action",
                requiredPermission: permissionCode,
            });
        }
        next();
    };
}
