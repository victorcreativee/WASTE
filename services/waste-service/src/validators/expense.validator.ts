import { z } from "zod";
export const createExpenseSchema=z.object({
 // The list comes from each company's settings; the repository checks the value is turned on.
 category:z.string().regex(/^[a-z0-9_]{2,30}$/,'Choose an expense category from the list'),
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
