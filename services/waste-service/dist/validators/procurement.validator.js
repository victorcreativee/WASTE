"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.orderStatusSchema = exports.orderSchema = exports.supplierSchema = void 0;
const zod_1 = require("zod");
exports.supplierSchema = zod_1.z.object({ name: zod_1.z.string().trim().min(2).max(180), contactPerson: zod_1.z.string().trim().max(160).optional(), phone: zod_1.z.string().trim().max(50).optional(), email: zod_1.z.string().email().optional().or(zod_1.z.literal('')), address: zod_1.z.string().trim().max(1000).optional(), taxNumber: zod_1.z.string().trim().max(80).optional(), paymentTerms: zod_1.z.string().trim().max(120).optional() });
exports.orderSchema = zod_1.z.object({ purchaseRequestId: zod_1.z.string().uuid().optional(), supplierId: zod_1.z.string().uuid(), itemName: zod_1.z.string().trim().min(2).max(160), quantity: zod_1.z.number().positive(), unit: zod_1.z.string().trim().min(1).max(30), unitPriceUgx: zod_1.z.number().int().nonnegative(), expectedOn: zod_1.z.string().date().optional(), notes: zod_1.z.string().trim().max(500).optional() });
exports.orderStatusSchema = zod_1.z.object({ status: zod_1.z.enum(['issued', 'received', 'cancelled']) });
