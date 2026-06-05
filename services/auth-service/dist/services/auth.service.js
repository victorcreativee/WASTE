"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerUser = registerUser;
exports.loginUser = loginUser;
exports.getCurrentUser = getCurrentUser;
const bcrypt_1 = __importDefault(require("bcrypt"));
const auth_repository_1 = require("../repositories/auth.repository");
const jwt_1 = require("../utils/jwt");
const role_repository_1 = require("../repositories/role.repository");
const auth_repository_2 = require("../repositories/auth.repository");
function sanitizeUser(user) {
    return {
        id: user.id,
        organizationId: user.organization_id,
        fullName: user.full_name,
        email: user.email,
        phone: user.phone,
        status: user.status,
        createdAt: user.created_at,
    };
}
async function registerUser(input) {
    const existingUser = await (0, auth_repository_1.findUserByEmail)(input.email);
    if (existingUser) {
        const error = new Error("Email is already registered");
        error.statusCode = 409;
        throw error;
    }
    const passwordHash = await bcrypt_1.default.hash(input.password, 12);
    const user = await (0, auth_repository_1.createUser)({
        organizationId: input.organizationId,
        fullName: input.fullName,
        email: input.email,
        phone: input.phone,
        passwordHash,
    });
    const defaultRole = await (0, role_repository_1.findRoleByName)("citizen");
    if (defaultRole) {
        await (0, role_repository_1.assignRoleToUser)(user.id, defaultRole.id);
    }
    const accessToken = (0, jwt_1.signAccessToken)({
        userId: user.id,
        email: user.email,
        organizationId: user.organization_id,
    });
    const refreshToken = (0, jwt_1.signRefreshToken)({
        userId: user.id,
    });
    return {
        user: sanitizeUser(user),
        tokens: {
            accessToken,
            refreshToken,
        },
    };
}
async function loginUser(input) {
    const user = await (0, auth_repository_1.findUserByEmail)(input.email);
    if (!user) {
        const error = new Error("Invalid email or password");
        error.statusCode = 401;
        throw error;
    }
    if (user.status !== "active") {
        const error = new Error("User account is not active");
        error.statusCode = 403;
        throw error;
    }
    const passwordMatches = await bcrypt_1.default.compare(input.password, user.password_hash);
    if (!passwordMatches) {
        const error = new Error("Invalid email or password");
        error.statusCode = 401;
        throw error;
    }
    await (0, auth_repository_1.updateLastLogin)(user.id);
    const accessToken = (0, jwt_1.signAccessToken)({
        userId: user.id,
        email: user.email,
        organizationId: user.organization_id,
    });
    const refreshToken = (0, jwt_1.signRefreshToken)({
        userId: user.id,
    });
    return {
        user: sanitizeUser(user),
        tokens: {
            accessToken,
            refreshToken,
        },
    };
}
async function getCurrentUser(userId) {
    const user = await (0, auth_repository_2.findUserById)(userId);
    if (!user) {
        const error = new Error("User not found");
        error.statusCode = 404;
        throw error;
    }
    const roles = await (0, role_repository_1.getUserRoles)(user.id);
    const permissions = await (0, role_repository_1.getUserPermissions)(user.id);
    return {
        user: sanitizeUser(user),
        roles,
        permissions,
    };
}
