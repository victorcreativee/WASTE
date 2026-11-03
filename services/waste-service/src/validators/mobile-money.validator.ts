import { z } from "zod";

export const providerParamSchema = z.enum(["mtn_momo", "airtel_money"]);
const secret = (label: string) => z.string().trim().min(8, `Enter the ${label}`).max(200);
export const mtnAccountSchema = z.object({
  environment: z.enum(["sandbox", "production"]),
  credentials: z.object({ apiUser: z.string().trim().uuid("The MTN API user is a UUID"), apiKey: secret("MTN API key"), subscriptionKey: secret("Collection subscription key") }),
});
export const airtelAccountSchema = z.object({
  environment: z.enum(["sandbox", "production"]),
  credentials: z.object({ clientId: secret("Airtel client ID"), clientSecret: secret("Airtel client secret") }),
});
export const accountStatusSchema = z.object({ status: z.enum(["active", "disabled"]) });
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date");
export const reconciliationQuerySchema = z.object({ from: date, to: date })
  .refine(q => q.from <= q.to, { path: ["to"], message: "The end date is before the start date" })
  .refine(q => (Date.parse(q.to) - Date.parse(q.from)) / 86_400_000 <= 366, { path: ["from"], message: "Choose at most one year" });
export const reviewResolutionSchema = z.object({
  resolution: z.enum(["refunded", "applied_by_hand", "not_received"]),
  note: z.string().trim().min(3, "Say what was done").max(500),
});
