import { z } from "zod";
export const createExpenseSchema=z.object({
 category:z.enum(['fuel','maintenance','payroll','equipment','utilities','disposal_fees','office','other','food','transport','worker_credit','daily_wages']),
 description:z.string().trim().min(3).max(240),vendor:z.string().trim().max(160).optional(),
 amountUgx:z.number().int().positive(),expenseDate:z.string().date(),reference:z.string().trim().max(120).optional(),
});
export const dailyExpenseBatchSchema=z.object({
 expenseDate:z.string().date(),
 reference:z.string().trim().min(2).max(120).optional(),
 fundingSource:z.enum(['office_cash','manager_float']).default('office_cash'),
 lines:z.array(createExpenseSchema.omit({expenseDate:true,reference:true})).min(1).max(50),
});
export const expenseStatusSchema=z.object({status:z.enum(['approved','paid','void'])});
export const openingBalanceSchema=z.object({openingBalanceUgx:z.number().int().nonnegative(),asOfDate:z.string().date()});
