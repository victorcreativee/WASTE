"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.purchaseStatusSchema = exports.purchaseRequestSchema = exports.movementSchema = exports.itemSchema = void 0;
const zod_1 = require("zod");
exports.itemSchema = zod_1.z.object({ sku: zod_1.z.string().trim().min(2).max(60), name: zod_1.z.string().trim().min(2).max(160), category: zod_1.z.enum(['bins', 'ppe', 'vehicle_parts', 'tools', 'cleaning_supplies', 'office', 'other']), unit: zod_1.z.string().trim().min(1).max(30), reorderLevel: zod_1.z.number().nonnegative(), unitCostUgx: zod_1.z.number().int().nonnegative(), storageLocation: zod_1.z.string().trim().max(160).optional() });
exports.movementSchema = zod_1.z.object({ movementType: zod_1.z.enum(['receipt', 'issue', 'adjustment']), quantity: zod_1.z.number().refine(v => v !== 0), reason: zod_1.z.string().trim().min(3).max(240), reference: zod_1.z.string().trim().max(120).optional() });
exports.purchaseRequestSchema = zod_1.z.object({ itemName: zod_1.z.string().trim().min(2).max(160), category: zod_1.z.string().trim().min(2).max(40), quantity: zod_1.z.number().positive(), unit: zod_1.z.string().trim().min(1).max(30), estimatedCostUgx: zod_1.z.number().int().nonnegative(), justification: zod_1.z.string().trim().min(5).max(500) });
exports.purchaseStatusSchema = zod_1.z.object({ status: zod_1.z.enum(['submitted', 'approved', 'ordered', 'received', 'rejected', 'cancelled']) });
