"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fuelRecordSchema = exports.truckDocumentSchema = exports.maintenanceStatusSchema = exports.maintenanceSchema = exports.truckStatusSchema = void 0;
const zod_1 = require("zod");
exports.truckStatusSchema = zod_1.z.object({ status: zod_1.z.enum(["available", "assigned", "maintenance", "inactive"]) });
exports.maintenanceSchema = zod_1.z.object({
    category: zod_1.z.enum(["preventive_service", "inspection", "repair", "tyres", "engine", "electrical", "other"]),
    title: zod_1.z.string().trim().min(2).max(160), description: zod_1.z.string().trim().max(2000).optional(),
    status: zod_1.z.enum(["scheduled", "in_progress", "completed", "cancelled"]).default("scheduled"),
    scheduledDate: zod_1.z.string().date(), odometerKm: zod_1.z.number().int().nonnegative().optional(),
    costUgx: zod_1.z.number().int().nonnegative().default(0), serviceProvider: zod_1.z.string().trim().max(160).optional(),
});
exports.maintenanceStatusSchema = zod_1.z.object({ status: zod_1.z.enum(["scheduled", "in_progress", "completed", "cancelled"]) });
exports.truckDocumentSchema = zod_1.z.object({
    documentType: zod_1.z.enum(["registration", "insurance", "inspection", "operating_license", "other"]),
    documentNumber: zod_1.z.string().trim().min(2).max(120), issuedOn: zod_1.z.string().date().optional(),
    expiresOn: zod_1.z.string().date(), fileUrl: zod_1.z.string().url().optional().or(zod_1.z.literal("")),
});
exports.fuelRecordSchema = zod_1.z.object({
    litres: zod_1.z.number().positive(), costUgx: zod_1.z.number().int().nonnegative(), odometerKm: zod_1.z.number().int().nonnegative().optional(),
    fuelDate: zod_1.z.string().date(), station: zod_1.z.string().trim().max(160).optional(),
});
