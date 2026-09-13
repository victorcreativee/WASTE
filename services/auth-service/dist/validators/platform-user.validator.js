"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.platformUserStatusSchema = exports.createPlatformUserSchema = void 0;
const zod_1 = require("zod");
const password = zod_1.z.string().min(12).max(72).refine(value => Buffer.byteLength(value, 'utf8') <= 72 && /[a-z]/.test(value) && /[A-Z]/.test(value) && /[0-9]/.test(value) && /[^A-Za-z0-9]/.test(value), 'Use 12–72 characters with uppercase, lowercase, number and symbol');
const ugandaPhone = zod_1.z.string().trim().regex(/^\+256\d{9}$/, 'Use a Ugandan number in the format +256782390653');
exports.createPlatformUserSchema = zod_1.z.object({ fullName: zod_1.z.string().trim().min(2).max(150), email: zod_1.z.string().trim().email().max(254), phone: ugandaPhone.optional(), password, role: zod_1.z.enum(['system_admin', 'kcca_admin', 'weighbridge_operator']) }).strict();
exports.platformUserStatusSchema = zod_1.z.object({ status: zod_1.z.enum(['active', 'suspended']) }).strict();
