"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.openingBalanceSchema = exports.expenseStatusSchema = exports.createExpenseSchema = void 0;
const zod_1 = require("zod");
exports.createExpenseSchema = zod_1.z.object({
    category: zod_1.z.enum(['fuel', 'maintenance', 'payroll', 'equipment', 'utilities', 'disposal_fees', 'office', 'other']),
    description: zod_1.z.string().trim().min(3).max(240), vendor: zod_1.z.string().trim().max(160).optional(),
    amountUgx: zod_1.z.number().int().positive(), expenseDate: zod_1.z.string().date(), reference: zod_1.z.string().trim().max(120).optional(),
});
exports.expenseStatusSchema = zod_1.z.object({ status: zod_1.z.enum(['approved', 'paid', 'void']) });
exports.openingBalanceSchema = zod_1.z.object({ openingBalanceUgx: zod_1.z.number().int().nonnegative(), asOfDate: zod_1.z.string().date() });
