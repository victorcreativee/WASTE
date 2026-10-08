"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reviewComplianceSchema = exports.respondComplianceSchema = exports.createComplianceSchema = void 0;
const zod_1 = require("zod");
exports.createComplianceSchema = zod_1.z.object({ organizationId: zod_1.z.string().uuid(), category: zod_1.z.enum(['permit', 'service_delivery', 'weighbridge', 'customer_service', 'fleet_safety', 'other']), severity: zod_1.z.enum(['advisory', 'warning', 'critical']), title: zod_1.z.string().trim().min(4).max(180), details: zod_1.z.string().trim().min(10).max(3000), requiredAction: zod_1.z.string().trim().min(5).max(2000), dueDate: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
exports.respondComplianceSchema = zod_1.z.object({ response: zod_1.z.string().trim().min(10).max(3000) });
exports.reviewComplianceSchema = zod_1.z.object({ action: zod_1.z.enum(['close', 'reopen']), notes: zod_1.z.string().trim().min(5).max(2000) });
