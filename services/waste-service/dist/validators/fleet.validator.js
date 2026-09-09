"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fleetAlertReviewSchema = exports.vehicleHistoryQuerySchema = exports.vehicleLocationSchema = exports.fuelRecordSchema = exports.truckDocumentSchema = exports.maintenanceStatusSchema = exports.maintenanceSchema = exports.truckStatusSchema = void 0;
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
exports.vehicleLocationSchema = zod_1.z.object({
    routeId: zod_1.z.string().uuid(), latitude: zod_1.z.number().min(-90).max(90), longitude: zod_1.z.number().min(-180).max(180),
    accuracyM: zod_1.z.number().nonnegative().max(10000).optional(), speedKph: zod_1.z.number().nonnegative().max(250).optional(),
    headingDegrees: zod_1.z.number().min(0).max(360).optional(), recordedAt: zod_1.z.string().datetime().optional(),
});
exports.vehicleHistoryQuerySchema = zod_1.z.object({
    minutes: zod_1.z.coerce.number().int().min(15).max(1440).default(120),
});
exports.fleetAlertReviewSchema = zod_1.z.object({
    alertCode: zod_1.z.enum(["signal_missing", "off_route", "stopped_too_long"]),
    action: zod_1.z.enum(["acknowledged", "resolved", "escalated"]),
    outcome: zod_1.z.enum(["driver_contacted", "vehicle_redirected", "assistance_dispatched", "false_alarm", "work_resumed", "other"]).optional(),
    notes: zod_1.z.string().trim().max(1000).optional(),
}).superRefine((value, ctx) => { if (value.action !== "acknowledged" && !value.outcome)
    ctx.addIssue({ code: "custom", path: ["outcome"], message: "Choose an operational outcome" }); if (value.action !== "acknowledged" && (!value.notes || value.notes.length < 3))
    ctx.addIssue({ code: "custom", path: ["notes"], message: "Add a short resolution note" }); });
