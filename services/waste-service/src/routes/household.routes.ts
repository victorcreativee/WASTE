import { NextFunction, Request, Response, Router } from "express";
import { z } from "zod";
import { AuthenticatedRequest, requireRoles } from "../middlewares/auth.middleware";
import { requireOrganizationPermission } from "../middlewares/organization-permission.middleware";
import { REMINDER_KINDS, ReminderSettings, createHouseholdRequest, householdOverview, reminderSettings, saveReminderSettings, setHouseholdSms, updateHouseholdPlace } from "../repositories/household.repository";

const router = Router();
const run = (handler: (req: Request, res: Response) => Promise<unknown>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try { await handler(req, res); } catch (error) { next(error); }
  };
const userId = (req: Request) => (req as AuthenticatedRequest).auth!.userId;
const requestSchema = z.object({
  kind: z.enum(["missed_collection", "pickup_request", "service_complaint"]),
  note: z.string().trim().max(500).optional(),
}).refine((input) => input.kind !== "service_complaint" || (input.note?.length ?? 0) >= 5, { message: "Describe your complaint", path: ["note"] });

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

// Where the household is: its exact position, a corrected address, or (before a company serves it) another area.
const placeSchema = z.object({
  address: z.string().trim().min(5, "Describe where you are: street, building or a landmark").max(300).optional(),
  latitude: z.number().min(-1).max(1.5).optional(),
  longitude: z.number().min(31).max(34).optional(),
  divisionId: z.string().uuid().optional(),
  areaId: z.string().uuid().nullable().optional(),
}).refine((input) => (input.latitude === undefined) === (input.longitude === undefined), { message: "Share both latitude and longitude", path: ["latitude"] });
router.put("/households/me/place", requireRoles("citizen"), run(async (req, res) => {
  try {
    const place = await updateHouseholdPlace(userId(req), placeSchema.parse(req.body));
    if (!place) return res.status(404).json({ success: false, message: "No household is linked to this account yet." });
    return res.json({ success: true, message: "Your place is saved", data: place });
  } catch (error) {
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (!statusCode) throw error;
    return res.status(statusCode).json({ success: false, message: (error as Error).message });
  }
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
