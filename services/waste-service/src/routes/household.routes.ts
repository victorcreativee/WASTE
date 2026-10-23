import { NextFunction, Request, Response, Router } from "express";
import { z } from "zod";
import { AuthenticatedRequest, requireRoles } from "../middlewares/auth.middleware";
import { requireOrganizationPermission } from "../middlewares/organization-permission.middleware";
import { REMINDER_KINDS, ReminderSettings, createHouseholdRequest, householdOverview, reminderSettings, saveReminderSettings, setHouseholdSms } from "../repositories/household.repository";

const router = Router();
const run = (handler: (req: Request, res: Response) => Promise<unknown>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try { await handler(req, res); } catch (error) { next(error); }
  };
const userId = (req: Request) => (req as AuthenticatedRequest).auth!.userId;
const requestSchema = z.object({
  kind: z.enum(["missed_collection", "pickup_request"]),
  note: z.string().trim().max(500).optional(),
});

// Household self-service (the /my page): one summary call, and requests that go straight to the household's company.
router.get("/households/me", requireRoles("citizen"), run(async (req, res) => {
  res.set("Cache-Control", "private, no-store");
  const overview = await householdOverview(userId(req));
  if (!overview) return res.status(404).json({ success: false, message: "No household is linked to this account yet." });
  return res.json({ success: true, message: "Household overview", data: overview });
}));
router.post("/households/me/requests", requireRoles("citizen"), run(async (req, res) => {
  const request = await createHouseholdRequest(userId(req), requestSchema.parse(req.body));
  if (!request) return res.status(409).json({ success: false, message: "Your household is not linked to a collection company yet." });
  return res.status(201).json({ success: true, message: "Request sent to your collection company", data: request });
}));

router.put("/households/me/sms", requireRoles("citizen"), run(async (req, res) => {
  const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
  const result = await setHouseholdSms(userId(req), enabled);
  if (!result) return res.status(404).json({ success: false, message: "No household is linked to this account yet." });
  return res.json({ success: true, message: enabled ? "SMS reminders turned on" : "SMS reminders turned off", data: result });
}));

// The company's household SMS reminder switches. Each SMS costs the company, so every kind starts off.
const organizationOf = (req: Request) => (req as AuthenticatedRequest).auth!.organizationId!;
const settingsSchema = z.object(Object.fromEntries(REMINDER_KINDS.map((kind) => [kind, z.boolean()])) as Record<(typeof REMINDER_KINDS)[number], z.ZodBoolean>);
router.get("/households/sms-settings", requireOrganizationPermission("customers.read"), run(async (req, res) =>
  res.json({ success: true, message: "Household SMS reminders", data: await reminderSettings(organizationOf(req)) })));
router.put("/households/sms-settings", requireOrganizationPermission("customers.manage"), run(async (req, res) =>
  res.json({ success: true, message: "Household SMS reminders saved", data: await saveReminderSettings(organizationOf(req), userId(req), settingsSchema.parse(req.body) as ReminderSettings) })));

export default router;
