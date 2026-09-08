"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCollectionRouteSchema = exports.generateCollectionJobsSchema = exports.assignCollectionJobSchema = exports.updateCollectionJobStatusSchema = exports.createCollectionJobSchema = exports.createPickupScheduleSchema = exports.createDriverSchema = exports.createTruckSchema = exports.assignZoneServiceAreaSchema = exports.createZoneSchema = void 0;
const zod_1 = require("zod");
exports.createZoneSchema = zod_1.z.object({
    organizationId: zod_1.z.string().uuid().optional(),
    name: zod_1.z.string().min(2, "Zone name is required"),
    description: zod_1.z.string().optional(),
    areaType: zod_1.z.enum([
        "residential",
        "commercial",
        "industrial",
        "market",
        "school",
        "hospital",
        "informal_settlement",
        "mixed",
    ]),
    latitude: zod_1.z.number().optional(),
    longitude: zod_1.z.number().optional(),
});
exports.assignZoneServiceAreaSchema = zod_1.z.object({
    organizationId: zod_1.z.string().uuid("Select a valid waste collection company"),
    latitude: zod_1.z.number().min(-90).max(90).optional(),
    longitude: zod_1.z.number().min(-180).max(180).optional(),
}).refine((input) => (input.latitude === undefined) === (input.longitude === undefined), "Latitude and longitude must be provided together");
exports.createTruckSchema = zod_1.z.object({
    organizationId: zod_1.z.string().uuid().optional(),
    plateNumber: zod_1.z.string().min(2, "Plate number is required"),
    truckName: zod_1.z.string().optional(),
    capacityTons: zod_1.z.number().optional(),
});
exports.createDriverSchema = zod_1.z.object({
    organizationId: zod_1.z.string().uuid().optional(),
    userId: zod_1.z.string().uuid().optional(),
    fullName: zod_1.z.string().min(2, "Driver name is required"),
    phone: zod_1.z.string().optional(),
    licenseNumber: zod_1.z.string().optional(),
});
exports.createPickupScheduleSchema = zod_1.z.object({
    organizationId: zod_1.z.string().uuid().optional(),
    zoneId: zod_1.z.string().uuid("Valid zone ID is required"),
    name: zod_1.z.string().min(2, "Schedule name is required"),
    frequency: zod_1.z.enum(["daily", "weekly", "biweekly", "monthly", "on_demand"]),
    preferredTime: zod_1.z.string().optional(),
});
exports.createCollectionJobSchema = zod_1.z.object({
    organizationId: zod_1.z.string().uuid().optional(),
    zoneId: zod_1.z.string().uuid("Valid zone ID is required"),
    truckId: zod_1.z.string().uuid().optional(),
    driverId: zod_1.z.string().uuid().optional(),
    scheduleId: zod_1.z.string().uuid().optional(),
    jobDate: zod_1.z.string().min(1, "Job date is required"),
    wasteType: zod_1.z
        .enum([
        "mixed",
        "organic",
        "plastic",
        "metal",
        "paper",
        "glass",
        "hazardous",
        "medical",
        "construction",
    ])
        .optional(),
    estimatedWeightKg: zod_1.z.number().optional(),
    notes: zod_1.z.string().optional(),
});
exports.updateCollectionJobStatusSchema = zod_1.z.object({
    status: zod_1.z.enum([
        "pending",
        "assigned",
        "in_progress",
        "completed",
        "missed",
        "cancelled",
    ]),
    collectedWeightKg: zod_1.z.number().optional(),
    notes: zod_1.z.string().optional(),
});
exports.assignCollectionJobSchema = zod_1.z.object({
    truckId: zod_1.z.string().uuid("Valid truck ID is required"),
    driverId: zod_1.z.string().uuid("Valid driver ID is required"),
});
exports.generateCollectionJobsSchema = zod_1.z.object({
    startDate: zod_1.z.string().min(1, "Start date is required"),
    daysAhead: zod_1.z.number().int().min(1).max(90).default(30),
    truckId: zod_1.z.string().uuid().optional(),
    driverId: zod_1.z.string().uuid().optional(),
    wasteType: zod_1.z
        .enum([
        "mixed",
        "organic",
        "plastic",
        "metal",
        "paper",
        "glass",
        "hazardous",
        "medical",
        "construction",
    ])
        .optional(),
    estimatedWeightKg: zod_1.z.number().optional(),
    notes: zod_1.z.string().optional(),
});
exports.createCollectionRouteSchema = zod_1.z.object({
    organizationId: zod_1.z.string().uuid().optional(),
    name: zod_1.z.string().min(2, "Route name is required"),
    truckId: zod_1.z.string().uuid().optional(),
    driverId: zod_1.z.string().uuid().optional(),
    routeDate: zod_1.z.string().min(1, "Route date is required"),
    jobIds: zod_1.z.array(zod_1.z.string().uuid()).min(1, "At least one job is required"),
    notes: zod_1.z.string().optional(),
});
