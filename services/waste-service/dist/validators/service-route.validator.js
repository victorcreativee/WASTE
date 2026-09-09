"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateServiceRouteSchema = exports.assignServiceRouteCustomersSchema = exports.createServiceRouteSchema = void 0;
const zod_1 = require("zod");
exports.createServiceRouteSchema = zod_1.z.object({
    divisionId: zod_1.z.string().uuid("Choose a valid KCCA-authorized division"),
    zoneId: zod_1.z.string().uuid("Choose a valid service zone"),
    name: zod_1.z.string().trim().min(2, "Route name is required").max(150),
    code: zod_1.z.string().trim().min(2).max(50).optional(),
    defaultTruckId: zod_1.z.string().uuid().optional(),
    defaultDriverId: zod_1.z.string().uuid().optional(),
    defaultSupervisorUserId: zod_1.z.string().uuid().optional(),
    estimatedDurationMinutes: zod_1.z.number().int().positive().optional(),
    estimatedDistanceKm: zod_1.z.number().nonnegative().optional(),
});
exports.assignServiceRouteCustomersSchema = zod_1.z.object({
    serviceLocationIds: zod_1.z.array(zod_1.z.string().uuid()).max(1000)
        .refine(ids => new Set(ids).size === ids.length, "Select each customer only once"),
});
exports.updateServiceRouteSchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(2).max(150).optional(), code: zod_1.z.string().trim().min(2).max(50).nullable().optional(),
    isActive: zod_1.z.boolean().optional(), estimatedDurationMinutes: zod_1.z.number().int().positive().nullable().optional(),
    estimatedDistanceKm: zod_1.z.number().nonnegative().nullable().optional(),
}).refine(value => Object.keys(value).length > 0, "Add at least one change");
