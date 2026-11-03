import { z } from "zod";

export const arrearsListSchema = z.object({
  bucket: z.enum(["all", "1_30", "31_60", "61_90", "over_90"]).default("all"),
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

const kampalaToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Kampala" }).format(new Date());

export const followUpSchema = z.object({
  channel: z.enum(["call", "visit", "sms", "letter", "other"]),
  outcome: z.enum(["promise_to_pay", "paid_elsewhere", "disputed", "no_answer", "refused", "moved_away", "other"]),
  note: z.string().trim().max(1000).optional(),
  promisedAmountUgx: z.number().int().positive().max(1_000_000_000).optional(),
  promisedOn: z.iso.date().optional(),
}).superRefine((v, ctx) => {
  const promise = v.outcome === "promise_to_pay";
  if (promise && (!v.promisedAmountUgx || !v.promisedOn)) ctx.addIssue({ code: "custom", path: ["promisedOn"], message: "A promise needs an amount and a date" });
  if (!promise && (v.promisedAmountUgx || v.promisedOn)) ctx.addIssue({ code: "custom", path: ["outcome"], message: "Only a promise to pay has an amount and date" });
  if (v.promisedOn && v.promisedOn < kampalaToday()) ctx.addIssue({ code: "custom", path: ["promisedOn"], message: "The promised date cannot be in the past" });
  if (["disputed", "other"].includes(v.outcome) && !v.note) ctx.addIssue({ code: "custom", path: ["note"], message: "Say what the household said" });
});

export const planSchema = z.object({
  totalUgx: z.number().int().positive().max(1_000_000_000),
  instalments: z.number().int().min(2).max(24),
  frequency: z.enum(["weekly", "monthly"]),
  firstDueOn: z.iso.date(),
  note: z.string().trim().max(1000).optional(),
}).refine(v => v.firstDueOn >= kampalaToday(), { path: ["firstDueOn"], message: "The first instalment cannot be in the past" })
  .refine(v => v.totalUgx >= v.instalments * 1000, { path: ["instalments"], message: "Each instalment must be at least UGX 1,000" });

export const cancelPlanSchema = z.object({ reason: z.string().trim().min(5, "Say why the plan is cancelled").max(300) });
export const idSchema = z.guid();
