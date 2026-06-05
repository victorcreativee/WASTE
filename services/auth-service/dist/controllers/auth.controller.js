"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.register = register;
exports.login = login;
exports.me = me;
const auth_validator_1 = require("../validators/auth.validator");
const auth_service_1 = require("../services/auth.service");
async function register(req, res) {
    try {
        const input = auth_validator_1.registerSchema.parse(req.body);
        const result = await (0, auth_service_1.registerUser)(input);
        return res.status(201).json({
            success: true,
            message: "User registered successfully",
            data: result,
        });
    }
    catch (error) {
        const statusCode = error.statusCode || 400;
        return res.status(statusCode).json({
            success: false,
            message: error instanceof Error ? error.message : "Registration failed",
        });
    }
}
async function login(req, res) {
    try {
        const input = auth_validator_1.loginSchema.parse(req.body);
        const result = await (0, auth_service_1.loginUser)(input);
        return res.status(200).json({
            success: true,
            message: "Login successful",
            data: result,
        });
    }
    catch (error) {
        const statusCode = error.statusCode || 400;
        return res.status(statusCode).json({
            success: false,
            message: error instanceof Error ? error.message : "Login failed",
        });
    }
}
async function me(req, res) {
    try {
        const userId = req.user?.userId;
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "Unauthorized",
            });
        }
        const result = await (0, auth_service_1.getCurrentUser)(userId);
        return res.status(200).json({
            success: true,
            message: "Current user fetched successfully",
            data: result,
        });
    }
    catch (error) {
        const statusCode = error.statusCode || 400;
        return res.status(statusCode).json({
            success: false,
            message: error instanceof Error ? error.message : "Failed to fetch user",
        });
    }
}
