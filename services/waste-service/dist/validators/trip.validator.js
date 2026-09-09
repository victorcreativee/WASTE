"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyTripWeightSchema = exports.createTripSchema = void 0;
const zod_1 = require("zod");
exports.createTripSchema = zod_1.z.object({ serviceRouteId: zod_1.z.string().uuid("Choose a valid route"), truckId: zod_1.z.string().uuid("Choose a vehicle"), driverId: zod_1.z.string().uuid("Choose a driver"), supervisorUserId: zod_1.z.string().uuid("Choose a supervisor"), tripDate: zod_1.z.string().date("Choose a valid trip date") });
exports.verifyTripWeightSchema = zod_1.z.object({ ticketNumber: zod_1.z.string().trim().min(2, "Enter the weighbridge ticket number").max(100), facility: zod_1.z.string().trim().min(2, "Enter the weighbridge facility").max(160), verifiedWeightKg: zod_1.z.number().positive("Verified weight must be greater than zero").max(1000000) });
