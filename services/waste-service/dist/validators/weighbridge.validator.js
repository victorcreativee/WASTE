"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.voidWeighbridgeSchema = exports.completeWeighbridgeSchema = exports.createWeighbridgeSchema = void 0;
const zod_1 = require("zod");
const base = zod_1.z.object({ organizationId: zod_1.z.string().uuid("Choose the responsible waste company"), tripId: zod_1.z.string().uuid().optional(), vehicleId: zod_1.z.string().uuid().optional(), driverId: zod_1.z.string().uuid().optional(), ticketNumber: zod_1.z.string().trim().min(2).max(100), facility: zod_1.z.string().trim().min(2).max(160), registration: zod_1.z.string().trim().min(2).max(50), driverName: zod_1.z.string().trim().max(150).optional(), routeSource: zod_1.z.string().trim().max(200).optional(), operationDate: zod_1.z.string().date(), arrivalAt: zod_1.z.string().datetime(), grossKg: zod_1.z.number().positive().max(1000000) });
exports.createWeighbridgeSchema = base.extend({ status: zod_1.z.enum(["open", "completed"]), departureAt: zod_1.z.string().datetime().optional(), tareKg: zod_1.z.number().positive().max(1000000).optional() }).superRefine((v, c) => { if (v.status === "completed" && (!v.tareKg || !v.departureAt))
    c.addIssue({ code: "custom", message: "Completed transactions require tare weight and departure time" }); if (v.tareKg && v.tareKg >= v.grossKg)
    c.addIssue({ code: "custom", message: "Tare weight must be less than gross weight", path: ["tareKg"] }); });
exports.completeWeighbridgeSchema = zod_1.z.object({ tareKg: zod_1.z.number().positive().max(1000000), departureAt: zod_1.z.string().datetime() });
exports.voidWeighbridgeSchema = zod_1.z.object({ reason: zod_1.z.string().trim().min(10, "Explain why this ticket is being voided").max(500) });
