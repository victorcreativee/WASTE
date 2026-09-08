import { z } from "zod";

export const createServicePlanSchema = z.object({
  name: z.string().trim().min(2).max(150),
  description: z.string().trim().max(1000).optional(),
  customerType: z.enum(["residential","commercial","office_business","industrial"]).optional(),
  billingFrequency: z.enum(["monthly","quarterly","annual","on_demand"]),
  feeUgx: z.number().int().nonnegative(),
  collectionsPerPeriod: z.number().int().positive(),
  responseHours: z.number().int().positive(),
});
export const updateServicePlanStatusSchema = z.object({ isActive: z.boolean() });
export const updateSubscriptionStatusSchema = z.object({ status: z.enum(["active","suspended","cancelled"]) });
export const subscribeServicePlanSchema = z.object({ planId: z.string().uuid() });
export const initiatePaymentSchema = z.object({
  invoiceId: z.string().uuid(), amountUgx: z.number().int().positive(),
  provider: z.enum(["mtn_momo","airtel_money","manual"]), payerPhone: z.string().trim().min(7).max(50).optional(),
});
export const confirmPaymentSchema = z.object({ providerReference: z.string().trim().min(2).max(150).optional() });
export const recordOrganizationPaymentSchema = z.object({
  invoiceId: z.string().uuid(),
  amountUgx: z.number().int().positive(),
  provider: z.enum(["cash","bank_transfer","mtn_momo","airtel_money"]),
  providerReference: z.string().trim().min(2).max(150),
});
