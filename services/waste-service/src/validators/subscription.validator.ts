import { z } from "zod";

const money = z.number().int("Use whole shillings").min(0).max(10_000_000_000);
const limit = z.number().int().positive().max(100000).nullable();

export const changePlanSchema = z.object({ planCode: z.string().trim().min(2, "Choose a plan"), billingCycle: z.enum(["monthly", "annual"]).optional() }).strict();
export const paymentSchema = z.object({ reference: z.string().trim().min(4, "Enter the payment reference").max(100), paidOn: z.string().date("Use a date in the form YYYY-MM-DD") }).strict();
export const confirmSchema = z.object({ reference: z.string().trim().min(4).max(100).optional(), paidOn: z.string().date().optional() }).strict();
export const reasonSchema = z.object({ reason: z.string().trim().min(5, "Give the reason").max(1000) }).strict();
export const startSchema = z.object({ organizationId: z.string().uuid(), planCode: z.string().trim().min(2), mode: z.enum(["trial", "complimentary"]) }).strict();
export const adminActionSchema = z.object({
  action: z.enum(["extend_trial", "suspend", "reactivate", "make_complimentary", "start_billing"]),
  days: z.number().int().optional(),
  reason: z.string().trim().max(1000).optional(),
}).strict();
export const planSchema = z.object({
  monthlyFeeUgx: money, annualFeeUgx: money, maxVehicles: limit, maxUsers: limit,
  trialDays: z.number().int().min(0).max(90), isPublic: z.boolean(),
}).strict();
