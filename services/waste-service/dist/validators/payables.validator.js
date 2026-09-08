"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.supplierPaymentSchema = exports.supplierBillSchema = void 0;
const zod_1 = require("zod");
exports.supplierBillSchema = zod_1.z.object({ billNumber: zod_1.z.string().trim().min(2).max(60), supplierId: zod_1.z.string().uuid(), purchaseOrderId: zod_1.z.string().uuid().optional(), description: zod_1.z.string().trim().min(3).max(240), amountUgx: zod_1.z.number().int().positive(), issuedOn: zod_1.z.string().date(), dueOn: zod_1.z.string().date() }).refine(x => x.dueOn >= x.issuedOn, { message: 'Due date must be on or after the invoice date', path: ['dueOn'] });
exports.supplierPaymentSchema = zod_1.z.object({ amountUgx: zod_1.z.number().int().positive(), paymentMethod: zod_1.z.enum(['bank_transfer', 'mobile_money', 'cash', 'cheque', 'other']), reference: zod_1.z.string().trim().max(120).optional(), paidOn: zod_1.z.string().date(), notes: zod_1.z.string().trim().max(500).optional() }).superRefine((x, ctx) => { if (x.paymentMethod !== 'cash' && (!x.reference || x.reference.length < 2))
    ctx.addIssue({ code: 'custom', message: 'A transaction reference is required for this payment method', path: ['reference'] }); });
