"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordOrganizationPaymentSchema = exports.confirmPaymentSchema = exports.initiatePaymentSchema = exports.subscribeServicePlanSchema = exports.updateSubscriptionStatusSchema = exports.updateServicePlanStatusSchema = exports.createServicePlanSchema = void 0;
const zod_1 = require("zod");
exports.createServicePlanSchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(2).max(150),
    description: zod_1.z.string().trim().max(1000).optional(),
    customerType: zod_1.z.enum(["residential", "commercial", "office_business", "industrial"]).optional(),
    billingFrequency: zod_1.z.enum(["monthly", "quarterly", "annual", "on_demand"]),
    feeUgx: zod_1.z.number().int().nonnegative(),
    collectionsPerPeriod: zod_1.z.number().int().positive(),
    responseHours: zod_1.z.number().int().positive(),
});
exports.updateServicePlanStatusSchema = zod_1.z.object({ isActive: zod_1.z.boolean() });
exports.updateSubscriptionStatusSchema = zod_1.z.object({ status: zod_1.z.enum(["active", "suspended", "cancelled"]) });
exports.subscribeServicePlanSchema = zod_1.z.object({ planId: zod_1.z.string().uuid() });
exports.initiatePaymentSchema = zod_1.z.object({
    invoiceId: zod_1.z.string().uuid(), amountUgx: zod_1.z.number().int().positive(),
    provider: zod_1.z.enum(["mtn_momo", "airtel_money", "manual"]), payerPhone: zod_1.z.string().trim().min(7).max(50).optional(),
});
exports.confirmPaymentSchema = zod_1.z.object({ providerReference: zod_1.z.string().trim().min(2).max(150).optional() });
exports.recordOrganizationPaymentSchema = zod_1.z.object({
    invoiceId: zod_1.z.string().uuid(),
    amountUgx: zod_1.z.number().int().positive(),
    provider: zod_1.z.enum(["cash", "bank_transfer", "mtn_momo", "airtel_money"]),
    providerReference: zod_1.z.string().trim().min(2).max(150),
});
