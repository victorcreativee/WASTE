"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loginSchema = exports.registerSchema = void 0;
const zod_1 = require("zod");
exports.registerSchema = zod_1.z.object({
    organizationId: zod_1.z.string().uuid().optional(),
    fullName: zod_1.z.string().min(2, "Full name is required"),
    email: zod_1.z.string().email("Valid email is required"),
    phone: zod_1.z.string().optional(),
    password: zod_1.z.string().min(8, "Password must be at least 8 characters"),
});
exports.loginSchema = zod_1.z.object({
    email: zod_1.z.string().email("Valid email is required"),
    password: zod_1.z.string().min(1, "Password is required"),
});
