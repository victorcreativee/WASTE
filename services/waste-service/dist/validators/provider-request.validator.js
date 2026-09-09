"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reviewProviderRequestSchema = exports.createProviderRequestSchema = void 0;
const zod_1 = require("zod");
exports.createProviderRequestSchema = zod_1.z.object({
    organizationId: zod_1.z.string().uuid(), note: zod_1.z.string().trim().max(500).optional()
});
exports.reviewProviderRequestSchema = zod_1.z.object({
    action: zod_1.z.enum(['approve', 'reject']), note: zod_1.z.string().trim().max(500).optional()
});
