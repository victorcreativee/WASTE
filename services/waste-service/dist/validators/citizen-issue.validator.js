"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateCitizenIssueStatusSchema = exports.assignCitizenIssueSchema = exports.createCitizenIssueSchema = void 0;
const zod_1 = require("zod");
exports.createCitizenIssueSchema = zod_1.z.object({
    category: zod_1.z.enum([
        "illegal_dumping",
        "missed_collection",
        "overflowing_bin",
        "pickup_request",
    ]),
    title: zod_1.z.string().trim().min(3).max(180),
    description: zod_1.z.string().trim().min(10).max(4000),
    address: zod_1.z.string().trim().max(500).optional(),
    latitude: zod_1.z.number().min(-90).max(90).optional(),
    longitude: zod_1.z.number().min(-180).max(180).optional(),
}).refine((value) => (value.latitude === undefined && value.longitude === undefined) ||
    (value.latitude !== undefined && value.longitude !== undefined), { message: "Latitude and longitude must be provided together" });
exports.assignCitizenIssueSchema = zod_1.z.object({
    organizationId: zod_1.z.string().uuid(),
});
exports.updateCitizenIssueStatusSchema = zod_1.z.object({
    status: zod_1.z.enum(["triaged", "assigned", "in_progress", "resolved", "rejected"]),
    resolutionNotes: zod_1.z.string().trim().max(4000).optional(),
});
