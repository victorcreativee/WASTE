"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAuth = requireAuth;
exports.requirePermission = requirePermission;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const env_1 = require("../config/env");
const role_repository_1 = require("../repositories/role.repository");
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
