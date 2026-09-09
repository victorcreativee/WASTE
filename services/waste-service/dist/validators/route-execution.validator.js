"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cancelCollectionRouteSchema = exports.completeRouteStopSchema = void 0;
const zod_1 = require("zod");
exports.completeRouteStopSchema = zod_1.z.object({
    collectedWeightKg: zod_1.z.number().nonnegative().optional(),
    completionNotes: zod_1.z.string().trim().max(1000).optional(),
    evidenceUrl: zod_1.z.string().url().max(1000).optional(),
});
exports.cancelCollectionRouteSchema = zod_1.z.object({
    reason: zod_1.z.enum([
        "operational_delay",
        "vehicle_breakdown",
        "driver_unavailable",
        "safety_issue",
        "weather",
        "service_change",
        "other",
    ]),
    notes: zod_1.z.string().trim().min(3, "Explain why this route is being cancelled").max(1000),
});
