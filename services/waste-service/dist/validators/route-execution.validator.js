"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.completeRouteStopSchema = void 0;
const zod_1 = require("zod");
exports.completeRouteStopSchema = zod_1.z.object({
    collectedWeightKg: zod_1.z.number().nonnegative().optional(),
    completionNotes: zod_1.z.string().trim().max(1000).optional(),
    evidenceUrl: zod_1.z.string().url().max(1000).optional(),
});
