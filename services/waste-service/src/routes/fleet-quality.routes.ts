import { NextFunction, Request, Response, Router } from "express";
import { z } from "zod";
import { AuthenticatedRequest, requireRoles } from "../middlewares/auth.middleware";
import * as repo from "../repositories/fleet-quality.repository";

// GPS data completeness (migration 120) for companies and KCCA; driver scorecards for companies. Under /fleet, so the
// fleet package gate applies to companies.
const r = Router();
const run = (handler: (req: Request, res: Response) => Promise<unknown>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await handler(req, res);
    } catch (error) {
      next(error);
    }
  };
const auth = (req: Request) => (req as AuthenticatedRequest).auth!;
const regulator = (req: Request) => auth(req).roles.some(role => role === "kcca_admin" || role === "system_admin");
export const periodSchema = z.object({ from: z.iso.date(), to: z.iso.date() })
  .refine(v => v.from <= v.to, { path: ["to"], message: "The end date must be on or after the start date" })
  .refine(v => Date.parse(v.to) - Date.parse(v.from) <= 92 * 86400000, { path: ["to"], message: "Choose up to three months" });

r.get("/fleet/gps-quality", requireRoles("company_admin", "supervisor", "kcca_admin", "system_admin"), run(async (req, res) => {
  const { from, to } = periodSchema.parse(req.query);
  return res.json({ success: true, message: "GPS data completeness", data: await repo.gpsQuality(regulator(req) ? null : auth(req).organizationId, from, to) });
}));
r.get("/fleet/driver-scorecards", requireRoles("company_admin", "supervisor"), run(async (req, res) => {
  const { from, to } = periodSchema.parse(req.query);
  const organizationId = auth(req).organizationId;
  if (!organizationId) return res.status(403).json({ success: false, message: "Driver scorecards belong to a collection company account" });
  return res.json({ success: true, message: "Driver scorecards", data: await repo.driverScorecards(organizationId, from, to) });
}));

export default r;
