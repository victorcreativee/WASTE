import { z } from "zod";
import { serialFormatError } from "../services/receipt-signing";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date");
export const receiptListQuerySchema = z.object({
  from: date.optional(), to: date.optional(), search: z.string().trim().max(100).optional(),
  status: z.enum(["valid", "voided"]).optional(), organizationId: z.string().uuid().optional(),
}).refine(q => !q.from || !q.to || q.from <= q.to, { path: ["to"], message: "The end date is before the start date" });
export const receiptVoidSchema = z.object({ reason: z.string().trim().min(5, "Say why this receipt is void").max(500) });
export const serialFormatSchema = z.object({
  serialFormat: z.string().trim().superRefine((value, ctx) => {
    const error = serialFormatError(value);
    if (error) ctx.addIssue({ code: "custom", message: error });
  }),
});
export const operatorCodeSchema = z.object({ code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,8}$/, "Use 2 to 8 letters or digits") });
export const serialParamSchema = z.string().regex(/^[A-Za-z0-9_-]{1,60}$/);
