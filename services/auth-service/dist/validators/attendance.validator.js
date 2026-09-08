"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.attendanceSchema = exports.attendanceDateSchema = void 0;
const zod_1 = require("zod");
exports.attendanceDateSchema = zod_1.z.string().date();
const time = zod_1.z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a valid 24-hour time');
exports.attendanceSchema = zod_1.z.object({ userId: zod_1.z.string().uuid(), workDate: exports.attendanceDateSchema, shiftName: zod_1.z.string().trim().min(2).max(80).default('Day shift'), shiftStart: time.optional(), shiftEnd: time.optional(), status: zod_1.z.enum(['scheduled', 'present', 'late', 'absent', 'leave']), notes: zod_1.z.string().trim().max(500).optional() });
