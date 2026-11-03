import { NextFunction, Request, Response, Router } from "express";
import { z } from "zod";
import { AuthenticatedRequest, requireRoles } from "../middlewares/auth.middleware";
import * as repo from "../repositories/constituency.repository";

// Constituency dashboards (migration 118), for KCCA and system administrators.
const r = Router();
const run = (handler: (req: Request, res: Response) => Promise<unknown>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await handler(req, res);
    } catch (error) {
      next(error);
    }
  };
const readers = requireRoles("kcca_admin", "system_admin");
export const periodSchema = z.object({ from: z.iso.date(), to: z.iso.date() })
  .refine(v => v.from <= v.to, { path: ["to"], message: "The end date must be on or after the start date" })
  .refine(v => Date.parse(v.to) - Date.parse(v.from) <= 366 * 86400000, { path: ["to"], message: "Choose up to one year" });
export const assignSchema = z.object({ constituencyId: z.guid().nullable() });

r.get("/constituencies", readers, run(async (req, res) => {
  const { from, to } = periodSchema.parse(req.query);
  return res.json({ success: true, message: "Constituencies", data: await repo.constituencyOverview(from, to) });
}));
r.get("/constituencies/areas", readers, run(async (_req, res) =>
  res.json({ success: true, message: "Area assignments", data: await repo.areaAssignments() })));
r.put("/constituencies/areas/:areaId", requireRoles("kcca_admin"), run(async (req, res) => {
  const { constituencyId } = assignSchema.parse(req.body);
  const data = await repo.assignArea(z.guid().parse(req.params.areaId), constituencyId, (req as AuthenticatedRequest).auth!.userId);
  return res.json({ success: true, message: constituencyId ? `${data.name} assigned` : `${data.name} is no longer assigned`, data });
}));
r.get("/constituencies/:id", readers, run(async (req, res) => {
  const { from, to } = periodSchema.parse(req.query);
  return res.json({ success: true, message: "Constituency", data: await repo.constituencyDetail(String(req.params.id).slice(0, 60), from, to) });
}));

export default r;
