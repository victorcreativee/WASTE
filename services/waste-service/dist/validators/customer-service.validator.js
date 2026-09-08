"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateCustomerServiceStatusSchema = exports.upsertCustomerServiceSchema = void 0;
const zod_1 = require("zod");
exports.upsertCustomerServiceSchema = zod_1.z.object({
    customerType: zod_1.z.enum(["residential", "commercial", "office_business", "industrial"]),
    label: zod_1.z.string().trim().min(2).max(100).default("Primary location"),
    address: zod_1.z.string().trim().min(5).max(500),
    latitude: zod_1.z.number().min(-90).max(90),
    longitude: zod_1.z.number().min(-180).max(180),
});
exports.updateCustomerServiceStatusSchema = zod_1.z.object({
    status: zod_1.z.enum(["active", "suspended", "inactive"]),
});
