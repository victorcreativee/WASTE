"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.customerStopExceptionReviewSchema = exports.customerStopActionSchema = void 0;
const zod_1 = require("zod");
exports.customerStopActionSchema = zod_1.z.object({
    action: zod_1.z.enum(['arrive', 'complete', 'skip']),
    collectedWeightKg: zod_1.z.number().min(0).optional(),
    notes: zod_1.z.string().trim().max(1000).optional(),
    evidenceUrl: zod_1.z.string().url().max(1000).optional(),
    exceptionReason: zod_1.z.enum(['blocked_access', 'customer_unavailable', 'waste_not_ready', 'unsafe_conditions', 'vehicle_access', 'other']).optional(),
    exceptionNotes: zod_1.z.string().trim().min(3).max(1000).optional()
}).superRefine((value, ctx) => {
    if (value.action === 'skip' && !value.exceptionReason)
        ctx.addIssue({ code: 'custom', path: ['exceptionReason'], message: 'Choose why the pickup could not be completed' });
    if (value.action === 'skip' && value.exceptionReason === 'other' && !value.exceptionNotes)
        ctx.addIssue({ code: 'custom', path: ['exceptionNotes'], message: 'Explain the pickup issue' });
});
exports.customerStopExceptionReviewSchema = zod_1.z.object({
    action: zod_1.z.enum(['resolve', 'reschedule']),
    targetJobId: zod_1.z.string().uuid().optional(),
    reviewNotes: zod_1.z.string().trim().min(3).max(1000)
}).superRefine((value, ctx) => { if (value.action === 'reschedule' && !value.targetJobId)
    ctx.addIssue({ code: 'custom', path: ['targetJobId'], message: 'Choose a future collection job' }); });
