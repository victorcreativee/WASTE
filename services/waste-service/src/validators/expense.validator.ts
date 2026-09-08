import { z } from "zod";
export const createExpenseSchema=z.object({
 category:z.enum(['fuel','maintenance','payroll','equipment','utilities','disposal_fees','office','other']),
 description:z.string().trim().min(3).max(240),vendor:z.string().trim().max(160).optional(),
 amountUgx:z.number().int().positive(),expenseDate:z.string().date(),reference:z.string().trim().max(120).optional(),
});
export const expenseStatusSchema=z.object({status:z.enum(['approved','paid','void'])});
export const openingBalanceSchema=z.object({openingBalanceUgx:z.number().int().nonnegative(),asOfDate:z.string().date()});
