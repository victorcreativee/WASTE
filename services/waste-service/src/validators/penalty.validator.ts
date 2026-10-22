import { z } from "zod";

const text = (min: number, message: string, max = 4000) => z.string().trim().min(min, message).max(max);
const amount = z.number().int("Use whole shillings").positive("Enter an amount above zero").max(10_000_000_000);

export const issueSchema = z.object({
  organizationId: z.string().uuid("Choose the company"),
  scheduleCode: z.string().trim().min(3, "Choose the offence"),
  grounds: text(20, "Describe the facts and the evidence (at least 20 characters)"),
  complianceCaseId: z.string().uuid().optional().nullable(),
  dumpingSiteId: z.string().uuid().optional().nullable(),
  returnPeriod: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use a month in the form YYYY-MM").optional().nullable(),
}).strict();

export const scheduleSchema = z.object({ amountUgx: amount, repeatAmountUgx: amount, isActive: z.boolean() }).strict();
export const appealSchema = z.object({ grounds: text(20, "Explain why the penalty should be withdrawn or reduced (at least 20 characters)") }).strict();
export const paymentSchema = z.object({
  reference: text(4, "Enter the payment reference", 100),
  paidOn: z.string().date("Use a date in the form YYYY-MM-DD"),
}).strict();
export const confirmSchema = z.object({ reference: text(4, "Enter the payment reference", 100).optional(), paidOn: z.string().date().optional() }).strict();
export const decisionSchema = z.object({
  decision: z.enum(["upheld", "reduced", "withdrawn"]),
  newAmount: amount.optional(),
  note: text(10, "Give the reasons for the decision (at least 10 characters)"),
}).strict().refine(value => value.decision !== "reduced" || value.newAmount !== undefined, { message: "Enter the reduced amount", path: ["newAmount"] });
export const reasonSchema = z.object({ reason: text(10, "Give the reason (at least 10 characters)") }).strict();
export const escalateSchema = z.object({ note: z.string().trim().max(2000).default("") }).strict();
