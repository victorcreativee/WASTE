"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateJobProblemSchema = exports.createJobProblemSchema = void 0;
const zod_1 = require("zod");
exports.createJobProblemSchema = zod_1.z.object({
    category: zod_1.z.enum([
        "blocked_access",
        "truck_problem",
        "unsafe_site",
        "waste_mismatch",
        "other",
    ]),
    description: zod_1.z.string().trim().min(5).max(1000),
});
exports.updateJobProblemSchema = zod_1.z.object({
    status: zod_1.z.enum(["acknowledged", "resolved"]),
    resolutionNotes: zod_1.z.string().trim().max(1000).optional(),
});
