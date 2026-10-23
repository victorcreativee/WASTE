import { NextFunction, Request, Response, Router } from "express";
import { z } from "zod";
import { AuthenticatedRequest, requireRoles } from "../middlewares/auth.middleware";
import { createHouseholdRequest, householdOverview } from "../repositories/household.repository";

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

export default router;
