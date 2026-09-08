"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.payrollStatusSchema = exports.payrollLineSchema = exports.createPayrollPeriodSchema = void 0;
const zod_1 = require("zod");
exports.createPayrollPeriodSchema = zod_1.z.object({ name: zod_1.z.string().trim().min(2).max(100), startsOn: zod_1.z.string().date(), endsOn: zod_1.z.string().date(), payDate: zod_1.z.string().date() }).superRefine((x, ctx) => { if (x.endsOn < x.startsOn)
    ctx.addIssue({ code: 'custom', message: 'Period end must be on or after its start', path: ['endsOn'] }); if (x.payDate < x.endsOn)
    ctx.addIssue({ code: 'custom', message: 'Pay date must be on or after the period end', path: ['payDate'] }); });
exports.payrollLineSchema = zod_1.z.object({ userId: zod_1.z.string().uuid(), basicPayUgx: zod_1.z.number().int().nonnegative(), allowanceUgx: zod_1.z.number().int().nonnegative().default(0), deductionUgx: zod_1.z.number().int().nonnegative().default(0), notes: zod_1.z.string().trim().max(500).optional() }).refine(x => x.deductionUgx <= x.basicPayUgx + x.allowanceUgx, { message: 'Deductions cannot exceed staff earnings', path: ['deductionUgx'] });
exports.payrollStatusSchema = zod_1.z.object({ status: zod_1.z.enum(['approved', 'paid', 'cancelled']) });
